import { spawnSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PATHS } from '../core/paths.js';

export type SandboxMode      = 'off' | 'non-main' | 'all';
export type SandboxScope     = 'session' | 'agent' | 'shared';
export type WorkspaceAccess  = 'none' | 'ro' | 'rw';
export type ElevatedLevel    = 'off' | 'on' | 'full';

export interface SandboxConfig {
  mode:            SandboxMode;
  scope:           SandboxScope;
  workspaceAccess: WorkspaceAccess;
  image:           string;
  network:         string;
  readOnlyRoot:    boolean;
  binds:           string[];
  setupCommand?:   string;
  env:             Record<string, string>;
}

export interface SandboxRunOptions {
  sessionKey: string;
  agentId:    string;
  isMain:     boolean;
  elevated:   ElevatedLevel;
  groupId:    string;
  cfg:        SandboxConfig;
}

const activeContainers = new Map<string, string>();
const SHARED_KEY = 'microclaw-sandbox-shared';

export function shouldSandbox(opts: SandboxRunOptions): boolean {
  if (opts.cfg.mode === 'off')  return false;
  if (opts.cfg.mode === 'all')  return true;
  if (opts.isMain)              return false;
  if (opts.elevated === 'on' || opts.elevated === 'full') return false;
  return true;
}

export async function sandboxedExec(
  cmd: string,
  cwd: string,
  opts: SandboxRunOptions,
  timeoutMs = 30_000,
): Promise<string> {
  if (!shouldSandbox(opts)) return hostExec(cmd, cwd, timeoutMs);
  // Gracefully fall back to host execution when Docker is unavailable
  // rather than returning a hard error string that confuses the agent.
  if (!dockerAvailable()) {
    console.warn('[sandbox] Docker unavailable — falling back to host execution');
    return hostExec(cmd, cwd, timeoutMs);
  }
  return dockerExec(cmd, opts, timeoutMs);
}

function hostExec(cmd: string, cwd: string, timeoutMs: number): Promise<string> {
  return spawnAsync('bash', ['-c', cmd], { cwd, env: process.env }, timeoutMs);
}

function dockerExec(cmd: string, opts: SandboxRunOptions, timeoutMs: number): Promise<string> {
  const id = ensureContainer(opts);
  if (!id) return Promise.resolve('Sandbox unavailable: Docker not found or image not built.\nRun: microclaw sandbox setup');
  return spawnAsync('docker', ['exec', id, 'bash', '-c', cmd], { env: process.env }, timeoutMs);
}

function spawnAsync(
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv },
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    const chunks: { stream: 'out' | 'err'; data: string }[] = [];
    let timedOut = false;

    const child = spawn(file, args, {
      encoding: 'utf-8',
      cwd: opts.cwd,
      env: opts.env,
    } as Parameters<typeof spawn>[2]);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d: string) => chunks.push({ stream: 'out', data: d }));
    child.stderr?.on('data', (d: string) => chunks.push({ stream: 'err', data: d }));

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = chunks.filter(c => c.stream === 'out').map(c => c.data).join('');
      const stderr = chunks.filter(c => c.stream === 'err').map(c => c.data).join('');
      if (timedOut) {
        resolve(`exec error: process timed out after ${timeoutMs}ms`);
        return;
      }
      resolve([
        `exit: ${code ?? -1}`,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
        stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
      ].filter(Boolean).join('\n') || '(no output)');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`exec error: ${err.message}`);
    });
  });
}

function ensureContainer(opts: SandboxRunOptions): string | null {
  const key = containerKey(opts);
  if (activeContainers.has(key)) return activeContainers.get(key)!;
  if (!dockerAvailable())        return null;

  const { cfg, groupId } = opts;
  const sandboxDir = path.join(PATHS.sandboxes, key);
  fs.mkdirSync(sandboxDir, { recursive: true });

  const args = buildRunArgs(cfg, sandboxDir, groupId, key);
  const r = spawnSync('docker', args, { encoding: 'utf-8', timeout: 30_000 });
  if (r.status !== 0) {
    console.error('[sandbox] Failed to start container:', r.stderr?.trim());
    return null;
  }

  const id = r.stdout.trim();
  activeContainers.set(key, id);

  if (cfg.setupCommand) {
    spawnSync('docker', ['exec', id, 'sh', '-lc', cfg.setupCommand], {
      encoding: 'utf-8', timeout: 60_000,
    });
  }

  return id;
}

function buildRunArgs(cfg: SandboxConfig, sandboxDir: string, groupId: string, key: string): string[] {
  const args = [
    'run', '-d',
    '--name', `mc-${key.slice(0, 20)}`,
    '--rm',
    '--network', cfg.network,
    '--workdir', '/workspace',
    '-v', `${sandboxDir}:/workspace:rw`,
    '--memory', '256m',
    '--cpus',   '0.5',
    '--pids-limit', '64',
  ];

  const groupDir = path.join(PATHS.groups, groupId);
  if      (cfg.workspaceAccess === 'ro') args.push('-v', `${groupDir}:/agent:ro`);
  else if (cfg.workspaceAccess === 'rw') args.push('-v', `${groupDir}:/workspace:rw`);

  const skillsDir = path.resolve(PATHS.skills);
  if (cfg.workspaceAccess === 'none' && fs.existsSync(skillsDir)) {
    args.push('-v', `${skillsDir}:/workspace/skills:ro`);
  }

  for (const bind of cfg.binds) args.push('-v', bind);

  if (cfg.readOnlyRoot) {
    args.push('--read-only');
    args.push('--tmpfs', '/tmp:rw,size=64m');
    args.push('--tmpfs', '/var/tmp:rw,size=16m');
  }

  for (const [k, v] of Object.entries(cfg.env)) args.push('-e', `${k}=${v}`);

  args.push(cfg.image, 'tail', '-f', '/dev/null');
  return args;
}

function containerKey(opts: SandboxRunOptions): string {
  if (opts.cfg.scope === 'shared') return SHARED_KEY;
  if (opts.cfg.scope === 'agent')  return `agent-${opts.agentId}`;
  return `sess-${opts.sessionKey.replace(/[^a-z0-9]/gi, '-').slice(0, 20)}`;
}

function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { encoding: 'utf-8', timeout: 5_000 }).status === 0;
}


export function explainSandbox(opts: SandboxRunOptions): string {
  const sandboxed = shouldSandbox(opts);
  const key = containerKey(opts);
  return [
    `Session:      ${opts.sessionKey}`,
    `Is main:      ${opts.isMain}`,
    `Mode:         ${opts.cfg.mode}`,
    `Scope:        ${opts.cfg.scope}`,
    `Workspace:    ${opts.cfg.workspaceAccess}`,
    `Sandboxed:    ${sandboxed}`,
    `Elevated:     ${opts.elevated}`,
    `→ exec runs on: ${sandboxed ? `DOCKER (${activeContainers.get(key) ?? 'not started'})` : 'HOST'}`,
  ].join('\n');
}

export async function stopAllContainers(): Promise<void> {
  for (const [key, id] of activeContainers) {
    spawnSync('docker', ['stop', id], { encoding: 'utf-8', timeout: 10_000 });
    activeContainers.delete(key);
  }
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode:            'non-main',
  scope:           'session',
  workspaceAccess: 'none',
  image:           'microclaw-sandbox:latest',
  network:         'none',
  readOnlyRoot:    true,
  binds:           [],
  env:             {},
};
