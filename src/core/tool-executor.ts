import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { MicroClawDB } from '../db.js';

const BLOCKED_CMDS = ['rm -rf /', 'mkfs', ':(){', '> /dev/sda'];

export class ToolExecutor {
  constructor(
    private db: MicroClawDB,
    private groupId: string,
    private cwd: string = process.cwd(),
  ) {}

  async run(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        case 'write_file':   return this.writeFile(args['path'] as string, args['content'] as string);
        case 'read_file':    return this.readFile(args['path'] as string);
        case 'list_dir':     return this.listDir(args['path'] as string);
        case 'run_cmd':      return this.runCmd(args['cmd'] as string, args['cwd'] as string | undefined);
        case 'web_search':   return await this.webSearch(args['query'] as string);
        case 'cron_add':     return this.cronAdd(args['name'] as string, args['cron'] as string, args['instruction'] as string);
        case 'cron_list':    return this.cronList();
        case 'cron_delete':  return this.cronDelete(args['id'] as string);
        case 'memory_save':  return this.memorySave(args['content'] as string);
        case 'memory_search':return this.memorySearch(args['query'] as string);
        default: return `Unknown tool: ${name}`;
      }
    } catch (e) {
      return `Error in ${name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private writeFile(filePath: string, content: string): string {
    const abs = path.resolve(this.cwd, filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    return `Written: ${abs} (${content.length} bytes)`;
  }

  private readFile(filePath: string): string {
    const abs = path.resolve(this.cwd, filePath);
    if (!fs.existsSync(abs)) return `File not found: ${abs}`;
    const content = fs.readFileSync(abs, 'utf-8');
    return content.length > 8000 ? content.slice(0, 8000) + '\n[truncated]' : content;
  }

  private listDir(dirPath: string): string {
    const abs = path.resolve(this.cwd, dirPath);
    if (!fs.existsSync(abs)) return `Not found: ${abs}`;
    return fs.readdirSync(abs, { withFileTypes: true })
      .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
      .join('\n') || '(empty)';
  }

  private runCmd(cmd: string, cwd?: string): string {
    for (const b of BLOCKED_CMDS) {
      if (cmd.includes(b)) return `Blocked: ${cmd}`;
    }
    const result = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: cwd ?? this.cwd,
      env: process.env,
    });
    const out = [
      `exit: ${result.status ?? -1}`,
      result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : '',
      result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : '',
    ].filter(Boolean).join('\n');
    return out || 'done (no output)';
  }

  private async webSearch(query: string): Promise<string> {
    const brave = process.env['BRAVE_API_KEY'];
    const serper = process.env['SERPER_API_KEY'];

    if (brave) {
      try {
        const r = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
          { headers: { 'X-Subscription-Token': brave, Accept: 'application/json' } },
        );
        const d = await r.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
        return (d.web?.results ?? []).map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${x.description}`).join('\n\n') || 'No results';
      } catch { /* fall through */ }
    }

    if (serper) {
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serper, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 5 }),
        });
        const d = await r.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
        return (d.organic ?? []).map((x, i) => `${i + 1}. ${x.title}\n${x.link}\n${x.snippet}`).join('\n\n') || 'No results';
      } catch { /* fall through */ }
    }

    return 'Web search unavailable. Add BRAVE_API_KEY or SERPER_API_KEY to .env';
  }

  private cronAdd(name: string, cronExpr: string, instruction: string): string {
    const id = randomUUID().slice(0, 8);
    this.db.insertScheduledTask({
      id,
      group_id: this.groupId,
      name,
      cron: cronExpr,
      instruction,
      enabled: 1,
      last_run: null,
      next_run: null,
    });
    return `Cron task added — id: ${id}, name: ${name}, schedule: ${cronExpr}`;
  }

  private cronList(): string {
    const tasks = this.db.getScheduledTasksByGroup(this.groupId);
    if (!tasks.length) return 'No scheduled tasks.';
    return tasks.map(t => `[${t.id}] ${t.name} (${t.cron}): ${t.instruction}`).join('\n');
  }

  private cronDelete(id: string): string {
    this.db.deleteScheduledTask(id, this.groupId);
    return `Task ${id} deleted.`;
  }

  private memorySave(content: string): string {
    const id = `mem_${Date.now()}`;
    const safe = content.replace(/["*(){}:^~]/g, ' ');
    this.db.insertMemoryChunk(id, safe, this.groupId, 'fact');
    const p = `groups/${this.groupId}/CLAUDE.md`;
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, `\n- ${content}`);
    } catch { /* non-fatal */ }
    return `Remembered: ${content}`;
  }

  private memorySearch(query: string): string {
    const safe = query.replace(/["*(){}:^~.\-/\\]/g, ' ').trim();
    if (!safe) return 'No results.';
    try {
      const rows = this.db.searchMemory(safe, this.groupId, 5);
      return rows.length ? rows.map(r => `- ${r.content}`).join('\n') : 'No memories found.';
    } catch {
      return 'Memory search unavailable.';
    }
  }
}
