import fs from 'fs';
import path from 'path';
import type { SandboxRunOptions } from '../execution/sandbox.js';
import { sandboxedExec } from '../execution/sandbox.js';
import { PATHS } from './paths.js';
import { scoreSuspicion, formatSuspicionWarning } from '../security/suspicious-command.js';
import { runBrowserAction } from '../browser/browser-tool.js';

const BLOCKED = ['rm -rf /', 'mkfs', ':(){', '> /dev/sda', 'dd if=/dev/zero'];

export type ApprovalCallback = (warning: string) => Promise<boolean>;

export class ToolExecutor {
  onApprovalRequired?: ApprovalCallback;

  constructor(
    private groupId: string,
    private cwd: string = process.cwd(),
    private sandboxOpts: SandboxRunOptions,
  ) {}

  async run(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        case 'read':         return this.read(args['path'] as string, args['offset'] as number | undefined, args['limit'] as number | undefined);
        case 'write':        return this.write(args['path'] as string, args['content'] as string);
        case 'exec':         return await this.exec(args['cmd'] as string, args['cwd'] as string | undefined, args['timeout'] as number | undefined);
        case 'list':         return this.list(args['path'] as string, args['recursive'] as boolean | undefined);
        case 'web_search':   return await this.webSearch(args['query'] as string);
        case 'web_fetch':    return await this.webFetch(args['url'] as string, args['method'] as string | undefined, args['headers'] as Record<string,string> | undefined, args['body'] as string | undefined);
        case 'memory_read':  return this.memoryRead();
        case 'memory_write': return this.memoryWrite(args['content'] as string);
        case 'browser':      return await runBrowserAction(args);
        default:             return `Unknown tool: ${name}`;
      }
    } catch (e) {
      return `Tool error [${name}]: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private read(filePath: string, offset?: number, limit?: number): string {
    const abs = path.resolve(this.cwd, filePath);
    if (!fs.existsSync(abs)) return `Not found: ${abs}`;
    let content = fs.readFileSync(abs, 'utf-8');
    if (offset) content = content.slice(offset);
    const cap = limit ?? 8000;
    return content.length > cap ? content.slice(0, cap) + '\n[truncated]' : content;
  }

  private write(filePath: string, content: string): string {
    const abs = path.resolve(this.cwd, filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    return `Written: ${abs} (${content.length} bytes)`;
  }

  private async exec(cmd: string, cwd?: string, timeout = 30_000): Promise<string> {
    for (const b of BLOCKED) {
      if (cmd.includes(b)) return 'Blocked: dangerous command pattern detected';
    }

    const suspicion = scoreSuspicion(cmd);

    if (suspicion.blocked) {
      return `🚫 BLOCKED: ${suspicion.reasons.join(', ')}\nCommand refused: ${cmd.slice(0, 200)}`;
    }

    if (suspicion.askUser && this.onApprovalRequired) {
      const warning  = formatSuspicionWarning(cmd, suspicion);
      const approved = await this.onApprovalRequired(warning);
      if (!approved) return 'Command cancelled by user.';
    }

    return sandboxedExec(cmd, cwd ?? this.cwd, this.sandboxOpts, timeout);
  }

  private list(dirPath: string, recursive = false): string {
    const abs = path.resolve(this.cwd, dirPath);
    if (!fs.existsSync(abs)) return `Not found: ${abs}`;
    if (!recursive) {
      return fs.readdirSync(abs, { withFileTypes: true })
        .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
        .join('\n') || '(empty)';
    }
    const results: string[] = [];
    const walk = (dir: string, prefix = '') => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        results.push(`${e.isDirectory() ? 'd' : 'f'} ${prefix}${e.name}`);
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      }
    };
    walk(abs);
    return results.join('\n') || '(empty)';
  }

  private async webSearch(query: string): Promise<string> {
    const brave = process.env['BRAVE_API_KEY'];
    const serper = process.env['SERPER_API_KEY'];
    if (!brave && !serper) return 'No search API configured. Add BRAVE_API_KEY or SERPER_API_KEY to .env';
    if (brave) {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: { 'X-Subscription-Token': brave, Accept: 'application/json' },
      });
      const d = await r.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
      return (d.web?.results ?? []).map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.description}`).join('\n\n') || 'No results';
    }
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': serper!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    const d = await r.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
    return (d.organic ?? []).map((x, i) => `${i + 1}. ${x.title}\n   ${x.link}\n   ${x.snippet}`).join('\n\n') || 'No results';
  }

  private async webFetch(url: string, method = 'GET', headers?: Record<string,string>, body?: string): Promise<string> {
    const r = await fetch(url, { method, headers, body });
    const text = await r.text();
    return text.length > 12000 ? text.slice(0, 12000) + '\n[truncated]' : text;
  }

  private memoryRead(): string {
    const p = PATHS.memory(this.groupId);
    if (!fs.existsSync(p)) return '(no memory yet)';
    return fs.readFileSync(p, 'utf-8');
  }

  private memoryWrite(content: string): string {
    const p = PATHS.memory(this.groupId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `\n- ${content}`);
    return `Remembered: ${content}`;
  }
}
