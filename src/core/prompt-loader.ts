import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { z } from 'zod';

const PromptPathSchema = z.string().min(1);
const PromptVarsSchema = z.record(z.string(), z.string());
const FileContentSchema = z.string();

const VERSION_COMMENT_RE = /^#\s*version:.+$/;

export class PromptLoader {
  private readonly cache: Map<string, string> = new Map();
  private watcher: FSWatcher | null = null;
  private readonly baseDir: string;
  private readonly debounceTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? resolve(process.cwd(), 'prompts');
  }

  private resolvePath(filePath: string): string {
    return resolve(this.baseDir, PromptPathSchema.parse(filePath));
  }

  private stripVersionComment(content: string): string {
    const newlineIdx = content.indexOf('\n');
    if (newlineIdx === -1) {
      return VERSION_COMMENT_RE.test(content) ? '' : content;
    }
    const firstLine = content.slice(0, newlineIdx);
    if (VERSION_COMMENT_RE.test(firstLine)) {
      return content.slice(newlineIdx + 1);
    }
    return content;
  }

  async load(filePath: string): Promise<string> {
    const resolved = this.resolvePath(filePath);

    const cached = this.cache.get(resolved);
    if (cached !== undefined) {
      return cached;
    }

    const raw = FileContentSchema.parse(await readFile(resolved, 'utf-8'));
    const content = this.stripVersionComment(raw);
    this.cache.set(resolved, content);
    return content;
  }

  async render(
    filePath: string,
    vars: Record<string, string>,
  ): Promise<string> {
    const validated = PromptVarsSchema.parse(vars);
    const template = await this.load(filePath);
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_match, key: string) => validated[key] ?? `{{${key}}}`,
    );
  }

  watch(): void {
    if (this.watcher) return;

    this.watcher = watch(this.baseDir, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', (changedPath: string) => {
      const existing = this.debounceTimers.get(changedPath);
      if (existing !== undefined) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.cache.delete(changedPath);
        this.debounceTimers.delete(changedPath);
      }, 50);

      this.debounceTimers.set(changedPath, timer);
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
}
