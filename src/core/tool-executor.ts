import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { MicroClawDB } from '../db.js';

const BLOCKED_CMDS = ['rm -rf /', 'mkfs', ':(){', '> /dev/sda'];

// Paths the agent must never read or list — API keys, creds, internal config
const BLOCKED_PATH_PATTERNS = [
  /\.env(\.|$)/i,           // .env, .env.local, .env.example, etc.
  /\.micro[\\/]/,           // .micro/ directory (pid, auth, logs, config)
  /microclaw\.db/i,         // raw SQLite DB
  /whatsapp-auth/i,         // Baileys session keys
  /creds\.json/i,           // any credentials file
  /pre-key-\d+\.json/i,     // Baileys pre-key files
];

// Shell command patterns that could leak secrets or damage the system
const BLOCKED_CMD_PATTERNS = [
  /^\s*(cat|bat|less|more|head|tail|nano|vi|vim)\s+.*\.env/i,  // reading .env files
  /\bprintenv\b/i,
  /\benv\b\s*$/,            // bare `env` command
  /\bexport\b.*=.*\$\{/,    // exfiltrating env vars
  /cat\s+.*\.micro\//i,
  /cat\s+microclaw\.db/i,
];

function isBlockedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return BLOCKED_PATH_PATTERNS.some(p => p.test(normalized));
}

function isBlockedCommand(cmd: string): boolean {
  return BLOCKED_CMD_PATTERNS.some(p => p.test(cmd));
}

const SECURITY_BLOCK_MSG = 'Access denied: this path contains sensitive system data and cannot be read by the agent.';

export type WhatsAppSendFn = (to: string, message: string) => Promise<void>;

export class ToolExecutor {
  constructor(
    private db: MicroClawDB,
    private groupId: string,
    private cwd: string = process.cwd(),
    private whatsappSend?: WhatsAppSendFn,
    private senderId?: string,
    private onCronChange?: () => void,
  ) {}

  async run(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        case 'write_file':    return this.writeFile(args['path'] as string, args['content'] as string);
        case 'read_file':     return this.readFile(args['path'] as string);
        case 'list_dir':      return this.listDir(args['path'] as string);
        case 'run_cmd':       return this.runCmd(args['cmd'] as string, args['cwd'] as string | undefined);
        case 'web_search':    return await this.webSearch(args['query'] as string);
        case 'send_whatsapp': return await this.sendWhatsApp(args['to'] as string, args['message'] as string);
        case 'cron_add':      return this.cronAdd(args['name'] as string, args['cron'] as string, args['instruction'] as string);
        case 'cron_list':     return this.cronList();
        case 'cron_delete':   return this.cronDelete(args['id'] as string);
        case 'get_skill':     return this.getSkill(args['command'] as string);
        case 'memory_save':   return this.memorySave(args['content'] as string);
        case 'memory_search': return this.memorySearch(args['query'] as string);
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
    if (isBlockedPath(filePath)) return SECURITY_BLOCK_MSG;
    const abs = path.resolve(this.cwd, filePath);
    if (isBlockedPath(abs)) return SECURITY_BLOCK_MSG;
    if (!fs.existsSync(abs)) return `File not found: ${abs}`;
    const content = fs.readFileSync(abs, 'utf-8');
    return content.length > 8000 ? content.slice(0, 8000) + '\n[truncated]' : content;
  }

  private listDir(dirPath: string): string {
    if (isBlockedPath(dirPath)) return SECURITY_BLOCK_MSG;
    const abs = path.resolve(this.cwd, dirPath);
    if (isBlockedPath(abs)) return SECURITY_BLOCK_MSG;
    if (!fs.existsSync(abs)) return `Not found: ${abs}`;
    return fs.readdirSync(abs, { withFileTypes: true })
      .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
      .join('\n') || '(empty)';
  }

  private runCmd(cmd: string, cwd?: string): string {
    for (const b of BLOCKED_CMDS) {
      if (cmd.includes(b)) return `Blocked: ${cmd}`;
    }
    if (isBlockedCommand(cmd)) return SECURITY_BLOCK_MSG;
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

  private async sendWhatsApp(to: string, message: string): Promise<string> {
    if (!this.whatsappSend) {
      return 'WhatsApp channel is not connected. Start the daemon with "microclaw start" and ensure WhatsApp is configured.';
    }
    await this.whatsappSend(to, message);
    return `Message sent to ${to}: "${message}"`;
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
    // Use senderId as group_id for cron tasks so the scheduler knows who to deliver to
    const targetGroup = this.senderId ?? this.groupId;
    this.db.insertScheduledTask({
      id,
      group_id: targetGroup,
      name,
      cron: cronExpr,
      instruction,
      enabled: 1,
      last_run: null,
      next_run: null,
    });
    this.onCronChange?.();
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

  private getSkill(command: string): string {
    const cmdName = command.replace(/^\//, '').trim();
    const skillPath = path.join(path.resolve('skills'), cmdName, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      // List available skills so the agent can pick the right name
      const skillsDir = path.resolve('skills');
      let available = '(none)';
      try {
        available = fs.readdirSync(skillsDir).join(', ');
      } catch { /* ignore */ }
      return `Skill '${cmdName}' not found. Available skills: ${available}`;
    }
    return fs.readFileSync(skillPath, 'utf-8');
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
