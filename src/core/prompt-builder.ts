import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens } from './token-budget.js';
import type { SkillDefinition } from './skill-parser.js';
import type { MicroClawDB } from '../db.js';
import { GROUPS_DIR, MEMORY_FILENAME, SOUL_FILENAME, HEARTBEAT_FILENAME, GLOBAL_MEMORY_PATH } from './paths.js';
import { readPersonaSupplementBlock, readBehaviorHints } from '../memory/post-turn-extractor.js';

export type PromptMode = 'full' | 'minimal';

const AGENT_BASE_PATH = path.resolve('prompts/system/agent-base.toon');

const TOOL_SUMMARY =
  'FS: read write append delete list search | ' +
  'Sys: exec python node process | ' +
  'Web: web_search web_fetch download | ' +
  'Browser: browser | ' +
  'Mem: memory_read memory_write memory_search | ' +
  'Auto: cron scheduler heartbeat | ' +
  'Agent: session context history | ' +
  'Cfg: config env logs';

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
  return `You are ${personaName} (${personaStyle}). Use tools — never say you cannot do something a tool can do.
Tools: ${TOOL_SUMMARY}
All files go to .workspace/ unless a path is specified. CWD: ${process.cwd()}`;
}

function extractSoulMeta(soul: string): { name: string; style: string } {
  const nameMatch = soul.match(/^#\s*Identity\s*\nYou are ([^.\n]+)/m);
  const styleMatch = soul.match(/^#\s*Style\s*\n([^\n]+)/m);
  return {
    name: nameMatch?.[1]?.trim() ?? 'Andy',
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
    } catch { /* ignore if FTS unavailable */ }
  }

  if (!fs.existsSync(memoryPath)) return '';
  const lines = fs.readFileSync(memoryPath, 'utf-8').split('\n');
  return lines.slice(0, 30).join('\n').trim();
}

export interface PromptBuilderOptions {
  groupId: string;
  skills?: SkillDefinition[];
  context?: { senderId?: string; channel?: string };
  db?: MicroClawDB;
  lastUserMessage?: string;
  promptMode?: PromptMode;
  lightContext?: boolean;
  /** Hint injected before Memory section, e.g. from suggestWebSearch() */
  toolHint?: string;
  /** Last assistant reply — used for topic-shift web-search nudge */
  lastAssistantMessage?: string;
}

/**
 * Build system prompt.
 *
 * promptMode='full' (default): full persona + skills + memory + context.
 * promptMode='minimal': agent base only — no tools schemas, no skills, no memory.
 *   Used by sub-agents and heartbeat runs.
 *
 * lightContext=true: only inject HEARTBEAT.md content (no SOUL, no memory).
 *   Used by heartbeat scheduler to minimize token cost.
 */
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

  const soulPath = path.join(GROUPS_DIR, opts.groupId, SOUL_FILENAME);
  const memoryPath = path.join(GROUPS_DIR, opts.groupId, MEMORY_FILENAME);
  const heartbeatPath = path.join(GROUPS_DIR, opts.groupId, HEARTBEAT_FILENAME);

  // Extract user preferences from the global memory file (microclaw.md)
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
  const agentBase = loadAgentBase(personaName, personaStyle);

  const parts: string[] = [];

  // 1. Agent base (always included)
  parts.push(agentBase);

  // lightContext mode: only inject HEARTBEAT.md
  if (light) {
    const hb = fs.existsSync(heartbeatPath) ? fs.readFileSync(heartbeatPath, 'utf-8').trim() : '';
    if (hb) parts.push(`--- Heartbeat ---\n${hb}`);
    return parts.join('\n\n');
  }

  // minimal mode: no skills, no memory, no full context — sub-agent/heartbeat
  if (mode === 'minimal') {
    return parts.join('\n\n');
  }

  // ─── full mode ─────────────────────────────────────────────────

  // Persona (soul + supplement for appearance / user name / tone)
  if (soul) {
    let personaBlock = soul;
    const supplement = readPersonaSupplementBlock(opts.groupId);
    if (supplement) personaBlock += `\n\n--- Persona Supplement ---\n${supplement}`;
    parts.push(`--- Persona ---\n${personaBlock}`);
  }

  if (opts.skills && opts.skills.length > 0) {
    const skillList = opts.skills.map(s => `/${s.command}: ${s.description}`).join('\n');
    parts.push(`--- Skills ---\n${skillList}`);
  }

  // User preferences from microclaw.md
  const userPrefs = readUserPreferences();
  if (userPrefs) parts.push(`--- User Preferences ---\n${userPrefs}`);

  // Behavior hints (inferred from past turns) + long-term memory
  const behaviorHints = readBehaviorHints(opts.groupId);
  const memory = selectiveMemory(opts.db, opts.groupId, memoryPath, opts.lastUserMessage);
  const memLines: string[] = [];
  if (behaviorHints) memLines.push(`Behavior: ${behaviorHints}`);
  if (memory) memLines.push(memory);
  if (memLines.length) parts.push(`--- Memory ---\n${memLines.join('\n')}`);

  // Tool hint (from suggestWebSearch or caller)
  if (opts.toolHint) {
    parts.push(`--- Hint ---\n${opts.toolHint}`);
  }

  const ctxLines = [`CWD: ${process.cwd()}`];
  if (opts.context?.channel)  ctxLines.push(`Channel: ${opts.context.channel}`);
  if (opts.context?.senderId) ctxLines.push(`Sender: ${opts.context.senderId}`);
  parts.push(`--- Context ---\n${ctxLines.join('\n')}`);

  return parts.join('\n\n');
}

export function estimateSystemPromptTokens(prompt: string): number {
  return estimateTokens(prompt);
}
