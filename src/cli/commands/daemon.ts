import { Command } from 'commander';
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const PID_FILE = path.join('.micro', 'microclaw.pid');
const LOG_FILE = path.join('.micro', 'logs', 'app.log');

const PidSchema = z.number().int().positive();

function ensureDirs(): void {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const parsed = PidSchema.safeParse(parseInt(raw, 10));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePid(pid: number): void {
  ensureDirs();
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePid(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // already gone
  }
}

function getStatus(): { running: boolean; pid: number | null; uptime: string } {
  const pid = readPid();
  if (pid && isRunning(pid)) {
    return { running: true, pid, uptime: 'active' };
  }
  if (pid) {
    removePid();
  }
  return { running: false, pid: null, uptime: 'stopped' };
}

async function startDaemon(options: { foreground?: boolean }): Promise<void> {
  const status = getStatus();
  if (status.running) {
    console.log(`MicroClaw is already running (PID ${status.pid}).`);
    return;
  }

  ensureDirs();

  if (options.foreground) {
    console.log('MicroClaw v2.0 — Starting in foreground mode...');
    writePid(process.pid);

    const { MicroClawDB } = await import('../../db.js');
    const { Orchestrator } = await import('../../core/orchestrator.js');
    const { ProviderRegistry } = await import('../../core/provider-registry.js');
    const { ModelCatalog } = await import('../../core/model-catalog.js');
    const { SkillWatcher } = await import('../../core/skill-watcher.js');
    const { TaskScheduler } = await import('../../scheduler/task-scheduler.js');

    const db = new MicroClawDB('microclaw.db');
    const registry = new ProviderRegistry();
    const catalog = new ModelCatalog(db, registry);
    const orchestrator = new Orchestrator();
    const skillWatcher = new SkillWatcher();
    const scheduler = new TaskScheduler(db, registry);

    skillWatcher.watch();
    scheduler.start();
    await catalog.refreshAll();
    await orchestrator.start();

    console.log('MicroClaw daemon running. Press Ctrl+C to stop.\n');

    const shutdown = (): void => {
      console.log('\nShutting down...');
      orchestrator.stop();
      scheduler.stop();
      skillWatcher.close();
      db.close();
      removePid();
      console.log('MicroClaw stopped.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const daemonScript = path.resolve(import.meta.dirname ?? '.', 'daemon-entry.js');

  if (!fs.existsSync(daemonScript)) {
    console.log('MicroClaw v2.0 — Starting daemon...');
    writePid(process.pid);
    console.log(`Daemon started (PID ${process.pid}).`);
    console.log('Run "microclaw status" to check health.');
    console.log('Run "microclaw stop" to stop.\n');
    return;
  }

  const logStream = fs.openSync(LOG_FILE, 'a');
  const child: ChildProcess = fork(daemonScript, [], {
    detached: true,
    stdio: ['ignore', logStream, logStream, 'ipc'],
  });

  if (child.pid) {
    writePid(child.pid);
    child.unref();
    console.log(`MicroClaw daemon started (PID ${child.pid}).`);
    console.log(`Logs: ${LOG_FILE}`);
    console.log('Run "microclaw status" to check health.');
    console.log('Run "microclaw stop" to stop.\n');
  }
}

function stopDaemon(): void {
  const status = getStatus();
  if (!status.running || !status.pid) {
    console.log('MicroClaw is not running.');
    return;
  }

  try {
    process.kill(status.pid, 'SIGTERM');
    console.log(`Stopping MicroClaw (PID ${status.pid})...`);

    let attempts = 0;
    const check = (): void => {
      if (!isRunning(status.pid!)) {
        removePid();
        console.log('MicroClaw stopped.');
        return;
      }
      attempts++;
      if (attempts > 10) {
        process.kill(status.pid!, 'SIGKILL');
        removePid();
        console.log('MicroClaw force-killed.');
        return;
      }
      setTimeout(check, 500);
    };
    setTimeout(check, 500);
  } catch {
    removePid();
    console.log('MicroClaw was not running (stale PID removed).');
  }
}

function restartDaemon(options: { foreground?: boolean }): void {
  const status = getStatus();
  if (status.running && status.pid) {
    console.log(`Stopping MicroClaw (PID ${status.pid})...`);
    try {
      process.kill(status.pid, 'SIGTERM');
    } catch {
      // already dead
    }
    removePid();

    let attempts = 0;
    const waitAndStart = (): void => {
      if (status.pid && isRunning(status.pid) && attempts < 10) {
        attempts++;
        setTimeout(waitAndStart, 500);
        return;
      }
      console.log('Restarting...');
      void startDaemon(options);
    };
    setTimeout(waitAndStart, 500);
  } else {
    void startDaemon(options);
  }
}

function showStatus(): void {
  const status = getStatus();
  console.log('\nMicroClaw Status\n');
  console.log(`  Status:   ${status.running ? 'Running' : 'Stopped'}`);
  if (status.pid) {
    console.log(`  PID:      ${status.pid}`);
  }
  console.log(`  PID file: ${PID_FILE}`);
  console.log(`  Log file: ${LOG_FILE}`);

  const providers: string[] = [];
  if (process.env['OPENROUTER_API_KEY']) providers.push('openrouter');
  if (process.env['ANTHROPIC_API_KEY']) providers.push('anthropic');
  if (process.env['OPENAI_API_KEY']) providers.push('openai');
  if (process.env['GOOGLE_API_KEY']) providers.push('google');
  if (process.env['GROQ_API_KEY']) providers.push('groq');
  if (process.env['DEEPSEEK_API_KEY']) providers.push('deepseek');

  console.log(`  Providers: ${providers.length > 0 ? providers.join(', ') : 'none configured'}`);

  const skillsDir = '.claude/skills';
  let skillCount = 0;
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    skillCount = entries.filter((e) => e.isDirectory()).length;
  } catch {
    // dir doesn't exist
  }
  console.log(`  Skills:   ${skillCount} loaded`);
  console.log();
}

const startCommand = new Command('start')
  .description('Start MicroClaw daemon')
  .option('--foreground', 'Run in foreground (logs to stdout)')
  .action(async (options: { foreground?: boolean }) => {
    await startDaemon(options);
  });

const stopCommand = new Command('stop')
  .description('Graceful shutdown of MicroClaw daemon')
  .action(() => {
    stopDaemon();
  });

const restartCommand = new Command('restart')
  .description('Restart MicroClaw daemon')
  .option('--foreground', 'Run in foreground after restart')
  .action((options: { foreground?: boolean }) => {
    restartDaemon(options);
  });

const statusCommand = new Command('status')
  .description('Show MicroClaw health: channels, models, skills, queue')
  .action(() => {
    showStatus();
  });

export { startCommand, stopCommand, restartCommand, statusCommand };
