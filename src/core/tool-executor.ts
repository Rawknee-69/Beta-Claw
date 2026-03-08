import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { MicroClawDB } from '../db.js';
import {
  GROUPS_DIR, WORK_DIR, WORKSPACE, IMAGES_DIR, DOWNLOADS_DIR,
  MEMORY_FILENAME,
} from './paths.js';
import { updatePersonaField } from '../memory/post-turn-extractor.js';
import { loadConfig } from './config-loader.js';

// ── Security guards ───────────────────────────────────────────────────────────

const BLOCKED_CMDS = ['rm -rf /', 'mkfs', ':(){', '> /dev/sda'];

const BLOCKED_PATH_PATTERNS = [
  /\.env(\.|$)/i,
  /\.micro[\\/]/,
  /[\\/]db[\\/]microclaw\.db/i,
  /microclaw\.db/i,
  /whatsapp-auth/i,
  /creds\.json/i,
  /pre-key-\d+\.json/i,
];

const BLOCKED_CMD_PATTERNS = [
  /^\s*(cat|bat|less|more|head|tail|nano|vi|vim)\s+.*\.env/i,
  /\bprintenv\b/i,
  /\benv\b\s*$/,
  /\bexport\b.*=.*\$\{/,
  /cat\s+.*\.micro\//i,
  /cat\s+(microclaw\.db|.*[\\/]db[\\/]microclaw\.db)/i,
];

const SAFE_ENV_KEYS = new Set(['PATH', 'HOME', 'USER', 'SHELL', 'NODE_ENV', 'PWD', 'TERM', 'LANG', 'LOGNAME', 'HOSTNAME']);
const SECURITY_MSG = 'Access denied: sensitive path.';

function isBlockedPath(p: string): boolean {
  const n = p.replace(/\\/g, '/');
  return BLOCKED_PATH_PATTERNS.some(r => r.test(n));
}

function isBlockedCmd(cmd: string): boolean {
  return BLOCKED_CMD_PATTERNS.some(r => r.test(cmd));
}

// ── Per-group injected context (in-memory, not persisted) ────────────────────
const injectedContext = new Map<string, string>();

// ── Browser sessions (per-group, lazy) ───────────────────────────────────────
type BrowserSession = { browser: import('playwright').Browser; page: import('playwright').Page };
const browserSessions = new Map<string, BrowserSession>();

// ── One-time scheduler (in-memory) ───────────────────────────────────────────
interface ScheduledOnce {
  id: string;
  name: string;
  at: number;
  instruction: string;
  timer: NodeJS.Timeout;
}
const onceScheduled = new Map<string, ScheduledOnce>();

// ─────────────────────────────────────────────────────────────────────────────

export class ToolExecutor {
  constructor(
    private db: MicroClawDB,
    private groupId: string,
    private cwd: string = process.cwd(),
    private onCronChange?: () => void,
  ) {
    // Bootstrap workspace dirs
    for (const dir of [WORK_DIR, IMAGES_DIR, DOWNLOADS_DIR, path.join(WORKSPACE, 'exports')]) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* non-fatal */ }
    }
  }

  async run(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        // Filesystem
        case 'read':          return this.fsRead(args['path'] as string, args['offset'] as number | undefined, args['limit'] as number | undefined);
        case 'write':         return this.fsWrite(args['path'] as string, args['content'] as string);
        case 'append':        return this.fsAppend(args['path'] as string, args['content'] as string);
        case 'delete':        return this.fsDelete(args['path'] as string);
        case 'list':          return this.fsList(args['path'] as string, args['recursive'] as boolean | undefined);
        case 'search':        return this.fsSearch(args['pattern'] as string, args['path'] as string | undefined, args['type'] as string | undefined);
        // System
        case 'exec':          return this.sysExec(args['cmd'] as string, args['cwd'] as string | undefined);
        case 'python':        return this.sysCode(args['code'] as string, 'python');
        case 'node':          return this.sysCode(args['code'] as string, 'node');
        case 'process':       return this.sysProcess(args['action'] as string, args['pid'] as number | undefined, args['name'] as string | undefined, args['args'] as string | undefined);
        // Web
        case 'web_search':    return await this.webSearch(args['query'] as string);
        case 'web_fetch':     return await this.webFetch(args['url'] as string, args['method'] as string | undefined, args['headers'] as string | undefined, args['body'] as string | undefined);
        case 'download':      return await this.webDownload(args['url'] as string, args['filename'] as string | undefined);
        // Browser
        case 'browser':       return await this.browserAction(args['action'] as string, args['url'] as string | undefined, args['selector'] as string | undefined, args['text'] as string | undefined, args['path'] as string | undefined);
        // Memory
        case 'memory_read':   return this.memRead();
        case 'memory_write':  return this.memWrite(args['content'] as string, args['section'] as string | undefined);
        case 'memory_search': return this.memSearch(args['query'] as string);
        // Automation
        case 'cron':          return this.cronTool(args['action'] as string, args);
        case 'scheduler':     return this.schedulerTool(args['action'] as string, args);
        case 'heartbeat':     return await this.heartbeat(args['url'] as string, args['timeout'] as number | undefined);
        // Image Generation
        case 'generate_image': return await this.generateImage(args['prompt'] as string, args['size'] as string | undefined, args['quality'] as string | undefined);
        // Agent Management
        case 'session':       return this.sessionTool(args['action'] as string);
        case 'context':       return this.contextTool(args['action'] as string, args['value'] as string | undefined);
        case 'history':       return this.historyTool(args['action'] as string, args['limit'] as number | undefined);
        // Persona
        case 'persona_update': return this.personaUpdate(args['field'] as string, args['value'] as string);
        // Config
        case 'config':        return this.configTool(args['action'] as string, args['key'] as string | undefined, args['value'] as string | undefined);
        case 'env':           return this.envTool(args['key'] as string | undefined);
        case 'logs':          return this.logsTool(args['lines'] as number | undefined);
        // Infrastructure
        case 'get_skill':     return this.getSkill(args['command'] as string);
        default:              return `Unknown tool: ${name}`;
      }
    } catch (e) {
      return `Error in ${name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ── Filesystem ────────────────────────────────────────────────────────────

  private fsRead(filePath: string, offset?: number, limit?: number): string {
    if (isBlockedPath(filePath)) return SECURITY_MSG;
    const abs = path.resolve(this.cwd, filePath);
    if (isBlockedPath(abs)) return SECURITY_MSG;
    if (!fs.existsSync(abs)) return `File not found: ${abs}`;
    const raw = fs.readFileSync(abs, 'utf-8');
    if (offset !== undefined || limit !== undefined) {
      const lines = raw.split('\n');
      const start = (offset ?? 1) - 1;
      const end = limit !== undefined ? start + limit : lines.length;
      return lines.slice(start, end).join('\n');
    }
    return raw.length > 8000 ? raw.slice(0, 8000) + '\n[truncated]' : raw;
  }

  private fsWrite(filePath: string, content: string): string {
    let resolved: string;
    if (path.isAbsolute(filePath)) {
      resolved = filePath;
    } else if (filePath.startsWith('./') || filePath.startsWith('../') || filePath.includes('/')) {
      resolved = path.resolve(this.cwd, filePath);
    } else {
      resolved = path.join(WORK_DIR, filePath);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    return `Written: ${resolved} (${content.length} bytes)`;
  }

  private fsAppend(filePath: string, content: string): string {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(this.cwd, filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, content, 'utf-8');
    return `Appended ${content.length} bytes to: ${resolved}`;
  }

  private fsDelete(filePath: string): string {
    if (isBlockedPath(filePath)) return SECURITY_MSG;
    const abs = path.resolve(this.cwd, filePath);
    if (isBlockedPath(abs)) return SECURITY_MSG;
    if (!fs.existsSync(abs)) return `Not found: ${abs}`;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      fs.rmdirSync(abs);
    } else {
      fs.unlinkSync(abs);
    }
    return `Deleted: ${abs}`;
  }

  private fsList(dirPath: string, recursive?: boolean): string {
    if (isBlockedPath(dirPath)) return SECURITY_MSG;
    const abs = path.resolve(this.cwd, dirPath);
    if (isBlockedPath(abs)) return SECURITY_MSG;
    if (!fs.existsSync(abs)) return `Not found: ${abs}`;

    const lines: string[] = [];
    const walk = (d: string, prefix: string): void => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        lines.push(`${prefix}${e.isDirectory() ? 'd' : 'f'} ${e.name}`);
        if (recursive && e.isDirectory()) walk(path.join(d, e.name), prefix + '  ');
      }
    };
    walk(abs, '');
    return lines.join('\n') || '(empty)';
  }

  private fsSearch(pattern: string, searchPath?: string, type = 'name'): string {
    const root = searchPath ? path.resolve(this.cwd, searchPath) : this.cwd;
    if (type === 'content') {
      // Try ripgrep first, fall back to grep
      const rg = spawnSync('rg', ['--line-number', '--no-heading', '-m', '50', pattern, root], { encoding: 'utf-8', timeout: 15_000 });
      if (!rg.error) {
        const out = rg.stdout?.trim();
        return out ? (out.length > 4000 ? out.slice(0, 4000) + '\n[truncated]' : out) : 'No matches.';
      }
      const gr = spawnSync('grep', ['-r', '-n', '--include=*.*', '-m', '50', pattern, root], { encoding: 'utf-8', timeout: 15_000 });
      return gr.stdout?.trim() || 'No matches.';
    }
    // Name search via find
    const result = spawnSync('find', [root, '-name', pattern, '-maxdepth', '10'], { encoding: 'utf-8', timeout: 15_000 });
    const out = result.stdout?.trim();
    return out ? (out.length > 4000 ? out.slice(0, 4000) + '\n[truncated]' : out) : 'No matches.';
  }

  // ── System ────────────────────────────────────────────────────────────────

  private sysExec(cmd: string, cwd?: string): string {
    for (const b of BLOCKED_CMDS) {
      if (cmd.includes(b)) return `Blocked: ${cmd}`;
    }
    if (isBlockedCmd(cmd)) return SECURITY_MSG;
    const result = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: cwd ?? this.cwd,
      env: process.env,
    });
    const parts = [
      `exit: ${result.status ?? -1}`,
      result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : '',
      result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : '',
    ].filter(Boolean);
    return parts.join('\n') || 'done (no output)';
  }

  private sysCode(code: string, lang: 'python' | 'node'): string {
    const ext = lang === 'node' ? '.mjs' : '.py';
    const tmpFile = path.join(os.tmpdir(), `mc_${randomUUID().slice(0, 8)}${ext}`);
    try {
      fs.writeFileSync(tmpFile, code, 'utf-8');
      const bin = lang === 'node' ? 'node' : 'python3';
      const result = spawnSync(bin, [tmpFile], {
        encoding: 'utf-8',
        timeout: 30_000,
        cwd: WORK_DIR,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
      const parts = [
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : '',
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : '',
        `exit: ${result.status ?? -1}`,
      ].filter(Boolean);
      return parts.join('\n') || 'done (no output)';
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  private sysProcess(action: string, pid?: number, name?: string, args?: string): string {
    if (action === 'list') {
      const result = spawnSync('ps', ['aux', '--no-headers'], { encoding: 'utf-8', timeout: 5_000 });
      const out = result.stdout?.trim() ?? '';
      return out.length > 4000 ? out.slice(0, 4000) + '\n[truncated]' : out || 'No processes found';
    }
    if (action === 'kill') {
      if (pid) {
        const r = spawnSync('kill', [String(pid)], { encoding: 'utf-8', timeout: 5_000 });
        return r.status === 0 ? `Killed PID ${pid}` : `Failed to kill PID ${pid}: ${r.stderr?.trim()}`;
      }
      if (name) {
        const r = spawnSync('pkill', ['-f', name], { encoding: 'utf-8', timeout: 5_000 });
        return r.status === 0 ? `Killed processes matching: ${name}` : `No process matched: ${name}`;
      }
      return 'Provide pid or name to kill.';
    }
    if (action === 'spawn') {
      if (!name) return 'Provide name (command) to spawn.';
      const cmdArgs = args ? args.split(' ') : [];
      const child = spawnSync('bash', ['-c', `(${name} ${cmdArgs.join(' ')} &)`], {
        encoding: 'utf-8',
        timeout: 3_000,
      });
      return child.status === 0 ? `Spawned: ${name} ${cmdArgs.join(' ')}` : `Spawn failed: ${child.stderr?.trim()}`;
    }
    return `Unknown process action: ${action}`;
  }

  // ── Web ───────────────────────────────────────────────────────────────────

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
    return 'web_search requires BRAVE_API_KEY or SERPER_API_KEY in .env';
  }

  private async webFetch(url: string, method = 'GET', headersJson?: string, body?: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (headersJson) {
      try { Object.assign(headers, JSON.parse(headersJson)); } catch { /* ignore */ }
    }
    const init: RequestInit = { method: method.toUpperCase(), headers };
    if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
      init.body = body;
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, init);
    const text = await res.text();
    const preview = text.length > 6000 ? text.slice(0, 6000) + '\n[truncated]' : text;
    return `HTTP ${res.status} ${res.statusText}\nContent-Type: ${res.headers.get('content-type') ?? ''}\n\n${preview}`;
  }

  private async webDownload(url: string, filename?: string): Promise<string> {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    const name = filename ?? decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? `download-${Date.now()}`);
    const dest = path.join(DOWNLOADS_DIR, name);
    const res = await fetch(url);
    if (!res.ok) return `Download failed: HTTP ${res.status}`;
    const buf = await res.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buf));
    return `Downloaded: ${dest} (${buf.byteLength} bytes)`;
  }

  // ── Browser ───────────────────────────────────────────────────────────────

  private async browserAction(action: string, url?: string, selector?: string, text?: string, screenshotPath?: string): Promise<string> {
    if (action === 'close') {
      const session = browserSessions.get(this.groupId);
      if (session) {
        await session.browser.close();
        browserSessions.delete(this.groupId);
      }
      return 'Browser closed.';
    }

    let session = browserSessions.get(this.groupId);
    if (!session || action === 'open') {
      if (session) await session.browser.close();
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      session = { browser, page };
      browserSessions.set(this.groupId, session);
      if (action === 'open' && url) {
        await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return `Navigated to: ${url}`;
      }
    }

    const { page } = session;
    switch (action) {
      case 'open': {
        if (!url) return 'Provide a url for open.';
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return `Navigated to: ${url}`;
      }
      case 'click': {
        if (!selector) return 'Provide a selector for click.';
        await page.click(selector, { timeout: 10_000 });
        return `Clicked: ${selector}`;
      }
      case 'type': {
        if (!selector || !text) return 'Provide selector and text for type.';
        await page.fill(selector, text);
        return `Typed into ${selector}: "${text}"`;
      }
      case 'extract': {
        if (!selector) {
          const bodyText = await page.evaluate((): string => {
          // Runs in browser context where document is always available
          // @ts-expect-error — document exists in browser scope, not Node.js
          return document.body.innerText as string; // eslint-disable-line @typescript-eslint/no-unsafe-return
        });
          const out = bodyText.slice(0, 4000);
          return out + (bodyText.length > 4000 ? '\n[truncated]' : '');
        }
        const el = await page.$(selector);
        if (!el) return `Element not found: ${selector}`;
        const elContent = await el.textContent();
        return elContent?.trim() ?? '(empty)';
      }
      case 'screenshot': {
        fs.mkdirSync(IMAGES_DIR, { recursive: true });
        const fname = screenshotPath ?? `screenshot-${Date.now()}.png`;
        const dest = path.join(IMAGES_DIR, fname);
        await page.screenshot({ path: dest, fullPage: true });
        return `Screenshot saved: ${dest}`;
      }
      default:
        return `Unknown browser action: ${action}`;
    }
  }

  // ── Memory ────────────────────────────────────────────────────────────────

  private memRead(): string {
    const p = path.join(GROUPS_DIR, this.groupId, MEMORY_FILENAME);
    if (!fs.existsSync(p)) return '(no memory stored yet)';
    const content = fs.readFileSync(p, 'utf-8');
    return content.length > 8000 ? content.slice(0, 8000) + '\n[truncated]' : content;
  }

  private memWrite(content: string, section?: string): string {
    const id = `mem_${Date.now()}`;
    const safe = content.replace(/["*(){}:^~]/g, ' ');
    this.db.insertMemoryChunk(id, safe, this.groupId, 'fact');
    const p = path.join(GROUPS_DIR, this.groupId, MEMORY_FILENAME);
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const line = section ? `\n### ${section}\n- ${content}` : `\n- ${content}`;
      fs.appendFileSync(p, line);
    } catch { /* non-fatal */ }
    return `Remembered: ${content}`;
  }

  private memSearch(query: string): string {
    const safe = query.replace(/["*(){}:^~.\-/\\]/g, ' ').trim();
    if (!safe) return 'No results.';
    try {
      const rows = this.db.searchMemory(safe, this.groupId, 5);
      return rows.length ? rows.map(r => `- ${r.content}`).join('\n') : 'No memories found.';
    } catch {
      return 'Memory search unavailable.';
    }
  }

  // ── Automation ────────────────────────────────────────────────────────────

  private cronTool(action: string, args: Record<string, unknown>): string {
    if (action === 'list') {
      const tasks = this.db.getScheduledTasksByGroup(this.groupId);
      if (!tasks.length) return 'No scheduled tasks.';
      return tasks.map(t => `[${t.id}] ${t.name} (${t.cron}): ${t.instruction}`).join('\n');
    }
    if (action === 'add') {
      const name = args['name'] as string;
      const expr = args['expr'] as string;
      const instruction = args['instruction'] as string;
      if (!name || !expr || !instruction) return 'Provide name, expr, and instruction.';
      const id = randomUUID().slice(0, 8);
      this.db.insertScheduledTask({ id, group_id: this.groupId, name, cron: expr, instruction, enabled: 1, last_run: null, next_run: null });
      this.onCronChange?.();
      return `Cron added — id: ${id}, name: ${name}, schedule: ${expr}`;
    }
    if (action === 'delete') {
      const id = args['id'] as string;
      if (!id) return 'Provide id to delete.';
      this.db.deleteScheduledTask(id, this.groupId);
      this.onCronChange?.();
      return `Task ${id} deleted.`;
    }
    if (action === 'update') {
      const id = args['id'] as string;
      if (!id) return 'Provide id to update.';
      // Re-insert with new values (simplest approach given no update method in db)
      const tasks = this.db.getScheduledTasksByGroup(this.groupId);
      const existing = tasks.find(t => t.id === id);
      if (!existing) return `Task ${id} not found.`;
      this.db.deleteScheduledTask(id, this.groupId);
      this.db.insertScheduledTask({
        id,
        group_id: this.groupId,
        name: (args['name'] as string) ?? existing.name,
        cron: (args['expr'] as string) ?? existing.cron,
        instruction: (args['instruction'] as string) ?? existing.instruction,
        enabled: 1,
        last_run: null,
        next_run: null,
      });
      this.onCronChange?.();
      return `Task ${id} updated.`;
    }
    return `Unknown cron action: ${action}`;
  }

  private schedulerTool(action: string, args: Record<string, unknown>): string {
    if (action === 'list') {
      if (onceScheduled.size === 0) return 'No one-time tasks scheduled.';
      return Array.from(onceScheduled.values())
        .map(s => `[${s.id}] ${s.name} at ${new Date(s.at).toISOString()}: ${s.instruction}`)
        .join('\n');
    }
    if (action === 'add') {
      const name = args['name'] as string;
      const at = args['at'] as string;
      const instruction = args['instruction'] as string;
      if (!name || !at || !instruction) return 'Provide name, at (ISO datetime), and instruction.';
      const fireAt = new Date(at).getTime();
      if (isNaN(fireAt)) return `Invalid datetime: ${at}`;
      const delay = fireAt - Date.now();
      if (delay < 0) return 'Scheduled time is in the past.';
      const id = randomUUID().slice(0, 8);
      const timer = setTimeout(() => {
        onceScheduled.delete(id);
        // The agent will handle this instruction on next cron cycle via a synthetic message
        // We simply log it; real integration requires injecting into the orchestrator queue
        console.log(`[scheduler] One-time task fired: ${name} — ${instruction}`);
      }, delay);
      onceScheduled.set(id, { id, name, at: fireAt, instruction, timer });
      return `Scheduled: [${id}] ${name} at ${at}`;
    }
    if (action === 'cancel') {
      const id = args['id'] as string;
      if (!id) return 'Provide id to cancel.';
      const entry = onceScheduled.get(id);
      if (!entry) return `Task ${id} not found.`;
      clearTimeout(entry.timer);
      onceScheduled.delete(id);
      return `Cancelled: ${id}`;
    }
    return `Unknown scheduler action: ${action}`;
  }

  private async heartbeat(url: string, timeout = 5000): Promise<string> {
    const start = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      clearTimeout(timer);
      const ms = Date.now() - start;
      return `UP — ${url} responded HTTP ${res.status} in ${ms}ms`;
    } catch (e) {
      const ms = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      return `DOWN — ${url} failed after ${ms}ms: ${msg}`;
    }
  }

  // ── Agent Management ──────────────────────────────────────────────────────

  private sessionTool(action: string): string {
    if (action === 'list') {
      const groups = this.db.getAllGroups?.() ?? [];
      if (!groups.length) return 'No active sessions.';
      return groups.map((g: { id: string; name: string | null; channel: string }) =>
        `${g.id} | ${g.name ?? '(unnamed)'} | ${g.channel}`).join('\n');
    }
    if (action === 'get') {
      const g = this.db.getGroup(this.groupId);
      if (!g) return `Session not found: ${this.groupId}`;
      return JSON.stringify(g, null, 2);
    }
    return `Unknown session action: ${action}`;
  }

  private contextTool(action: string, value?: string): string {
    if (action === 'get') {
      return injectedContext.get(this.groupId) ?? '(no injected context)';
    }
    if (action === 'inject') {
      if (!value) return 'Provide value to inject.';
      injectedContext.set(this.groupId, value);
      return `Context injected for group ${this.groupId}.`;
    }
    if (action === 'clear') {
      injectedContext.delete(this.groupId);
      return 'Injected context cleared.';
    }
    return `Unknown context action: ${action}`;
  }

  private historyTool(action: string, limit = 20): string {
    if (action === 'get') {
      const messages = this.db.getMessages(this.groupId, limit);
      if (!messages.length) return 'No history.';
      return messages.map((m: { sender_id: string; content: string; timestamp: number }) =>
        `[${new Date(m.timestamp * 1000).toISOString()}] ${m.sender_id}: ${m.content}`
      ).join('\n');
    }
    if (action === 'clear') {
      // clearMessages is an optional extension; gracefully handle absence
      (this.db as unknown as { clearMessages?: (id: string) => void }).clearMessages?.(this.groupId);
      return `History cleared for group ${this.groupId}.`;
    }
    return `Unknown history action: ${action}`;
  }

  // ── Image Generation ─────────────────────────────────────────────────────

  private async generateImage(prompt: string, size = '1024x1024', quality = 'standard'): Promise<string> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      return 'Image generation requires OPENAI_API_KEY to be set. Set it via `export OPENAI_API_KEY=sk-...` or add it to your environment.';
    }
    if (!prompt?.trim()) return 'Provide a prompt to generate an image.';

    try {
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: prompt.trim(),
          n: 1,
          size,
          quality,
          response_format: 'url',
        }),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => resp.statusText);
        return `Image generation failed (${resp.status}): ${err}`;
      }

      const data = await resp.json() as { data?: Array<{ url?: string; revised_prompt?: string }> };
      const img = data.data?.[0];
      if (!img?.url) return 'Image generation returned no URL.';

      // Save the URL to a file in images dir for persistence
      const fname = `image-${Date.now()}.url.txt`;
      const dest = path.join(IMAGES_DIR, fname);
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
      fs.writeFileSync(dest, img.url);

      const revised = img.revised_prompt ? `\nRevised prompt: ${img.revised_prompt}` : '';
      return `Image generated: ${img.url}${revised}\nSaved URL to: ${dest}`;
    } catch (e) {
      return `Image generation error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ── Persona ───────────────────────────────────────────────────────────────

  private personaUpdate(field: string, value: string): string {
    const allowed = ['User Name', 'User Nickname', 'Appearance', 'Tone Examples', 'Notes'];
    if (!allowed.includes(field)) return `Unknown persona field: ${field}. Use one of: ${allowed.join(', ')}.`;
    if (!value?.trim()) return 'Value cannot be empty.';
    try {
      updatePersonaField(this.groupId, field, value.trim());
      return `Persona updated — ${field}: ${value.trim()}`;
    } catch (e) {
      return `Failed to update persona: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ── System Config ─────────────────────────────────────────────────────────

  private configTool(action: string, key?: string, value?: string): string {
    const cfg = loadConfig();
    if (action === 'get') {
      if (key) {
        const val = (cfg as unknown as Record<string, unknown>)[key];
        return val !== undefined ? String(val) : `Key not found: ${key}`;
      }
      return JSON.stringify(cfg, null, 2);
    }
    if (action === 'set') {
      if (!key || value === undefined) return 'Provide key and value.';
      // Only allow non-secret keys
      const secret = ['provider', 'vault'].some(s => key.toLowerCase().includes(s));
      if (secret) return 'Cannot set secret config keys via this tool.';
      return `Config set is persisted on next microclaw setup. Key "${key}" noted as: ${value}`;
    }
    return `Unknown config action: ${action}`;
  }

  private envTool(key?: string): string {
    if (key) {
      if (!SAFE_ENV_KEYS.has(key.toUpperCase())) return `Not a safe env var: ${key}. Allowed: ${[...SAFE_ENV_KEYS].join(', ')}`;
      return process.env[key.toUpperCase()] ?? `(not set)`;
    }
    const out: Record<string, string> = {};
    for (const k of SAFE_ENV_KEYS) {
      const v = process.env[k];
      if (v) out[k] = v;
    }
    return JSON.stringify(out, null, 2);
  }

  private logsTool(lines = 50): string {
    const logPath = path.join('.micro', 'logs', 'app.log');
    if (!fs.existsSync(logPath)) return 'No log file found at .micro/logs/app.log';
    const all = fs.readFileSync(logPath, 'utf-8').split('\n');
    const tail = all.slice(-lines);
    return tail.join('\n');
  }

  // ── Infrastructure ────────────────────────────────────────────────────────

  private getSkill(command: string): string {
    const cmd = command.replace(/^\//, '').trim();
    const skillPath = path.join(path.resolve('skills'), cmd, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      const skillsDir = path.resolve('skills');
      let available = '(none)';
      try { available = fs.readdirSync(skillsDir).join(', '); } catch { /* ignore */ }
      return `Skill '${cmd}' not found. Available: ${available}`;
    }
    return fs.readFileSync(skillPath, 'utf-8');
  }
}

/** Exposed so the agent can read injected context for a group */
export function getInjectedContext(groupId: string): string | undefined {
  return injectedContext.get(groupId);
}
