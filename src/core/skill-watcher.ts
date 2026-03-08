import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import chokidar from 'chokidar';
import { parseSkillFile } from './skill-parser.js';
import type { SkillDefinition } from './skill-parser.js';
import { onSkillFileCompat, onSkillFileRemoved, initSkillRegistry } from '../skills/compat-watcher.js';

const DEBOUNCE_MS = 50;
const SKILL_FILENAME = 'SKILL.md';

class SkillWatcher extends EventEmitter {
  private readonly skills: Map<string, SkillDefinition> = new Map();
  private readonly fileToCommand: Map<string, string> = new Map();
  private readonly debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private readonly skillsDir: string;

  constructor(skillsDir?: string) {
    super();
    this.skillsDir = resolve(skillsDir ?? 'skills');
  }

  watch(): void {
    initSkillRegistry();

    this.watcher = chokidar.watch(this.skillsDir, {
      persistent: true,
      ignoreInitial: false,
      depth: 99,
    });

    this.watcher.on('add', (filePath: string) => {
      if (this.isSkillFile(filePath)) {
        this.debouncedLoad(filePath);
      }
    });

    this.watcher.on('change', (filePath: string) => {
      if (this.isSkillFile(filePath)) {
        this.debouncedLoad(filePath);
      }
    });

    this.watcher.on('unlink', (filePath: string) => {
      if (this.isSkillFile(filePath)) {
        this.removeSkill(filePath);
      }
    });

    this.watcher.on('addDir', (dirPath: string) => {
      this.scanForSkills(dirPath);
    });
  }

  close(): void {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  getSkill(command: string): SkillDefinition | undefined {
    return this.skills.get(command);
  }

  listSkills(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  loadSkillDir(dirPath: string): void {
    const resolved = resolve(dirPath);
    for (const filePath of this.findSkillFiles(resolved)) {
      this.loadSkillFile(filePath);
    }
  }

  private isSkillFile(filePath: string): boolean {
    return basename(filePath) === SKILL_FILENAME;
  }

  private debouncedLoad(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.loadSkillFile(filePath);
    }, DEBOUNCE_MS);
    this.debounceTimers.set(filePath, timer);
  }

  private loadSkillFile(filePath: string): void {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const skill = parseSkillFile(content);

      const oldCommand = this.fileToCommand.get(filePath);
      if (oldCommand !== undefined && oldCommand !== skill.command) {
        this.skills.delete(oldCommand);
      }

      const isUpdate = this.skills.has(skill.command);
      this.skills.set(skill.command, skill);
      this.fileToCommand.set(filePath, skill.command);

      this.emit(isUpdate ? 'skill:updated' : 'skill:loaded', skill);

      void onSkillFileCompat(filePath);
    } catch {
      // Ignore unparseable or inaccessible files
    }
  }

  private removeSkill(filePath: string): void {
    const command = this.fileToCommand.get(filePath);
    if (command !== undefined) {
      const skill = this.skills.get(command);
      this.skills.delete(command);
      this.fileToCommand.delete(filePath);
      if (skill !== undefined) {
        this.emit('skill:removed', skill);
      }
    }
    onSkillFileRemoved(filePath);
  }

  private scanForSkills(dirPath: string): void {
    for (const filePath of this.findSkillFiles(dirPath)) {
      this.debouncedLoad(filePath);
    }
  }

  private findSkillFiles(dirPath: string): string[] {
    const results: string[] = [];
    try {
      if (!existsSync(dirPath)) return results;
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isFile() && entry.name === SKILL_FILENAME) {
          results.push(fullPath);
        } else if (entry.isDirectory()) {
          results.push(...this.findSkillFiles(fullPath));
        }
      }
    } catch {
      // Directory may not exist or be inaccessible
    }
    return results;
  }
}

export { SkillWatcher, DEBOUNCE_MS, SKILL_FILENAME };
export type { SkillDefinition };
