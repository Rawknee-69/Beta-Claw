import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, writeFileSync, mkdirSync,
  unlinkSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkillFile } from '../../src/core/skill-parser.js';
import type { SkillDefinition } from '../../src/core/skill-parser.js';
import { SkillWatcher, DEBOUNCE_MS } from '../../src/core/skill-watcher.js';

const FULL_SKILL = `---
name: add-telegram
command: /add-telegram
description: Add Telegram as a communication channel
requiredEnvVars:
  - TELEGRAM_BOT_TOKEN
requiredTools:
  - write_file
  - run_code
platforms:
  - linux
  - macos
version: 1.0.0
author: microclaw
---

You are a skill that adds Telegram integration.`;

const MINIMAL_SKILL = `---
name: simple-skill
command: /simple
description: A simple skill
version: 1.0.0
author: test
---

Simple prompt.`;

const NO_OPTIONAL_SKILL = `---
name: nano-skill
command: /nano
description: NanoClaw compatible skill
version: 0.1.0
author: nanoclaw
---

NanoClaw prompt content.`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEvent(
  emitter: SkillWatcher,
  event: string,
  timeout = 5000,
): Promise<SkillDefinition> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${event}`)),
      timeout,
    );
    emitter.once(event, (skill: SkillDefinition) => {
      clearTimeout(timer);
      resolve(skill);
    });
  });
}

// ---------------------------------------------------------------------------
// skill-parser tests
// ---------------------------------------------------------------------------

describe('skill-parser', () => {
  it('parses valid SKILL.md with full frontmatter', () => {
    const result = parseSkillFile(FULL_SKILL);
    expect(result.name).toBe('add-telegram');
    expect(result.command).toBe('/add-telegram');
    expect(result.description).toBe('Add Telegram as a communication channel');
    expect(result.requiredEnvVars).toEqual(['TELEGRAM_BOT_TOKEN']);
    expect(result.requiredTools).toEqual(['write_file', 'run_code']);
    expect(result.platforms).toEqual(['linux', 'macos']);
    expect(result.version).toBe('1.0.0');
    expect(result.author).toBe('microclaw');
    expect(result.content).toBe('You are a skill that adds Telegram integration.');
  });

  it('parses SKILL.md without optional fields (NanoClaw compat)', () => {
    const result = parseSkillFile(NO_OPTIONAL_SKILL);
    expect(result.name).toBe('nano-skill');
    expect(result.command).toBe('/nano');
    expect(result.requiredEnvVars).toBeUndefined();
    expect(result.requiredTools).toBeUndefined();
    expect(result.platforms).toBeUndefined();
    expect(result.content).toBe('NanoClaw prompt content.');
  });

  it('parses SKILL.md with only required fields', () => {
    const result = parseSkillFile(MINIMAL_SKILL);
    expect(result.name).toBe('simple-skill');
    expect(result.command).toBe('/simple');
    expect(result.description).toBe('A simple skill');
    expect(result.version).toBe('1.0.0');
    expect(result.author).toBe('test');
    expect(result.requiredEnvVars).toBeUndefined();
    expect(result.requiredTools).toBeUndefined();
    expect(result.platforms).toBeUndefined();
  });

  it('rejects SKILL.md without name', () => {
    const content = `---
command: /broken
description: No name
version: 1.0.0
author: test
---

Prompt.`;
    expect(() => parseSkillFile(content)).toThrow();
  });

  it('rejects SKILL.md without command', () => {
    const content = `---
name: broken
description: No command
version: 1.0.0
author: test
---

Prompt.`;
    expect(() => parseSkillFile(content)).toThrow();
  });

  it('rejects SKILL.md without frontmatter delimiters', () => {
    expect(() => parseSkillFile('Just some text without frontmatter')).toThrow();
  });

  it('rejects SKILL.md without description', () => {
    const content = `---
name: broken
command: /broken
version: 1.0.0
author: test
---

Prompt.`;
    expect(() => parseSkillFile(content)).toThrow();
  });

  it('rejects SKILL.md without version', () => {
    const content = `---
name: broken
command: /broken
description: No version
author: test
---

Prompt.`;
    expect(() => parseSkillFile(content)).toThrow();
  });

  it('preserves multiline content body', () => {
    const content = `---
name: multi
command: /multi
description: Multi-line content
version: 1.0.0
author: test
---

Line 1.
Line 2.
Line 3.`;
    const result = parseSkillFile(content);
    expect(result.content).toBe('Line 1.\nLine 2.\nLine 3.');
  });

  it('validates platform values', () => {
    const content = `---
name: bad-platform
command: /bad-platform
description: Invalid platform
version: 1.0.0
author: test
platforms:
  - invalid_os
---

Prompt.`;
    expect(() => parseSkillFile(content)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// skill-watcher tests
// ---------------------------------------------------------------------------

describe('skill-watcher', () => {
  let tempDir: string;
  let watcher: SkillWatcher | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-watcher-'));
  });

  afterEach(() => {
    watcher?.close();
    watcher = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('registers skills from directory via loadSkillDir', () => {
    const skillDir = join(tempDir, 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), FULL_SKILL);

    watcher = new SkillWatcher(tempDir);
    watcher.loadSkillDir(tempDir);

    const skills = watcher.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('add-telegram');
  });

  it('lists all loaded skills', () => {
    const dir1 = join(tempDir, 'skill-a');
    const dir2 = join(tempDir, 'skill-b');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir1, 'SKILL.md'), FULL_SKILL);
    writeFileSync(join(dir2, 'SKILL.md'), MINIMAL_SKILL);

    watcher = new SkillWatcher(tempDir);
    watcher.loadSkillDir(tempDir);

    const skills = watcher.listSkills();
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['add-telegram', 'simple-skill']);
  });

  it('gets skill by command', () => {
    const skillDir = join(tempDir, 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), FULL_SKILL);

    watcher = new SkillWatcher(tempDir);
    watcher.loadSkillDir(tempDir);

    const skill = watcher.getSkill('/add-telegram');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('add-telegram');
  });

  it('returns undefined for unknown command', () => {
    watcher = new SkillWatcher(tempDir);
    expect(watcher.getSkill('/nonexistent')).toBeUndefined();
  });

  it('emits skill:loaded on new skill via chokidar', async () => {
    watcher = new SkillWatcher(tempDir);
    watcher.watch();

    const skillDir = join(tempDir, 'new-skill');
    mkdirSync(skillDir, { recursive: true });

    const loadedPromise = waitForEvent(watcher, 'skill:loaded');
    writeFileSync(join(skillDir, 'SKILL.md'), MINIMAL_SKILL);

    const skill = await loadedPromise;
    expect(skill.name).toBe('simple-skill');
    expect(skill.command).toBe('/simple');
  });

  it('hot-reload: file change triggers skill:updated', async () => {
    const skillDir = join(tempDir, 'hot-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), MINIMAL_SKILL);

    watcher = new SkillWatcher(tempDir);
    watcher.watch();

    await waitForEvent(watcher, 'skill:loaded');

    const updatedContent = `---
name: simple-skill
command: /simple
description: Updated description
version: 2.0.0
author: test
---

Updated prompt.`;

    const updatedPromise = waitForEvent(watcher, 'skill:updated');
    writeFileSync(join(skillDir, 'SKILL.md'), updatedContent);

    const skill = await updatedPromise;
    expect(skill.description).toBe('Updated description');
    expect(skill.version).toBe('2.0.0');
    expect(skill.content).toBe('Updated prompt.');
  });

  it('removes skill on unlink and emits skill:removed', async () => {
    const skillDir = join(tempDir, 'remove-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), MINIMAL_SKILL);

    watcher = new SkillWatcher(tempDir);
    watcher.watch();

    await waitForEvent(watcher, 'skill:loaded');
    expect(watcher.getSkill('/simple')).toBeDefined();

    const removedPromise = waitForEvent(watcher, 'skill:removed');
    unlinkSync(join(skillDir, 'SKILL.md'));

    const skill = await removedPromise;
    expect(skill.command).toBe('/simple');
    expect(watcher.getSkill('/simple')).toBeUndefined();
  });

  it('debounce prevents duplicate loads within window', async () => {
    const skillDir = join(tempDir, 'debounce-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), MINIMAL_SKILL);

    watcher = new SkillWatcher(tempDir);
    watcher.watch();

    await waitForEvent(watcher, 'skill:loaded');

    let updateCount = 0;
    watcher.on('skill:updated', () => { updateCount++; });

    for (let i = 0; i < 5; i++) {
      writeFileSync(join(skillDir, 'SKILL.md'), `---
name: simple-skill
command: /simple
description: Version ${i}
version: 1.0.${i}
author: test
---

Prompt ${i}.`);
      await sleep(10);
    }

    await sleep(DEBOUNCE_MS * 6);

    expect(updateCount).toBeGreaterThanOrEqual(1);
    expect(updateCount).toBeLessThan(5);

    const skill = watcher.getSkill('/simple');
    expect(skill?.version).toBe('1.0.4');
  });

  it('handles new subdirectory with SKILL.md via chokidar', async () => {
    watcher = new SkillWatcher(tempDir);
    watcher.watch();
    await sleep(100);

    const newDir = join(tempDir, 'added-dir');
    mkdirSync(newDir, { recursive: true });

    const loadedPromise = waitForEvent(watcher, 'skill:loaded');
    writeFileSync(join(newDir, 'SKILL.md'), MINIMAL_SKILL);

    const skill = await loadedPromise;
    expect(skill.command).toBe('/simple');
  });

  it('registration takes less than 10ms per skill', () => {
    watcher = new SkillWatcher(tempDir);
    const skillDir = join(tempDir, 'perf-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), FULL_SKILL);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      watcher.loadSkillDir(tempDir);
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 100).toBeLessThan(10);
  });
});
