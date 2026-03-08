import { Command } from 'commander';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { encode } from '../../core/toon-serializer.js';
import { GROUPS_DIR, WORK_DIR, MEMORY_FILENAME, SOUL_FILENAME } from '../../core/paths.js';

const ExecutionModeSchema = z.enum(['isolated', 'full_control']);

// ─── ANSI color helpers (no external dependency) ──────────────────────────────
const clr = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  bCyan:   '\x1b[96m',
  green:   '\x1b[32m',
  bGreen:  '\x1b[92m',
  yellow:  '\x1b[33m',
  bYellow: '\x1b[93m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
};
const R = clr.reset;
function c(...parts: string[]): string { return parts.join('') + R; }
function ok(s: string): string  { return c(clr.bGreen, s); }
function err(s: string): string { return c(clr.red, s); }
function hi(s: string): string  { return c(clr.bYellow, clr.bold, s); }
function dim(s: string): string { return c(clr.dim, s); }
function cyan(s: string): string { return c(clr.bCyan, s); }

interface SetupState {
  step: number;
  mode: string;
  providers: Array<{ id: string; name: string; apiKey: string }>;
  searchProviders: Array<{ id: string; apiKey: string }>;
  channels: string[];
  persona: string;
  triggerWord: string;
  name: string;
  language: string;
}

const MICRO_DIR = '.micro';
const CONFIG_PATH = path.join(MICRO_DIR, 'config.toon');
const STATE_PATH = path.join(MICRO_DIR, '.setup-state.json');

const bx = clr.bCyan;   // box color
const tx = clr.bold + clr.bYellow; // title color
const vx = clr.dim;    // version color
const LOGO = `
${bx}    ╔══════════════════════════════════════════════╗${R}
${bx}    ║                                              ║${R}
${bx}    ║  ${tx}  ███╗   ███╗██╗ ██████╗██████╗  ██████╗  ${R}${bx}  ║${R}
${bx}    ║  ${tx}  ████╗ ████║██║██╔════╝██╔══██╗██╔═══██╗ ${R}${bx}  ║${R}
${bx}    ║  ${tx}  ██╔████╔██║██║██║     ██████╔╝██║   ██║ ${R}${bx}  ║${R}
${bx}    ║  ${tx}  ██║╚██╔╝██║██║██║     ██╔══██╗██║   ██║ ${R}${bx}  ║${R}
${bx}    ║  ${tx}  ██║ ╚═╝ ██║██║╚██████╗██║  ██║╚██████╔╝ ${R}${bx}  ║${R}
${bx}    ║  ${tx}  ╚═╝     ╚═╝╚═╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ${R}${bx}  ║${R}
${bx}    ║  ${tx}              C  L  A  W                   ${R}${bx}  ║${R}
${bx}    ║                                              ║${R}
${bx}    ║  ${vx}  Token-Optimized AI Agent Runtime v3.0   ${R}${bx}  ║${R}
${bx}    ║                                              ║${R}
${bx}    ╚══════════════════════════════════════════════╝${R}
`;

const PROVIDERS = [
  { num: '1',  id: 'openrouter',  name: 'OpenRouter',     desc: '200+ models, one API key (recommended)',       envVar: 'OPENROUTER_API_KEY',  prefix: 'sk-or-',  url: 'https://openrouter.ai/keys' },
  { num: '2',  id: 'anthropic',   name: 'Anthropic',      desc: 'Claude Haiku 4.5, Sonnet 4.6, Opus 4.6',      envVar: 'ANTHROPIC_API_KEY',   prefix: 'sk-ant-', url: 'https://console.anthropic.com/settings/keys' },
  { num: '3',  id: 'google',      name: 'Google Gemini',  desc: 'Gemini 2.5 Flash/Pro, 3.1 Pro Preview',        envVar: 'GOOGLE_API_KEY',      prefix: 'AIza',    url: 'https://aistudio.google.com/apikey' },
  { num: '4',  id: 'openai',      name: 'OpenAI',         desc: 'GPT-4o, o3, GPT-5',                           envVar: 'OPENAI_API_KEY',      prefix: 'sk-',     url: 'https://platform.openai.com/api-keys' },
  { num: '5',  id: 'groq',        name: 'Groq',           desc: 'Ultra-fast inference (Llama, Mixtral)',         envVar: 'GROQ_API_KEY',        prefix: 'gsk_',    url: 'https://console.groq.com/keys' },
  { num: '6',  id: 'deepseek',    name: 'DeepSeek',       desc: 'DeepSeek V3, R1 reasoning — very cheap',       envVar: 'DEEPSEEK_API_KEY',    prefix: 'sk-',     url: 'https://platform.deepseek.com/api-keys' },
  { num: '7',  id: 'mistral',     name: 'Mistral AI',     desc: 'Mistral Large 2, Devstral 2 — EU-hosted',      envVar: 'MISTRAL_API_KEY',     prefix: '',        url: 'https://console.mistral.ai/api-keys' },
  { num: '8',  id: 'cohere',      name: 'Cohere',         desc: 'Command R+, Embed — enterprise RAG',           envVar: 'COHERE_API_KEY',      prefix: '',        url: 'https://dashboard.cohere.com/api-keys' },
  { num: '9',  id: 'together',    name: 'Together AI',    desc: 'Open-source models, fast inference',            envVar: 'TOGETHER_API_KEY',    prefix: '',        url: 'https://api.together.xyz/settings/api-keys' },
  { num: '10', id: 'perplexity',  name: 'Perplexity',     desc: 'Search-grounded AI responses',                  envVar: 'PERPLEXITY_API_KEY',  prefix: 'pplx-',   url: 'https://www.perplexity.ai/settings/api' },
  { num: '11', id: 'ollama',      name: 'Ollama',         desc: 'Local models — no API key needed',              envVar: '',                    prefix: '',        url: 'https://ollama.ai' },
  { num: '12', id: 'lmstudio',    name: 'LM Studio',      desc: 'Local models with GUI — no key needed',         envVar: '',                    prefix: '',        url: 'https://lmstudio.ai' },
] as const;

const SEARCH_PROVIDERS = [
  { id: 'brave',  name: 'Brave Search', envVar: 'BRAVE_API_KEY',  url: 'https://brave.com/search/api' },
  { id: 'serper', name: 'Serper',       envVar: 'SERPER_API_KEY', url: 'https://serper.dev' },
] as const;

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[0f');
}

function printDivider(): void {
  console.log(clr.dim + clr.cyan + '  ' + '\u2500'.repeat(46) + R);
}

function detectPlatform(): { os: string; arch: string; container: string } {
  const platform = process.platform;
  const arch = process.arch;
  let containerRuntime = 'none';

  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    execSync('docker --version', { stdio: 'ignore' });
    containerRuntime = 'docker';
  } catch {
    try {
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      execSync('podman --version', { stdio: 'ignore' });
      containerRuntime = 'podman';
    } catch {
      containerRuntime = 'none';
    }
  }

  const osName = platform === 'darwin' ? 'macOS' :
                 platform === 'win32' ? 'Windows' :
                 platform === 'linux' ? 'Linux' : platform;

  return { os: osName, arch, container: containerRuntime };
}

function saveState(state: SetupState): void {
  fs.mkdirSync(MICRO_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state), 'utf-8');
}

function loadState(): SetupState | null {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    return JSON.parse(raw) as SetupState;
  } catch {
    return null;
  }
}

function clearState(): void {
  try { fs.unlinkSync(STATE_PATH); } catch { /* noop */ }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function validateApiKey(providerId: string, key: string): { valid: boolean; error: string } {
  if (!key || key.length < 10) {
    return { valid: false, error: 'Key is too short.' };
  }
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (provider?.prefix && !key.startsWith(provider.prefix)) {
    return { valid: false, error: `${provider.name} keys start with "${provider.prefix}". Get yours at ${provider.url}` };
  }
  return { valid: true, error: '' };
}

function writeEnvKeys(providers: Array<{ id: string; apiKey: string }>, searchProviders: Array<{ id: string; apiKey: string }>, triggerWord: string, channels: string[] = []): void {
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { /* new file */ }

  const lines = envContent.split('\n');

  const allKeys = [
    ...providers.map(p => {
      const def = PROVIDERS.find(d => d.id === p.id);
      return def?.envVar ? { envVar: def.envVar, value: p.apiKey } : null;
    }).filter(Boolean) as Array<{ envVar: string; value: string }>,
    ...searchProviders.map(s => {
      const def = SEARCH_PROVIDERS.find(d => d.id === s.id);
      return def?.envVar ? { envVar: def.envVar, value: s.apiKey } : null;
    }).filter(Boolean) as Array<{ envVar: string; value: string }>,
    { envVar: 'TRIGGER_WORD', value: triggerWord },
    { envVar: 'WHATSAPP_ENABLED', value: channels.includes('whatsapp') ? 'true' : 'false' },
  ];

  for (const { envVar, value } of allKeys) {
    const idx = lines.findIndex(l => l.startsWith(`${envVar}=`));
    if (idx >= 0) {
      lines[idx] = `${envVar}=${value}`;
    } else {
      lines.push(`${envVar}=${value}`);
    }
  }

  fs.writeFileSync(envPath, lines.filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n') + '\n', 'utf-8');
}

function writeConfig(state: SetupState): void {
  fs.mkdirSync(MICRO_DIR, { recursive: true });
  fs.mkdirSync(path.join(MICRO_DIR, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(MICRO_DIR, 'snapshots'), { recursive: true });

  const providerConfig: Record<string, unknown> = {};
  for (const p of state.providers) {
    providerConfig[p.id] = { configured: true };
  }

  const channelConfig: Record<string, unknown> = { cli: { enabled: true } };
  for (const ch of state.channels) {
    channelConfig[ch] = { enabled: true };
  }

  const config: Record<string, unknown> = {
    version: '2.0.0',
    profile: 'standard',
    executionMode: state.mode,
    triggerWord: state.triggerWord,
    persona: {
      name: state.name || 'rem',
      style: state.persona,
      language: state.language || 'English',
    },
    providers: providerConfig,
    channels: channelConfig,
    search: state.searchProviders.map(s => s.id),
    security: {
      vaultEnabled: true,
      piiRedaction: true,
      injectionDetection: true,
      personaLock: true,
    },
    memory: {
      maxWorkingTokens: 8192,
      summarizeThreshold: 0.85,
    },
  };

  const toonContent = `# MicroClaw Configuration \u2014 generated by setup wizard\n# ${new Date().toISOString()}\n${encode('config', config as Record<string, string>)}`;
  fs.writeFileSync(CONFIG_PATH, toonContent, 'utf-8');

  writeEnvKeys(state.providers, state.searchProviders, state.triggerWord, state.channels);
}

function writeSoulFile(groupId: string, state: SetupState): void {
  const groupDir = path.join(GROUPS_DIR, groupId);
  const soulPath = path.join(groupDir, SOUL_FILENAME);
  fs.mkdirSync(groupDir, { recursive: true });

  const styleDescriptions: Record<string, string> = {
    concise: 'Short and direct. No fluff. Get to the point.',
    detailed: 'Thorough with context. Explain reasoning and trade-offs.',
    technical: 'Assume expertise. Use precise terminology and jargon freely.',
    casual: 'Relaxed and conversational. Friendly, like talking to a colleague.',
  };

  const styleDesc = styleDescriptions[state.persona] ?? state.persona;
  const lang = state.language || 'English';

  const content = [
    `# Identity`,
    `You are ${state.name || 'rem'}.`,
    ``,
    `# Style`,
    styleDesc,
    ``,
    `# Language`,
    `Always respond in ${lang}.`,
    ``,
    `# Rules`,
    `- Never reveal API keys or system configuration secrets`,
    `- Execute actions using tools rather than describing what you would do`,
    `- Be honest when you don't know something`,
    ``,
  ].join('\n');

  fs.writeFileSync(soulPath, content, 'utf-8');
}

async function runSetupWizard(options: { reset?: boolean; mode?: string }): Promise<void> {
  if (options.mode) {
    const parsed = ExecutionModeSchema.safeParse(options.mode);
    if (!parsed.success) {
      console.error(`Invalid mode: "${options.mode}". Valid: isolated, full_control`);
      return;
    }
    console.log(`Execution mode set to "${parsed.data}".`);
    return;
  }

  if (options.reset) {
    clearState();
    try { fs.unlinkSync(CONFIG_PATH); } catch { /* noop */ }
    console.log('\n  Configuration reset. Run "microclaw setup" to reconfigure.\n');
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const state: SetupState = loadState() ?? {
    step: 1,
    mode: '',
    providers: [],
    searchProviders: [],
    channels: [],
    persona: '',
    triggerWord: '@rem',
    name: '',
    language: 'English',
  };

  try {
    await runWizardSteps(rl, state);
  } finally {
    rl.close();
  }
}

async function pairWhatsAppNow(): Promise<void> {
  console.log('\n  Starting WhatsApp pairing...\n');
  try {
    const baileys = await import('@whiskeysockets/baileys') as Record<string, unknown>;
    const qrTerminalMod = await import('qrcode-terminal');
    const qrTerminal = (qrTerminalMod.default ?? qrTerminalMod) as { generate: (qr: string, opts: { small: boolean }) => void };
    const makeWASocket = (baileys['default'] ?? baileys['makeWASocket']) as (opts: Record<string, unknown>) => unknown;
    const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys as Record<string, (...a: unknown[]) => unknown>;

    const AUTH_DIR = '.micro/whatsapp-auth';
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { version } = await (fetchLatestBaileysVersion as () => Promise<{ version: number[] }>)();
    // Use pino with level 'silent' — Baileys requires a real pino-compatible logger
    const pino = (await import('pino')).default;
    const silentLog = pino({ level: 'silent' });

    await new Promise<void>((resolve, reject) => {
      let done = false;
      let qrCount = 0;
      let currentSock: Record<string, unknown> | null = null;

      const loggedOutCode = (DisconnectReason as unknown as Record<string, unknown>)['loggedOut'];

      const globalTimeout = setTimeout(() => {
        if (!done) {
          done = true;
          (currentSock?.['end'] as (() => void) | undefined)?.();
          reject(new Error('QR pairing timed out (3 minutes)'));
        }
      }, 180_000);

      // Each connect() call creates a completely fresh auth state.
      // On retry we wipe the auth dir first — stale partial creds from a failed
      // handshake cause WhatsApp to show "try again later" on the next scan.
      async function connect(): Promise<void> {
        if (qrCount > 0) {
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            fs.mkdirSync(AUTH_DIR, { recursive: true });
          } catch { /* ignore */ }
        }
        qrCount++;

        const { state: freshAuth, saveCreds: freshSave } =
          await (useMultiFileAuthState as (dir: string) => Promise<{ state: unknown; saveCreds: () => void }>)(AUTH_DIR);

        // Do NOT use printQRInTerminal — it is deprecated. We render QR ourselves.
        const sock = makeWASocket({
          version,
          auth: freshAuth,
          logger: silentLog,
          browser: ['MicroClaw', 'Desktop', '3.0.0'],
        }) as Record<string, unknown>;
        currentSock = sock;
        const ev = sock['ev'] as { on: (event: string, handler: (...a: unknown[]) => void) => void };

        ev.on('creds.update', () => { (freshSave as () => void)(); });

        ev.on('connection.update', (update: unknown) => {
          if (done) return;
          const u = update as Record<string, unknown>;

          if (u['qr']) {
            console.log('\n');
            qrTerminal.generate(u['qr'] as string, { small: true });
            console.log('\n  Open WhatsApp → Settings → Linked Devices → Link a Device');
            console.log('  Scan the QR code above. Waiting...\n');
          }

          if (u['connection'] === 'open') {
            done = true;
            clearTimeout(globalTimeout);
            console.log('\n  ✓ WhatsApp paired successfully!\n');
            // Give creds a moment to flush to disk before we close the socket
            setTimeout(() => {
              (sock['end'] as (() => void) | undefined)?.();
              resolve();
            }, 1500);
          }

          if (u['connection'] === 'close') {
            const errObj = (u['lastDisconnect'] as Record<string, unknown> | undefined)?.['error'] as Record<string, unknown> | undefined;
            const statusCode = (errObj?.['output'] as Record<string, unknown> | undefined)?.['statusCode'];

            if (statusCode === loggedOutCode) {
              done = true;
              clearTimeout(globalTimeout);
              reject(new Error('Logged out during pairing'));
              return;
            }

            // Intermediate close (e.g. 515 stream error) is normal during the QR handshake.
            // Wait 2s before reconnecting with a fresh auth state.
            if (!done) {
              setTimeout(() => { void connect(); }, 2000);
            }
          }
        });
      }

      void connect();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out')) {
      console.log('  WhatsApp pairing timed out. Run "microclaw start" to try again.');
    } else if (msg.includes('not available') || msg.includes('Cannot find module')) {
      console.log('  WhatsApp (baileys) is not installed. Run: npm install @whiskeysockets/baileys');
    } else {
      console.log(`  WhatsApp pairing failed: ${msg}`);
      console.log('  You can pair later with "microclaw start".');
    }
  }
}

async function runWizardSteps(rl: readline.Interface, state: SetupState): Promise<void> {

  // ─── STEP 1: WELCOME ─────────────────────────────────────────
  if (state.step <= 1) {
    clearScreen();
    console.log(LOGO);

    const platform = detectPlatform();
    console.log(`  ${dim('Detected:')} ${platform.os} (${platform.arch})`);
    console.log(`  ${dim('Container:')} ${platform.container === 'none' ? dim('not found') : ok(platform.container)}`);
    console.log(`  ${dim('Node.js:')} ${process.version}`);
    console.log(`  ${dim('Memory:')} ${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB free`);
    console.log();
    printDivider();
    console.log();
    console.log(`  ${clr.bold}Welcome!${R} This wizard will configure MicroClaw in ~3 minutes.`);
    console.log(`  You can type ${cyan('"back"')} at any step to go back, or ${cyan('"quit"')} to exit.`);
    console.log();

    const resume = loadState();
    if (resume && resume.step > 1) {
      const ans = await ask(rl, '  Resume previous setup? (Y/n): ');
      if (ans.toLowerCase() === 'n' || ans.toLowerCase() === 'no') {
        state.step = 2;
        state.mode = '';
        state.providers = [];
        state.searchProviders = [];
        state.channels = [];
        state.persona = '';
      } else {
        Object.assign(state, resume);
      }
    } else {
      state.step = 2;
    }
    saveState(state);
  }

  // ─── STEP 2: EXECUTION MODE ──────────────────────────────────
  if (state.step <= 2) {
    console.log();
    printDivider();
    console.log(`  ${hi('STEP 1 of 7')} ${clr.dim}\u2014 Execution Mode${R}`);
    printDivider();
    console.log();
    console.log('  How should MicroClaw run actions on your system?');
    console.log();
    console.log(`  ${cyan('[1]')} ${clr.bold}ISOLATED MODE${R} ${dim('(recommended)')}`);
    console.log(`      ${dim('Agents run in containers. Can only access')}`);
    console.log(`      ${dim('files you explicitly allow. Safe for servers.')}`);
    console.log();
    console.log(`  ${cyan('[2]')} ${clr.bold}FULL CONTROL MODE${R}`);
    console.log(`      ${dim('Agents run on your host. Full access to files,')}`);
    console.log(`      ${dim('terminal, and package installation.')}`);
    console.log(`      ${dim('Only use on a machine you own and control.')}`);
    console.log();

    let valid = false;
    while (!valid) {
      const ans = await ask(rl, '  Choose [1] or [2]: ');
      if (ans === 'quit') { saveState(state); return; }
      if (ans === '1' || ans.toLowerCase().startsWith('iso')) {
        state.mode = 'isolated';
        valid = true;
      } else if (ans === '2' || ans.toLowerCase().startsWith('full')) {
        state.mode = 'full_control';
      console.log();
      console.log(`  ${clr.yellow}\u26A0  Full Control gives MicroClaw host-level access.${R}`);
      const confirm = await ask(rl, '  Are you sure? (yes/no): ');
        if (confirm.toLowerCase() === 'yes' || confirm.toLowerCase() === 'y') {
          valid = true;
        } else {
          state.mode = 'isolated';
          console.log('  Defaulting to Isolated Mode.');
          valid = true;
        }
      } else {
        console.log('  Please enter 1 or 2.');
      }
    }

    console.log(`\n  ${ok('\u2713 Mode:')} ${state.mode === 'isolated' ? 'Isolated' : 'Full Control'}`);
    state.step = 3;
    saveState(state);
  }

  // ─── STEP 3: AI PROVIDERS (multi-select) ──────────────────────
  if (state.step <= 3) {
    console.log();
    printDivider();
    console.log(`  ${hi('STEP 2 of 7')} ${clr.dim}\u2014 AI Providers${R}`);
    printDivider();
    console.log();
    console.log('  Which AI providers do you want to configure?');
    console.log(`  Enter numbers separated by commas, or ${cyan('"done"')} when finished.`);
    console.log();

    for (const p of PROVIDERS) {
      const pad = p.num.length === 1 ? ' ' : '';
      const already = state.providers.some(sp => sp.id === p.id) ? ` ${ok('\u2713')}` : '';
      console.log(`  ${cyan(`[${pad}${p.num}]`)} ${clr.bold}${p.name.padEnd(15)}${R} ${dim(p.desc)}${already}`);
    }
    console.log(`  ${cyan('[13]')} ${clr.bold}Skip           ${R} ${dim('Configure later')}`);
    console.log();

    let done = false;
    while (!done) {
      const ans = await ask(rl, '  Choose providers (e.g. 1,3 or "done"): ');
      if (ans === 'quit') { saveState(state); return; }
      if (ans === 'back') { state.step = 2; saveState(state); return runWizardSteps(rl, state); }
      if (ans.toLowerCase() === 'done' || ans === '13' || ans.toLowerCase() === 'skip') {
        done = true;
        break;
      }

      const nums = ans.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      for (const num of nums) {
        const provider = PROVIDERS.find(p => p.num === num || p.id === num.toLowerCase());
        if (provider && !state.providers.some(sp => sp.id === provider.id)) {
          if (provider.id === 'ollama' || provider.id === 'lmstudio') {
            state.providers.push({ id: provider.id, name: provider.name, apiKey: '' });
            console.log(`  ${ok('\u2713')} ${provider.name} added ${dim('(no key needed)')}`);
          } else {
            const existingKey = process.env[provider.envVar];
            if (existingKey) {
              console.log(`  Found existing key for ${clr.bold}${provider.name}${R}: ${dim(maskKey(existingKey))}`);
              const use = await ask(rl, `  Use this key? (Y/n): `);
              if (use.toLowerCase() !== 'n' && use.toLowerCase() !== 'no') {
                state.providers.push({ id: provider.id, name: provider.name, apiKey: existingKey });
                console.log(`  ${ok('\u2713')} ${provider.name} added`);
                continue;
              }
            }

            console.log(`  Get your key at: ${dim(clr.cyan + provider.url + R)}`);
            let keyValid = false;
            while (!keyValid) {
              const key = await ask(rl, `  ${provider.name} API key: `);
              if (key === 'skip' || key === '') {
                console.log(`  ${dim('Skipped')} ${provider.name}`);
                keyValid = true;
              } else {
                const validation = validateApiKey(provider.id, key);
                if (validation.valid) {
                  state.providers.push({ id: provider.id, name: provider.name, apiKey: key });
                  console.log(`  ${ok('\u2713')} ${provider.name} added: ${dim(maskKey(key))}`);
                  keyValid = true;
                } else {
                  console.log(`  ${err('\u2717')} ${validation.error}`);
                }
              }
            }
          }
          saveState(state);
        } else if (!provider) {
          console.log(`  Unknown selection: ${num}`);
        }
      }

      if (state.providers.length > 0) {
        console.log();
        console.log(`  Configured: ${state.providers.map(p => p.name).join(', ')}`);
        const more = await ask(rl, '  Add more providers? (y/N): ');
        if (more.toLowerCase() !== 'y' && more.toLowerCase() !== 'yes') {
          done = true;
        }
      }
    }

    if (state.providers.length === 0) {
      console.log(`\n  ${clr.yellow}No providers configured.${R} You can add them later with ${cyan('microclaw provider add')}.`);
    } else {
      console.log(`\n  ${ok('\u2713 Providers:')} ${state.providers.map(p => p.name).join(', ')}`);
    }
    state.step = 4;
    saveState(state);
  }

  // ─── STEP 4: SEARCH PROVIDERS ─────────────────────────────────
  if (state.step <= 4) {
    console.log();
    printDivider();
    console.log(`  ${hi('STEP 3 of 7')} ${clr.dim}\u2014 Web Search (optional)${R}`);
    printDivider();
    console.log();
    console.log('  Enable web search so your assistant can look things up?');
    console.log();
    console.log(`  ${cyan('[1]')} ${clr.bold}Brave Search${R}   ${dim('\u2014 brave.com/search/api (recommended)')}`);
    console.log(`  ${cyan('[2]')} ${clr.bold}Serper${R}         ${dim('\u2014 serper.dev (Google search results)')}`);
    console.log(`  ${cyan('[3]')} ${clr.bold}Both${R}           ${dim('\u2014 Brave primary, Serper fallback')}`);
    console.log(`  ${cyan('[4]')} ${clr.bold}Skip${R}           ${dim('\u2014 No web search')}`);
    console.log();

    const ans = await ask(rl, '  Choose [1-4]: ');
    if (ans === 'quit') { saveState(state); return; }
    if (ans === 'back') { state.step = 3; saveState(state); return runWizardSteps(rl, state); }

    const searchIds: string[] = [];
    if (ans === '1' || ans === '3') searchIds.push('brave');
    if (ans === '2' || ans === '3') searchIds.push('serper');

    for (const searchId of searchIds) {
      const def = SEARCH_PROVIDERS.find(s => s.id === searchId)!;
      const existingKey = process.env[def.envVar];
      if (existingKey) {
        console.log(`  Found existing ${clr.bold}${def.name}${R} key: ${dim(maskKey(existingKey))}`);
        state.searchProviders.push({ id: searchId, apiKey: existingKey });
        console.log(`  ${ok('\u2713')} ${def.name} enabled`);
      } else {
        console.log(`  Get your key at: ${dim(clr.cyan + def.url + R)}`);
        const key = await ask(rl, `  ${def.name} API key: `);
        if (key && key !== 'skip') {
          state.searchProviders.push({ id: searchId, apiKey: key });
          console.log(`  ${ok('\u2713')} ${def.name} enabled: ${dim(maskKey(key))}`);
        } else {
          console.log(`  ${dim('Skipped')} ${def.name}`);
        }
      }
    }

    if (state.searchProviders.length === 0) {
      console.log(`\n  ${ok('\u2713')} Web search: ${dim('disabled (add later via .env)')}`);
    } else {
      console.log(`\n  ${ok('\u2713 Search:')} ${state.searchProviders.map(s => SEARCH_PROVIDERS.find(d => d.id === s.id)?.name).join(', ')}`);
    }
    state.step = 5;
    saveState(state);
  }

  // ─── STEP 5: CHANNELS ─────────────────────────────────────────
  if (state.step <= 5) {
    console.log();
    printDivider();
    console.log(`  ${hi('STEP 4 of 7')} ${clr.dim}\u2014 Channels (optional)${R}`);
    printDivider();
    console.log();
    console.log('  CLI chat is always enabled. Want to add messaging channels?');
    console.log();
    console.log(`  ${cyan('[1]')} ${clr.bold}Telegram${R}       ${dim('\u2014 Needs TELEGRAM_BOT_TOKEN from @BotFather')}`);
    console.log(`  ${cyan('[2]')} ${clr.bold}Discord${R}        ${dim('\u2014 Needs DISCORD_BOT_TOKEN from discord.com/developers')}`);
    console.log(`  ${cyan('[3]')} ${clr.bold}WhatsApp${R}       ${dim('\u2014 QR code pairing via Baileys')}`);
    console.log(`  ${cyan('[4]')} ${clr.bold}Skip${R}           ${dim('\u2014 CLI only for now')}`);
    console.log();

    const ans = await ask(rl, '  Choose channels (e.g. 1,2 or "skip"): ');
    if (ans === 'quit') { saveState(state); return; }
    if (ans === 'back') { state.step = 4; saveState(state); return runWizardSteps(rl, state); }

    const channelMap: Record<string, { id: string; name: string; envVar: string }> = {
      '1': { id: 'telegram', name: 'Telegram', envVar: 'TELEGRAM_BOT_TOKEN' },
      '2': { id: 'discord',  name: 'Discord',  envVar: 'DISCORD_BOT_TOKEN' },
      '3': { id: 'whatsapp', name: 'WhatsApp', envVar: '' },
    };

    if (ans !== '4' && ans.toLowerCase() !== 'skip') {
      const nums = ans.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      for (const num of nums) {
        const ch = channelMap[num];
        if (ch) {
          if (ch.envVar) {
            const existingToken = process.env[ch.envVar];
            if (existingToken) {
              console.log(`  Found existing ${clr.bold}${ch.name}${R} token: ${dim(maskKey(existingToken))}`);
              state.channels.push(ch.id);
            } else {
              const token = await ask(rl, `  ${ch.name} bot token: `);
              if (token && token !== 'skip') {
                const envPath = path.join(process.cwd(), '.env');
                let envContent = '';
                try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { /* new */ }
                const lines = envContent.split('\n').filter(l => !l.startsWith(`${ch.envVar}=`));
                lines.push(`${ch.envVar}=${token}`);
                fs.writeFileSync(envPath, lines.filter(Boolean).join('\n') + '\n', 'utf-8');
                state.channels.push(ch.id);
                console.log(`  ${ok('\u2713')} ${ch.name} enabled`);
              } else {
                console.log(`  ${dim('Skipped')} ${ch.name}`);
              }
            }
          } else {
            // WhatsApp — offer to pair now via QR code
            state.channels.push(ch.id);
            console.log(`\n  ${ok('\u2713 WhatsApp enabled')}`);
            console.log();
            console.log(`  ${clr.bGreen}┌─────────────────────────────────────────┐${R}`);
            console.log(`  ${clr.bGreen}│${R}  ${clr.bold}Pair WhatsApp now?${R}                      ${clr.bGreen}│${R}`);
            console.log(`  ${clr.bGreen}│${R}  A QR code will appear — scan it in the  ${clr.bGreen}│${R}`);
            console.log(`  ${clr.bGreen}│${R}  WhatsApp app → Linked Devices → Link a  ${clr.bGreen}│${R}`);
            console.log(`  ${clr.bGreen}│${R}  device. Takes ~10 seconds.              ${clr.bGreen}│${R}`);
            console.log(`  ${clr.bGreen}└─────────────────────────────────────────┘${R}`);
            console.log();
            const pairNow = await ask(rl, '  Pair WhatsApp now? (Y/n): ');
            if (pairNow.toLowerCase() !== 'n' && pairNow.toLowerCase() !== 'no') {
              await pairWhatsAppNow();
            } else {
              console.log(`  WhatsApp will show QR on first ${cyan('microclaw start')}.`);
            }
          }
        }
      }
    }

    if (state.channels.length === 0) {
      console.log(`\n  ${ok('\u2713')} Channels: CLI only`);
    } else {
      console.log(`\n  ${ok('\u2713 Channels:')} CLI + ${state.channels.join(', ')}`);
    }
    state.step = 6;
    saveState(state);
  }

  // ─── STEP 6: PERSONA ──────────────────────────────────────────
  if (state.step <= 6) {
    console.log();
    printDivider();
    console.log(`  ${hi('STEP 5 of 7')} ${clr.dim}\u2014 Persona & Style${R}`);
    printDivider();
    console.log();
    console.log('  What communication style do you prefer?');
    console.log();
    console.log(`  ${cyan('[1]')} ${clr.bold}Concise${R}      ${dim('\u2014 Short, direct answers. No fluff.')}`);
    console.log(`  ${cyan('[2]')} ${clr.bold}Detailed${R}     ${dim('\u2014 Thorough explanations with context.')}`);
    console.log(`  ${cyan('[3]')} ${clr.bold}Technical${R}    ${dim('\u2014 Assumes expertise, uses jargon freely.')}`);
    console.log(`  ${cyan('[4]')} ${clr.bold}Casual${R}       ${dim('\u2014 Relaxed, conversational, friendly.')}`);
    console.log();

    const personaMap: Record<string, string> = {
      '1': 'concise', '2': 'detailed', '3': 'technical', '4': 'casual',
      'concise': 'concise', 'detailed': 'detailed', 'technical': 'technical', 'casual': 'casual',
    };

    let valid = false;
    while (!valid) {
      const ans = await ask(rl, '  Choose [1-4]: ');
      if (ans === 'quit') { saveState(state); return; }
      if (ans === 'back') { state.step = 5; saveState(state); return runWizardSteps(rl, state); }
      const mapped = personaMap[ans.toLowerCase()];
      if (mapped) {
        state.persona = mapped;
        valid = true;
      } else {
        console.log('  Please enter 1-4 or a style name.');
      }
    }

    console.log(`\n  ${ok('\u2713 Style:')} ${state.persona}`);
    console.log();

    const nameAns = await ask(rl, '  Give your assistant a name (default: rem): ');
    state.name = nameAns || 'rem';
    console.log(`  ${ok('\u2713 Name:')} ${state.name}`);

    const langAns = await ask(rl, '  Primary language (default: English): ');
    state.language = langAns || 'English';
    console.log(`  ${ok('\u2713 Language:')} ${state.language}`);

    const triggerAns = await ask(rl, `  Trigger word for group chats (default: @${state.name}): `);
    state.triggerWord = triggerAns || `@${state.name}`;
    if (!state.triggerWord.startsWith('@')) {
      state.triggerWord = `@${state.triggerWord}`;
    }
    console.log(`  ${ok('\u2713 Trigger:')} ${state.triggerWord}`);

    state.step = 7;
    saveState(state);
  }

  // ─── STEP 7: CONFIRMATION ─────────────────────────────────────
  if (state.step <= 7) {
    console.log();
    printDivider();
    console.log(`  ${hi('STEP 6 of 7')} ${clr.dim}\u2014 Confirm Setup${R}`);
    printDivider();
    console.log();
    console.log(`  ${clr.bold}Here's your configuration:${R}`);
    console.log();
    console.log(`    ${dim('Mode:')}       ${state.mode === 'isolated' ? 'Isolated (sandboxed)' : 'Full Control (host access)'}`);
    console.log(`    ${dim('Providers:')}  ${state.providers.length > 0 ? state.providers.map(p => p.name).join(', ') : clr.yellow + 'Not configured' + R}`);
    console.log(`    ${dim('Search:')}     ${state.searchProviders.length > 0 ? state.searchProviders.map(s => SEARCH_PROVIDERS.find(d => d.id === s.id)?.name ?? s.id).join(', ') : dim('Disabled')}`);
    console.log(`    ${dim('Channels:')}   CLI${state.channels.length > 0 ? ' + ' + state.channels.join(', ') : ''}`);
    console.log(`    ${dim('Style:')}      ${state.persona}`);
    console.log(`    ${dim('Name:')}       ${clr.bold}${state.name}${R}`);
    console.log(`    ${dim('Language:')}   ${state.language}`);
    console.log(`    ${dim('Trigger:')}    ${cyan(state.triggerWord)}`);
    console.log();

    const confirm = await ask(rl, '  Apply this configuration? (Y/n): ');
    if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
      const which = await ask(rl, '  Which step to redo? (1-5, or "all"): ');
      const stepMap: Record<string, number> = { '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, 'all': 2 };
      state.step = stepMap[which] ?? 2;
      saveState(state);
      return runWizardSteps(rl, state);
    }

    // ─── STEP 7b: WRITE CONFIG ────────────────────────────────────
    writeConfig(state);
    clearState();

    fs.mkdirSync(path.join(GROUPS_DIR, 'default'), { recursive: true });
    fs.mkdirSync(WORK_DIR, { recursive: true });
    fs.mkdirSync('skills', { recursive: true });

    writeSoulFile('default', state);

    const memoryPath = path.join(GROUPS_DIR, 'default', MEMORY_FILENAME);
    if (!fs.existsSync(memoryPath)) {
      const groupMemory = [
        `# Group: Default`,
        `Created: ${new Date().toISOString().split('T')[0] ?? 'today'}`,
        ``,
        `## Memory`,
        `Default CLI chat group.`,
        ``,
        `## User Preferences`,
        `(Updated automatically as MicroClaw learns your preferences)`,
        ``,
      ].join('\n');
      fs.writeFileSync(memoryPath, groupMemory, 'utf-8');
    }

    const globalMemoryPath = 'microclaw.md';
    try {
      const existing = fs.readFileSync(globalMemoryPath, 'utf-8');
      if (!existing.includes('## User Preferences')) {
        fs.appendFileSync(globalMemoryPath, '\n## User Preferences\n(Updated automatically as MicroClaw learns your preferences)\n');
      }
    } catch {
      const globalMemory = [
        `# MicroClaw \u2014 Global Memory`,
        ``,
        `## Project`,
        `MicroClaw is a token-optimized, provider-agnostic AI agent runtime.`,
        `Version 2.0. Built with TypeScript strict mode, SQLite (WAL), and TOON serialization.`,
        ``,
        `## Architecture`,
        `- Event-driven orchestrator (no polling)`,
        `- 12 AI providers supported`,
        `- Multi-agent DAG execution (Kahn's algorithm)`,
        `- 4-tier model routing (nano/standard/pro/max)`,
        `- FTS5-backed semantic search`,
        `- AES-256-GCM encrypted vault`,
        ``,
        `## Groups`,
        `- \`default\` \u2014 CLI chat, general purpose`,
        ``,
        `## User Preferences`,
        `(Updated automatically as MicroClaw learns your preferences)`,
        ``,
      ].join('\n');
      fs.writeFileSync(globalMemoryPath, globalMemory, 'utf-8');
    }

    // Write SOUL.md for any other groups that exist
    const groupsDir = 'groups';
    try {
      const groups = fs.readdirSync(groupsDir, { withFileTypes: true });
      for (const g of groups) {
        if (g.isDirectory() && g.name !== 'default') {
          const groupSoulPath = path.join(groupsDir, g.name, 'SOUL.md');
          if (!fs.existsSync(groupSoulPath)) {
            writeSoulFile(g.name, state);
          }
        }
      }
    } catch { /* groups dir may not exist yet */ }

    console.log();
    printDivider();
    console.log();
    console.log(`  ${ok('\u2713')} Configuration saved to ${dim('.micro/config.toon')}`);
    console.log(`  ${ok('\u2713')} API keys saved to ${dim('.env')}`);
    console.log(`  ${ok('\u2713')} Persona saved to ${dim(path.join(GROUPS_DIR, 'default', SOUL_FILENAME))}`);
    console.log(`  ${ok('\u2713')} Runtime directories created`);
    console.log();
    printDivider();
    console.log();
    console.log(`  ${hi('STEP 7 of 7')} ${clr.bGreen}\u2014 Setup complete!${R}`);
    console.log();
    console.log(`  ${clr.bold}Here's what you can do next:${R}`);
    console.log();
    console.log(`    ${cyan('microclaw chat')}           Start chatting`);
    console.log(`    ${cyan('microclaw start')}          Start daemon with all channels`);
    console.log(`    ${cyan('microclaw doctor')}         Run health check`);
    console.log(`    ${cyan('microclaw provider add')}   Add more AI providers`);
    console.log(`    ${cyan('microclaw skills list')}    View available skills`);
    console.log();

    if (state.providers.length === 0) {
      console.log(`  ${clr.yellow}Note:${R} You still need to configure a provider before chatting.`);
      console.log(`  Run: ${cyan('microclaw provider add')}`);
      console.log();
    }

    if (state.channels.length > 0) {
      console.log(`  Tip: Run ${cyan('microclaw start')} to connect your messaging channels.`);
      console.log();
    }

    console.log(`  Documentation: ${dim(clr.cyan + 'https://github.com/microclaw' + R)}`);
    console.log();
  }
}

const setupCommand = new Command('setup')
  .description('Run onboarding wizard')
  .option('--reset', 'Reset all configuration')
  .option('--mode <mode>', 'Set execution mode (isolated|full_control)')
  .action(async (options: { reset?: boolean; mode?: string }) => {
    await runSetupWizard(options);
  });

export { setupCommand };
