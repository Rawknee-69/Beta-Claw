import { Command } from 'commander';
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import dotenv from 'dotenv';

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

const V = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[96m', green: '\x1b[92m', yellow: '\x1b[93m',
  magenta: '\x1b[35m', red: '\x1b[91m', gray: '\x1b[90m',
};

async function startDaemon(options: { foreground?: boolean; verbose?: boolean }): Promise<void> {
  const status = getStatus();
  if (status.running) {
    console.log(`MicroClaw is already running (PID ${status.pid}).`);
    return;
  }

  ensureDirs();

  if (options.foreground || options.verbose) {
    dotenv.config();
    const modeLabel = options.verbose ? 'verbose mode' : 'foreground mode';
    console.log(`${V.cyan}${V.bold}MicroClaw v3.0${V.reset} — Starting in ${modeLabel}...`);
    if (options.verbose) {
      console.log(`${V.dim}  Streaming: ${V.cyan}[MSG]${V.reset} ${V.yellow}[TOOL]${V.reset} ${V.magenta}[MODEL]${V.reset} ${V.green}[SEND]${V.reset} ${V.red}[ERR]${V.reset}${V.dim} events${V.reset}`);
    }
    writePid(process.pid);

    const { MicroClawDB } = await import('../../db.js');
    const { Orchestrator } = await import('../../core/orchestrator.js');
    const { ProviderRegistry } = await import('../../core/provider-registry.js');
    const { registerAvailableProviders } = await import('../../core/provider-init.js');
    const { WhatsAppChannel } = await import('../../channels/whatsapp.js');
    const { TelegramChannel } = await import('../../channels/telegram.js');
    const { DiscordChannel } = await import('../../channels/discord.js');

    const { DB_PATH } = await import('../../core/paths.js');
    // Pin the absolute DB path into the environment so every child process
    // spawned by exec (e.g. "microclaw schedule once") resolves the same DB
    // regardless of the cwd it is launched from.
    process.env['MICROCLAW_DB'] = DB_PATH;
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new MicroClawDB(DB_PATH);
    const orchestrator = new Orchestrator({
      logLevel: options.verbose ? 'warn' : 'info',
      verbose: options.verbose ?? false,
    });

    // Register all available AI providers from environment
    const sharedRegistry = new ProviderRegistry();
    const registered = registerAvailableProviders(sharedRegistry);
    for (const id of sharedRegistry.listIds()) {
      const p = sharedRegistry.get(id);
      if (p) orchestrator.registerProvider(p);
    }
    console.log(`  Providers: ${registered.length > 0 ? registered.join(', ') : 'none'}`);

    // Register channels based on environment variables / config
    if (process.env['WHATSAPP_ENABLED'] === 'true' || fs.existsSync('.micro/whatsapp-auth')) {
      const wa = new WhatsAppChannel();
      orchestrator.registerChannel(wa);
      console.log('  Channel: WhatsApp');
    }

    if (process.env['TELEGRAM_BOT_TOKEN']) {
      try {
        const tg = new TelegramChannel();
        orchestrator.registerChannel(tg);
        console.log('  Channel: Telegram');
      } catch {
        // Telegram not available
      }
    }

    if (process.env['DISCORD_BOT_TOKEN']) {
      try {
        const dc = new DiscordChannel();
        orchestrator.registerChannel(dc);
        console.log('  Channel: Discord');
      } catch {
        // Discord not available
      }
    }

    await orchestrator.start();

    console.log('\nMicroClaw daemon running. Press Ctrl+C to stop.\n');

    const shutdown = async (): Promise<void> => {
      console.log('\nShutting down...');
      await orchestrator.stop();
      db.close();
      removePid();
      console.log('MicroClaw stopped.');
      process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
    return;
  }

  const daemonScript = path.resolve(import.meta.dirname ?? '.', 'daemon-entry.js');

  if (!fs.existsSync(daemonScript)) {
    console.log('MicroClaw v3.0 — Starting daemon...');
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

function restartDaemon(options: { foreground?: boolean; verbose?: boolean }): void {
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

  const skillsDir = 'skills';
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
  .option('--verbose', 'Run in foreground with colored streaming of all events (MSG/TOOL/MODEL/SEND/ERR)')
  .action(async (options: { foreground?: boolean; verbose?: boolean }) => {
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
  .option('--verbose', 'Run in verbose mode after restart')
  .action((options: { foreground?: boolean; verbose?: boolean }) => {
    restartDaemon(options);
  });

const statusCommand = new Command('status')
  .description('Show MicroClaw health: channels, models, skills, queue')
  .action(() => {
    showStatus();
  });

export { startCommand, stopCommand, restartCommand, statusCommand };
