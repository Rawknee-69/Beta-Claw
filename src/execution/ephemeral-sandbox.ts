import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../core/paths.js';

export interface EphemeralRunOptions {
  cmd:          string;
  env?:         Record<string, string>;
  timeoutMs?:   number;
  image?:       string;
  workFiles?:   Record<string, string>;
  networkMode?: string;
}

export interface EphemeralRunResult {
  stdout:     string;
  stderr:     string;
  exitCode:   number;
  durationMs: number;
}

/**
 * Run a command in a fresh ephemeral container.
 * Container is ALWAYS destroyed after run (--rm), even on error.
 */
export async function runEphemeral(opts: EphemeralRunOptions): Promise<EphemeralRunResult> {
  const id      = `mc-ephemeral-${randomBytes(6).toString('hex')}`;
  const image   = opts.image     ?? 'microclaw-sandbox:latest';
  const timeout = opts.timeoutMs ?? 60_000;
  const network = opts.networkMode ?? 'none';
  const workDir = path.join(PATHS.sandboxes, 'ephemeral', id);

  fs.mkdirSync(workDir, { recursive: true });

  if (opts.workFiles) {
    for (const [name, content] of Object.entries(opts.workFiles)) {
      fs.writeFileSync(path.join(workDir, name), content, 'utf-8');
    }
  }

  const args = [
    'run',
    '--rm',
    '--name', id,
    '--network', network,
    '--workdir', '/work',
    '-v', `${path.resolve(workDir)}:/work:rw`,
    '--memory',     '256m',
    '--cpus',       '0.5',
    '--pids-limit', '64',
    '--read-only',
    '--tmpfs', '/tmp:rw,size=64m',
    '--tmpfs', '/var/tmp:rw,size=16m',
  ];

  for (const [k, v] of Object.entries(opts.env ?? {})) {
    args.push('-e', `${k}=${v}`);
  }

  args.push(image, 'bash', '-c', opts.cmd);

  const start = Date.now();
  const r = spawnSync('docker', args, { encoding: 'utf-8', timeout });
  const durationMs = Date.now() - start;

  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }

  return {
    stdout:     r.stdout?.trim() ?? '',
    stderr:     r.stderr?.trim() ?? '',
    exitCode:   r.status ?? -1,
    durationMs,
  };
}

/**
 * Run a skill's scripts in an ephemeral sandbox.
 * Copies the skill's scripts/ directory into the container.
 */
export async function runSkillEphemeral(
  skillName: string,
  cmd: string,
  env?: Record<string, string>,
): Promise<string> {
  const skillDir = path.join(PATHS.skills, skillName, 'scripts');
  const workFiles: Record<string, string> = {};

  if (fs.existsSync(skillDir)) {
    for (const f of fs.readdirSync(skillDir)) {
      const full = path.join(skillDir, f);
      if (fs.statSync(full).isFile()) {
        workFiles[f] = fs.readFileSync(full, 'utf-8');
      }
    }
  }

  const result = await runEphemeral({ cmd, workFiles, env });
  const parts  = [`exit: ${result.exitCode}`, `duration: ${result.durationMs}ms`];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  return parts.join('\n');
}
