import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens } from './token-budget.js';
import type { SkillDefinition } from './skill-parser.js';
import type { MicroClawDB } from '../db.js';
import { PATHS, GLOBAL_MEMORY_PATH } from './paths.js';
import { TOOLS } from './tools.js';
import { readPersonaSupplementBlock, readBehaviorHints } from '../memory/post-turn-extractor.js';
import { getCapabilities } from '../capabilities/multimodal.js';

export type PromptMode = 'full' | 'minimal';

const AGENT_BASE_PATH = path.resolve('prompts/system/agent-base.toon');

const TOOL_SUMMARY =
  'read write exec list web_search web_fetch memory_read memory_write';

function loadAgentBase(
  personaName: string,
  personaStyle: string,
  groupId: string,
  soul: string,
  memory: string,
  skillsXml: string,
  modelId?: string,
): string {
  try {
    if (fs.existsSync(AGENT_BASE_PATH)) {
      const toolsList = TOOLS.map(t => `- ${t.name}: ${t.description}`).join('\n');
      const caps = getCapabilities(modelId ?? '');

      let prompt = fs.readFileSync(AGENT_BASE_PATH, 'utf-8')
        .replace(/\{\{PERSONA_NAME\}\}/g, personaName)
        .replace(/\{\{PERSONA_STYLE\}\}/g, personaStyle);

      prompt = prompt
        .replace('{TOOLS_LIST}',        toolsList)
        .replace('{AVAILABLE_SKILLS}',  skillsXml)
        .replace('{AGENT_NAME}',        personaName)
        .replace(/{GROUP_ID}/g,         groupId)
        .replace('{SOUL_CONTENT}',      soul || 'You are a helpful, capable AI assistant.')
        .replace('{MEMORY_CONTENT}',    memory || 'No previous memory.')
        .replace('{SKILLS_CONTENT}',    skillsXml)
        .replace('{IMAGE_CAPABILITY}',  caps.canGenerateImage ? `Yes — provider: ${caps.imageProvider}` : 'Not available')
        .replace('{AUDIO_CAPABILITY}',  caps.canGenerateAudio ? `Yes — provider: ${caps.audioProvider}` : 'Not available');

      prompt = prompt.replace(/\{\{[A-Z_]+\}\}/g, '');

      return prompt;
    }
  } catch { /* fall through */ }
  return `You are ${personaName} (${personaStyle}). Use tools — never say you cannot do something a tool can do.
Tools: ${TOOL_SUMMARY}
CWD: ${process.cwd()}`;
}

function extractSoulMeta(soul: string): { name: string; style: string } {
  const nameMatch = soul.match(/^#\s*Identity\s*\nYou are ([^.\n]+)/m);
  const styleMatch = soul.match(/^#\s*Style\s*\n([^\n]+)/m);
  return {
    name: nameMatch?.[1]?.trim() ?? 'rem',
    style: styleMatch?.[1]?.trim() ?? 'direct and concise',
  };
}

function selectiveMemory(db: MicroClawDB | undefined, groupId: string, memoryPath: string, hint?: string): string {
  if (db) {
    try {
      const safe = (hint ?? '').replace(/["*(){}:^~.\-/\\]/g, ' ').trim();
      if (safe) {
        const rows = db.searchMemory(safe, groupId, 5);
        if (rows.length) return rows.map(r => `- ${r.content}`).join('\n');
      }
      const recent = db.searchMemory('', groupId, 5);
      if (recent.length) return recent.map(r => `- ${r.content}`).join('\n');
    } catch { /* FTS unavailable */ }
  }

  if (!fs.existsSync(memoryPath)) return '';
  const lines = fs.readFileSync(memoryPath, 'utf-8').split('\n');
  return lines.slice(0, 30).join('\n').trim();
}

function formatSkillsForPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';
  const entries = skills.map(s =>
    `<skill name="${s.name}" cmd="/${s.command}">${s.description}</skill>`
  ).join('\n');
  return `<skills>\n${entries}\n</skills>`;
}

export function loadTriggeredSkillBody(skillName: string): string {
  const p = path.join(PATHS.skills, skillName, 'SKILL.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

export interface PromptBuilderOptions {
  groupId: string;
  skills?: SkillDefinition[];
  context?: { senderId?: string; channel?: string };
  db?: MicroClawDB;
  lastUserMessage?: string;
  promptMode?: PromptMode;
  lightContext?: boolean;
  toolHint?: string;
  lastAssistantMessage?: string;
  triggeredSkill?: string;
  modelId?: string;
}

export async function buildSystemPrompt(opts: PromptBuilderOptions): Promise<string>;
export async function buildSystemPrompt(
  groupId: string,
  skills?: SkillDefinition[],
  context?: { senderId?: string; channel?: string },
  db?: MicroClawDB,
  lastUserMessage?: string,
): Promise<string>;
export async function buildSystemPrompt(
  groupIdOrOpts: string | PromptBuilderOptions,
  skills?: SkillDefinition[],
  context?: { senderId?: string; channel?: string },
  db?: MicroClawDB,
  lastUserMessage?: string,
): Promise<string> {
  const opts: PromptBuilderOptions = typeof groupIdOrOpts === 'string'
    ? { groupId: groupIdOrOpts, skills, context, db, lastUserMessage }
    : groupIdOrOpts;

  const mode = opts.promptMode ?? 'full';
  const light = opts.lightContext ?? false;

  const soulPath = PATHS.soul(opts.groupId);
  const memoryPath = PATHS.memory(opts.groupId);
  const heartbeatPath = PATHS.heartbeat(opts.groupId);

  function readUserPreferences(): string {
    try {
      if (!fs.existsSync(GLOBAL_MEMORY_PATH)) return '';
      const content = fs.readFileSync(GLOBAL_MEMORY_PATH, 'utf-8');
      const rx = /## User Preferences\s*\n([\s\S]*?)(?=\n##|$)/m;
      const m = content.match(rx);
      const prefs = m ? (m[1] ?? '').trim() : '';
      return prefs === '(Updated automatically as MicroClaw learns your preferences)' ? '' : prefs;
    } catch { return ''; }
  }

  const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8').trim() : '';
  const { name: personaName, style: personaStyle } = extractSoulMeta(soul);

  const behaviorHints = readBehaviorHints(opts.groupId);
  const memForBase = selectiveMemory(opts.db, opts.groupId, memoryPath, opts.lastUserMessage);
  const memLines: string[] = [];
  if (behaviorHints) memLines.push(`Behavior: ${behaviorHints}`);
  if (memForBase) memLines.push(memForBase);
  const memoryBlock = memLines.join('\n');

  const skillsXml = formatSkillsForPrompt(opts.skills ?? []);

  const agentBase = loadAgentBase(personaName, personaStyle, opts.groupId, soul, memoryBlock, skillsXml, opts.modelId);

  const parts: string[] = [];

  parts.push(agentBase);

  if (light) {
    const hb = fs.existsSync(heartbeatPath) ? fs.readFileSync(heartbeatPath, 'utf-8').trim() : '';
    if (hb) parts.push(`--- Heartbeat ---\n${hb}`);
    return parts.join('\n\n');
  }

  if (mode === 'minimal') {
    return parts.join('\n\n');
  }

  // ─── full mode ─────────────────────────────────────────────────

  if (soul) {
    let personaBlock = soul;
    const supplement = readPersonaSupplementBlock(opts.groupId);
    if (supplement) personaBlock += `\n\n--- Persona Supplement ---\n${supplement}`;
    parts.push(`--- Persona ---\n${personaBlock}`);
  }

  if (opts.skills && opts.skills.length > 0) {
    parts.push(formatSkillsForPrompt(opts.skills));
  }

  if (opts.triggeredSkill) {
    const body = loadTriggeredSkillBody(opts.triggeredSkill);
    if (body) parts.push(`--- Active Skill ---\n${body}`);
  }

  const userPrefs = readUserPreferences();
  if (userPrefs) parts.push(`--- User Preferences ---\n${userPrefs}`);

  if (memoryBlock) parts.push(`--- Memory ---\n${memoryBlock}`);

  if (opts.toolHint) {
    parts.push(`--- Hint ---\n${opts.toolHint}`);
  }

  const ctxLines = [`CWD: ${process.cwd()}`];
  if (opts.context?.channel)  ctxLines.push(`Channel: ${opts.context.channel}`);
  if (opts.context?.senderId) ctxLines.push(`Sender: ${opts.context.senderId}`);

  // Reinforce messaging-channel rule so the model never leaks tool internals
  const isMessagingChannel = opts.context?.channel && opts.context.channel !== 'cli';
  if (isMessagingChannel) {
    ctxLines.push('REMINDER: This is a messaging channel. Never include [Used tools:...] or [toolName] prefixes in your response. Reply naturally.');
  }

  parts.push(`--- Context ---\n${ctxLines.join('\n')}`);

  return parts.join('\n\n');
}

export function estimateSystemPromptTokens(prompt: string): number {
  return estimateTokens(prompt);
}
