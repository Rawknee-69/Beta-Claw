import { Command } from 'commander';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { z } from 'zod';

const VersionSchema = z.string().min(1);

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const parsed = VersionSchema.safeParse(version);
  if (!parsed.success) {
    return { name: 'Node.js', status: 'fail', detail: 'Cannot determine version' };
  }
  const major = parseInt(version.slice(1).split('.')[0] ?? '0', 10);
  if (major >= 20) {
    return { name: 'Node.js', status: 'ok', detail: version };
  }
  return { name: 'Node.js', status: 'fail', detail: `${version} (requires >=20)` };
}

function checkTypeScript(): CheckResult {
  try {
    const ver = execSync('npx tsc --version', { encoding: 'utf-8' }).trim();
    return { name: 'TypeScript', status: 'ok', detail: ver };
  } catch {
    return { name: 'TypeScript', status: 'warn', detail: 'Not found in PATH' };
  }
}

function checkSQLite(): CheckResult {
  try {
    require.resolve('better-sqlite3');
    return { name: 'SQLite', status: 'ok', detail: 'better-sqlite3 available' };
  } catch {
    return { name: 'SQLite', status: 'warn', detail: 'better-sqlite3 not resolved (may still work)' };
  }
}

function checkDiskSpace(): CheckResult {
  const free = os.freemem();
  const freeGB = (free / (1024 * 1024 * 1024)).toFixed(1);
  if (free > 1024 * 1024 * 512) {
    return { name: 'Disk/Memory', status: 'ok', detail: `${freeGB} GB free memory` };
  }
  return { name: 'Disk/Memory', status: 'warn', detail: `${freeGB} GB free memory (low)` };
}

function checkProviders(): CheckResult {
  const configured: string[] = [];
  if (process.env['OPENROUTER_API_KEY']) configured.push('openrouter');
  if (process.env['ANTHROPIC_API_KEY']) configured.push('anthropic');
  if (process.env['GOOGLE_API_KEY']) configured.push('google');

  if (configured.length > 0) {
    return { name: 'Providers', status: 'ok', detail: configured.join(', ') };
  }
  return { name: 'Providers', status: 'warn', detail: 'No API keys configured' };
}

function checkSkills(): CheckResult {
  const dir = 'skills';
  if (!fs.existsSync(dir)) {
    return { name: 'Skills', status: 'warn', detail: 'No skills directory' };
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const count = entries.filter((e) => e.isDirectory()).length;
  return { name: 'Skills', status: count > 0 ? 'ok' : 'warn', detail: `${count} skill(s) loaded` };
}

function checkChannels(): CheckResult {
  const channels: string[] = ['cli'];
  return { name: 'Channels', status: 'ok', detail: channels.join(', ') };
}

function runDoctor(): void {
  console.log('\nMicroClaw Doctor\n');

  const checks: CheckResult[] = [
    checkNodeVersion(),
    checkTypeScript(),
    checkSQLite(),
    checkDiskSpace(),
    checkProviders(),
    checkSkills(),
    checkChannels(),
  ];

  const icons: Record<string, string> = { ok: '✓', warn: '⚠', fail: '✗' };

  for (const check of checks) {
    const icon = icons[check.status] ?? '?';
    console.log(`  ${icon}  ${check.name.padEnd(16)} ${check.detail}`);
  }

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;

  console.log();
  if (failures > 0) {
    console.log(`${failures} failure(s), ${warnings} warning(s). Fix issues above.`);
  } else if (warnings > 0) {
    console.log(`All checks passed with ${warnings} warning(s).`);
  } else {
    console.log('All checks passed!');
  }
  console.log();
}

const doctorCommand = new Command('doctor')
  .description('Check dependencies and configuration health')
  .action(() => {
    runDoctor();
  });

export { doctorCommand };
