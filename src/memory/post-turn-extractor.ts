/**
 * Post-turn extractor — Phase 1/2/3.
 *
 * After each assistant reply, runs a cheap nano LLM call to extract:
 *   - User preferences (→ CLAUDE.md "## User Preferences" section)
 *   - Persona updates (→ groups/{id}/persona-supplement.md)
 *   - Behavioral signals (→ groups/{id}/behavior.md)
 *   - Long-term facts (→ groups/{id}/memory.md + FTS)
 *
 * Compaction: if a section exceeds COMPACT_THRESHOLD words, a second cheap
 * call summarises it in-place so it stays small.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MicroClawDB } from '../db.js';
import type { ProviderRegistry } from '../core/provider-registry.js';
import type { ModelEntry } from '../core/model-catalog.js';
import { selectModel } from '../core/model-selector.js';
import {
  GROUPS_DIR,
  GLOBAL_MEMORY_PATH,
  MEMORY_FILENAME,
  PERSONA_SUPPLEMENT_FILENAME,
  BEHAVIOR_FILENAME,
} from '../core/paths.js';

// ── Constants ────────────────────────────────────────────────────────────────

const EXTRACT_PROMPT_PATH = path.resolve('prompts/memory/extract-turn.toon');
const COMPACT_PROMPT_PATH = path.resolve('prompts/memory/compact-section.toon');
const COMPACT_THRESHOLD_WORDS = 400;
const MAX_EXTRACT_TOKENS = 512;

// ── Types ────────────────────────────────────────────────────────────────────

interface ExtractedTurn {
  preferences: string[];
  persona_updates: {
    user_name: string | null;
    user_nickname: string | null;
    appearance: string | null;
    tone_example: string | null;
    other: string | null;
  };
  behavior: {
    prefers_short: boolean | null;
    often_asks_sources: boolean | null;
    tone_preference: string | null;
  };
  facts: string[];
}

const EMPTY_EXTRACTION: ExtractedTurn = {
  preferences: [],
  persona_updates: {
    user_name: null,
    user_nickname: null,
    appearance: null,
    tone_example: null,
    other: null,
  },
  behavior: {
    prefers_short: null,
    often_asks_sources: null,
    tone_preference: null,
  },
  facts: [],
};

// ── Prompt loading ────────────────────────────────────────────────────────────

function loadPromptTemplate(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  } catch { /* non-fatal */ }
  return '';
}

function buildExtractionPrompt(userMsg: string, assistantReply: string): string {
  const template = loadPromptTemplate(EXTRACT_PROMPT_PATH);
  if (template) {
    return template
      .replace('{{USER_MSG}}', userMsg.slice(0, 1000))
      .replace('{{ASSISTANT_REPLY}}', assistantReply.slice(0, 1000));
  }
  // Inline fallback if prompt file missing
  return [
    'Extract a JSON object from this conversation turn.',
    'Shape: {"preferences":[],"persona_updates":{"user_name":null,"user_nickname":null,"appearance":null,"tone_example":null,"other":null},"behavior":{"prefers_short":null,"often_asks_sources":null,"tone_preference":null},"facts":[]}',
    'Only emit non-null values when clearly evidenced. Return ONLY the JSON, no commentary.',
    `USER: ${userMsg.slice(0, 800)}`,
    `ASSISTANT: ${assistantReply.slice(0, 800)}`,
  ].join('\n');
}

function buildCompactPrompt(sectionContent: string): string {
  const template = loadPromptTemplate(COMPACT_PROMPT_PATH);
  if (template) {
    return template.replace('{{SECTION_CONTENT}}', sectionContent.slice(0, 4000));
  }
  return [
    'Compress this list into compact bullet points. Merge duplicates. Keep all unique facts. Output ONLY bullet points (- item), no headers.',
    sectionContent.slice(0, 4000),
  ].join('\n\n');
}

// ── JSON parsing ──────────────────────────────────────────────────────────────

function parseExtraction(raw: string): ExtractedTurn {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return EMPTY_EXTRACTION;
    const parsed = JSON.parse(match[0]) as Partial<ExtractedTurn>;
    return {
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences.filter(p => typeof p === 'string') : [],
      persona_updates: {
        user_name: parsed.persona_updates?.user_name ?? null,
        user_nickname: parsed.persona_updates?.user_nickname ?? null,
        appearance: parsed.persona_updates?.appearance ?? null,
        tone_example: parsed.persona_updates?.tone_example ?? null,
        other: parsed.persona_updates?.other ?? null,
      },
      behavior: {
        prefers_short: parsed.behavior?.prefers_short ?? null,
        often_asks_sources: parsed.behavior?.often_asks_sources ?? null,
        tone_preference: parsed.behavior?.tone_preference ?? null,
      },
      facts: Array.isArray(parsed.facts) ? parsed.facts.filter(f => typeof f === 'string') : [],
    };
  } catch {
    return EMPTY_EXTRACTION;
  }
}

// ── Section helpers ───────────────────────────────────────────────────────────

function readSection(filePath: string, header: string): string {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf-8');
  const rx = new RegExp(`(^|\\n)${escapeRegex(header)}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'm');
  const m = content.match(rx);
  return m ? (m[2] ?? '').trim() : '';
}

function writeSection(filePath: string, header: string, newContent: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let file = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const rx = new RegExp(`(^|\\n)(${escapeRegex(header)}\\s*\\n[\\s\\S]*?)(?=\\n##|$)`, 'm');

  if (rx.test(file)) {
    file = file.replace(rx, `$1${header}\n${newContent}`);
  } else {
    file = file.trimEnd() + `\n\n${header}\n${newContent}`;
  }

  fs.writeFileSync(filePath, file, 'utf-8');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

function mergePreferences(existing: string, additions: string[]): string {
  if (!additions.length) return existing;
  const existingLines = new Set(
    existing.split('\n').map(l => l.replace(/^-\s*/, '').trim().toLowerCase()),
  );
  const newLines: string[] = [];
  for (const pref of additions) {
    const key = pref.trim().toLowerCase();
    if (!existingLines.has(key)) {
      newLines.push(`- ${pref.trim()}`);
      existingLines.add(key);
    }
  }
  if (!newLines.length) return existing;
  return existing ? `${existing.trimEnd()}\n${newLines.join('\n')}` : newLines.join('\n');
}

// ── Persona supplement ────────────────────────────────────────────────────────

function readPersonaSupplement(groupDir: string): Record<string, string> {
  const filePath = path.join(groupDir, PERSONA_SUPPLEMENT_FILENAME);
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const sections: Record<string, string> = {};
  const rx = /^## ([^\n]+)\n([\s\S]*?)(?=^## |\s*$)/gm;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(content)) !== null) {
    sections[(m[1] ?? '').trim()] = (m[2] ?? '').trim();
  }
  return sections;
}

function writePersonaSupplement(groupDir: string, sections: Record<string, string>): void {
  const filePath = path.join(groupDir, PERSONA_SUPPLEMENT_FILENAME);
  fs.mkdirSync(groupDir, { recursive: true });
  const parts = Object.entries(sections)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `## ${k}\n${v.trim()}`);
  fs.writeFileSync(filePath, parts.join('\n\n') + '\n', 'utf-8');
}

function updatePersonaSupplement(groupDir: string, updates: ExtractedTurn['persona_updates']): void {
  const sections = readPersonaSupplement(groupDir);

  if (updates.user_name) {
    sections['User Name'] = updates.user_name;
  }
  if (updates.user_nickname) {
    const existing = sections['User Nickname'] ?? '';
    if (!existing.includes(updates.user_nickname)) {
      sections['User Nickname'] = updates.user_nickname;
    }
  }
  if (updates.appearance) {
    const existing = sections['Appearance'] ?? '';
    sections['Appearance'] = existing
      ? `${existing.trimEnd()}\n- ${updates.appearance}`
      : `- ${updates.appearance}`;
  }
  if (updates.tone_example) {
    const existing = sections['Tone Examples'] ?? '';
    sections['Tone Examples'] = existing
      ? `${existing.trimEnd()}\n- ${updates.tone_example}`
      : `- ${updates.tone_example}`;
  }
  if (updates.other) {
    const existing = sections['Notes'] ?? '';
    sections['Notes'] = existing
      ? `${existing.trimEnd()}\n- ${updates.other}`
      : `- ${updates.other}`;
  }

  if (Object.keys(sections).length) {
    writePersonaSupplement(groupDir, sections);
  }
}

// ── Behavior store ────────────────────────────────────────────────────────────

function updateBehaviorStore(groupDir: string, behavior: ExtractedTurn['behavior']): void {
  if (behavior.prefers_short === null && behavior.often_asks_sources === null && !behavior.tone_preference) {
    return;
  }

  const filePath = path.join(groupDir, BEHAVIOR_FILENAME);
  fs.mkdirSync(groupDir, { recursive: true });

  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';

  const update = (key: string, value: string): void => {
    const rx = new RegExp(`^(${escapeRegex(key)}:).*$`, 'm');
    if (rx.test(content)) {
      content = content.replace(rx, `$1 ${value}`);
    } else {
      content = content.trimEnd() + `\n${key}: ${value}`;
    }
  };

  if (behavior.prefers_short !== null) update('prefers_short', String(behavior.prefers_short));
  if (behavior.often_asks_sources !== null) update('often_asks_sources', String(behavior.often_asks_sources));
  if (behavior.tone_preference) update('tone_preference', behavior.tone_preference);

  fs.writeFileSync(filePath, content.trim() + '\n', 'utf-8');
}

// ── Memory facts ──────────────────────────────────────────────────────────────

function writeFacts(db: MicroClawDB, groupDir: string, groupId: string, facts: string[]): void {
  if (!facts.length) return;
  const memPath = path.join(groupDir, MEMORY_FILENAME);
  fs.mkdirSync(groupDir, { recursive: true });
  for (const fact of facts) {
    const safe = fact.replace(/["*(){}:^~]/g, ' ');
    db.insertMemoryChunk(randomUUID(), safe, groupId, 'fact');
    try {
      fs.appendFileSync(memPath, `\n- ${fact}`);
    } catch { /* non-fatal */ }
  }
}

// ── Compaction ────────────────────────────────────────────────────────────────

async function compactIfNeeded(
  content: string,
  onCompact: (compact: string) => void,
  provider: import('../providers/interface.js').IProviderAdapter,
  model: ModelEntry,
): Promise<void> {
  if (wordCount(content) < COMPACT_THRESHOLD_WORDS) return;
  try {
    const prompt = buildCompactPrompt(content);
    const result = await provider.complete({
      model: model.id,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: MAX_EXTRACT_TOKENS,
    });
    const compacted = result.content?.trim() ?? '';
    if (compacted && compacted.length < content.length) {
      onCompact(compacted);
    }
  } catch { /* non-fatal — original content preserved */ }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface ExtractorOptions {
  userMsg: string;
  assistantReply: string;
  groupId: string;
  db: MicroClawDB;
  registry: ProviderRegistry;
  catalog: ModelEntry[];
}

/**
 * Run post-turn extraction. Fire-and-forget safe — all errors swallowed.
 * Returns quickly; all heavy work is async.
 */
export async function extractAndPersist(opts: ExtractorOptions): Promise<void> {
  try {
    // Need a provider — prefer nano tier
    const nanoModels = opts.catalog.filter(m => m.tier === 'nano');
    const sel = selectModel(nanoModels.length ? nanoModels : opts.catalog, opts.userMsg);
    if (!sel) return;

    const provider = opts.registry.get(sel.model.provider_id);
    if (!provider) return;

    const extractionPrompt = buildExtractionPrompt(opts.userMsg, opts.assistantReply);

    const result = await provider.complete({
      model: sel.model.id,
      messages: [{ role: 'user', content: extractionPrompt }],
      maxTokens: MAX_EXTRACT_TOKENS,
    });

    const extracted = parseExtraction(result.content ?? '');
    const groupDir = path.join(GROUPS_DIR, opts.groupId);

    // ── 1. User Preferences → CLAUDE.md ──────────────────────────────────────
    if (extracted.preferences.length) {
      const current = readSection(GLOBAL_MEMORY_PATH, '## User Preferences');
      const merged = mergePreferences(current, extracted.preferences);
      writeSection(GLOBAL_MEMORY_PATH, '## User Preferences', merged);

      await compactIfNeeded(
        merged,
        (compact) => writeSection(GLOBAL_MEMORY_PATH, '## User Preferences', compact),
        provider,
        sel.model,
      );
    }

    // ── 2. Persona supplement ─────────────────────────────────────────────────
    const hasPersonaUpdate = Object.values(extracted.persona_updates).some(v => v !== null);
    if (hasPersonaUpdate) {
      updatePersonaSupplement(groupDir, extracted.persona_updates);
    }

    // ── 3. Behavior store ─────────────────────────────────────────────────────
    updateBehaviorStore(groupDir, extracted.behavior);

    // ── 4. Long-term facts → memory.md + FTS ─────────────────────────────────
    writeFacts(opts.db, groupDir, opts.groupId, extracted.facts);

  } catch { /* fire-and-forget — swallow all errors silently */ }
}

// ── Public helpers for persona_update tool and prompt-builder ─────────────────

/** Read the full persona supplement for a group as a string block */
export function readPersonaSupplementBlock(groupId: string): string {
  const groupDir = path.join(GROUPS_DIR, groupId);
  const filePath = path.join(groupDir, PERSONA_SUPPLEMENT_FILENAME);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8').trim();
}

/** Read the behavior store for a group — returns 1-2 hint lines */
export function readBehaviorHints(groupId: string): string {
  const filePath = path.join(GROUPS_DIR, groupId, BEHAVIOR_FILENAME);
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf-8');
  const hints: string[] = [];

  const prefShort = content.match(/^prefers_short:\s*(.+)$/m);
  if (prefShort?.[1]?.trim() === 'true') hints.push('User prefers short replies.');

  const asksSources = content.match(/^often_asks_sources:\s*(.+)$/m);
  if (asksSources?.[1]?.trim() === 'true') hints.push('User often asks for sources — consider citing or searching.');

  const tone = content.match(/^tone_preference:\s*(.+)$/m);
  if (tone?.[1]?.trim()) hints.push(`Preferred tone: ${tone[1].trim()}.`);

  return hints.join(' ');
}

/** Update a single field in the persona supplement — used by the persona_update tool */
export function updatePersonaField(groupId: string, field: string, value: string): void {
  const groupDir = path.join(GROUPS_DIR, groupId);
  const sections = readPersonaSupplement(groupDir);
  sections[field] = value;
  writePersonaSupplement(groupDir, sections);
}
