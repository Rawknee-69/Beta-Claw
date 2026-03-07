import fs from 'node:fs';
import path from 'node:path';
import { compressMemoryFile } from './token-budget.js';
import type { SkillDefinition } from './skill-parser.js';

const AGENT_BASE_PATH = path.resolve('prompts/system/agent-base.toon');

function loadAgentBase(personaName: string, personaStyle: string): string {
  try {
    if (fs.existsSync(AGENT_BASE_PATH)) {
      return fs.readFileSync(AGENT_BASE_PATH, 'utf-8')
        .replace(/\{\{PERSONA_NAME\}\}/g, personaName)
        .replace(/\{\{PERSONA_STYLE\}\}/g, personaStyle);
    }
  } catch {
    // fall through to inline fallback
  }
  return `You are ${personaName}, an AI assistant (${personaStyle}).
CRITICAL: You have real tools. Use them. NEVER say you cannot do something if a tool can do it.
- write_file: create any file
- run_cmd: run any shell command (mkdir, git, npm, python, etc.)
- list_dir: list directory contents
- read_file: read file contents
- web_search: search the web
- send_whatsapp: send a WhatsApp message
- cron_add/cron_list/cron_delete: schedule recurring tasks
- memory_save/memory_search: remember facts
Current directory: ${process.cwd()}`;
}

function extractSoulMeta(soul: string): { name: string; style: string } {
  const nameMatch = soul.match(/^#\s*Identity\s*\nYou are ([^.\n]+)/m);
  const styleMatch = soul.match(/^#\s*Style\s*\n([^\n]+)/m);
  return {
    name: nameMatch?.[1]?.trim() ?? 'Andy',
    style: styleMatch?.[1]?.trim() ?? 'direct and concise',
  };
}

export async function buildSystemPrompt(
  groupId: string,
  skills?: SkillDefinition[],
  context?: { senderId?: string; channel?: string },
): Promise<string> {
  const soulPath = `groups/${groupId}/SOUL.md`;
  const claudePath = `groups/${groupId}/CLAUDE.md`;

  const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8').trim() : '';
  const rawMemory = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf-8').trim() : '';
  const memory = rawMemory ? compressMemoryFile(rawMemory) : '';

  const { name: personaName, style: personaStyle } = extractSoulMeta(soul);
  const agentBase = loadAgentBase(personaName, personaStyle);

  const parts: string[] = [];

  // 1. Agent base (tool policy, identity, guardrails)
  parts.push(agentBase);

  // 2. Persona / SOUL (character, language)
  if (soul) parts.push(`--- Persona ---\n${soul}`);

  // 3. Available skills
  if (skills && skills.length > 0) {
    const skillList = skills
      .map(s => `  /${s.command} — ${s.description}`)
      .join('\n');
    parts.push(`--- Available Skills ---\nYou can invoke these skills by their command name:\n${skillList}`);
  }

  // 4. Long-term memory
  if (memory) parts.push(`--- Long-term Memory ---\n${memory}`);

  // 5. Runtime context
  const ctxLines = [`Current directory: ${process.cwd()}`];
  if (context?.channel)  ctxLines.push(`Channel: ${context.channel}`);
  if (context?.senderId) ctxLines.push(`Sender JID: ${context.senderId}  ← use this as the "to" field when calling send_whatsapp to reply to the current user`);
  parts.push(`--- Runtime Context ---\n${ctxLines.join('\n')}`);

  return parts.join('\n\n');
}
