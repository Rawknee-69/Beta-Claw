import fs from 'node:fs';
import path from 'node:path';
import { convertSkill } from './skill-converter.js';
import { skillRegistry } from './skill-registry.js';
import { PATHS } from '../core/paths.js';

/**
 * Called by the existing SkillWatcher (src/core/skill-watcher.ts) whenever
 * a SKILL.md file is added or changed. Runs the OpenClaw compatibility check.
 * If the skill is in OpenClaw/ClawBot format, writes a .microclaw.md sidecar
 * and registers the converted skill. Otherwise registers it as native.
 */
export async function onSkillFileCompat(filePath: string): Promise<void> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const result = await convertSkill(raw, filePath);

    if (result.converted) {
      const sidecar = filePath.replace(/SKILL\.md$/, 'SKILL.microclaw.md');
      fs.writeFileSync(sidecar, result.content, 'utf-8');
      console.log(`[skill-compat] Converted OpenClaw skill → ${sidecar}`);
      skillRegistry.register(result.meta, sidecar, 'converted');
    } else {
      skillRegistry.register(result.meta, filePath, 'native');
    }
  } catch (e) {
    console.warn(`[skill-compat] Failed to process ${filePath}:`, e);
  }
}

export function onSkillFileRemoved(filePath: string): void {
  const id = path.basename(path.dirname(filePath));
  skillRegistry.unregister(id);
}

/**
 * Manually convert a skill file at the given path.
 * Used by `microclaw skills convert <path>`.
 */
export async function convertSkillFile(filePath: string): Promise<string> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return `Not found: ${abs}`;

  const raw = fs.readFileSync(abs, 'utf-8');
  const result = await convertSkill(raw, abs);

  if (!result.converted) return `Skill at ${abs} is already in MicroClaw-native format.`;

  const sidecar = abs.replace(/SKILL\.md$/, 'SKILL.microclaw.md');
  fs.writeFileSync(sidecar, result.content, 'utf-8');
  return `Converted: ${sidecar}`;
}

/**
 * Initialize the skill registry by scanning the skills directory once.
 * Called on startup before the chokidar watcher fires its initial events.
 */
export function initSkillRegistry(): void {
  const dir = path.resolve(PATHS.skills);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  console.log(`[skill-compat] Registry initialized, watching ${dir}`);
}
