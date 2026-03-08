import fs from 'node:fs';
import type { SkillMeta } from './skill-converter.js';

interface RegistryEntry {
  meta:     SkillMeta;
  path:     string;
  status:   'native' | 'converted';
  loadedAt: number;
}

class SkillRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(meta: SkillMeta, filePath: string, status: 'native' | 'converted'): void {
    this.entries.set(meta.name, { meta, path: filePath, status, loadedAt: Date.now() });
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  all(): RegistryEntry[] {
    return [...this.entries.values()];
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name);
  }

  toPromptXml(): string {
    const items = this.all().map(e =>
      `<skill name="${e.meta.name}" cmd="${e.meta.command}">${e.meta.description}</skill>`,
    ).join('\n');
    return items ? `<skills>\n${items}\n</skills>` : '';
  }

  body(name: string): string {
    const entry = this.get(name);
    if (!entry) return '';
    return fs.existsSync(entry.path) ? fs.readFileSync(entry.path, 'utf-8') : '';
  }
}

export const skillRegistry = new SkillRegistry();
export type { RegistryEntry };
