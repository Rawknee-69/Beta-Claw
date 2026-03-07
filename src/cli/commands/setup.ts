import { Command } from 'commander';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { encode } from '../../core/toon-serializer.js';

const ExecutionModeSchema = z.enum(['isolated', 'full_control']);

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

const LOGO = `
    ╔══════════════════════════════════════════════╗
    ║                                              ║
    ║    ███╗   ███╗██╗ ██████╗██████╗  ██████╗    ║
    ║    ████╗ ████║██║██╔════╝██╔══██╗██╔═══██╗   ║
    ║    ██╔████╔██║██║██║     ██████╔╝██║   ██║   ║
    ║    ██║╚██╔╝██║██║██║     ██╔══██╗██║   ██║   ║
    ║    ██║ ╚═╝ ██║██║╚██████╗██║  ██║╚██████╔╝   ║
    ║    ╚═╝     ╚═╝╚═╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝   ║
    ║               C  L  A  W                     ║
    ║                                              ║
    ║    Token-Optimized AI Agent Runtime v2.0     ║
    ║                                              ║
    ╚══════════════════════════════════════════════╝
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
  console.log('  ' + '\u2500'.repeat(46));
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

function writeEnvKeys(providers: Array<{ id: string; apiKey: string }>, searchProviders: Array<{ id: string; apiKey: string }>, triggerWord: string): void {
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
      name: state.name || 'Andy',
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

  writeEnvKeys(state.providers, state.searchProviders, state.triggerWord);
}

function writeSoulFile(groupId: string, state: SetupState): void {
  const soulPath = `groups/${groupId}/SOUL.md`;
  fs.mkdirSync(`groups/${groupId}`, { recursive: true });

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
    `You are ${state.name || 'Andy'}.`,
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
    triggerWord: '@Andy',
    name: '',
    language: 'English',
  };

  try {
    await runWizardSteps(rl, state);
  } finally {
    rl.close();
  }
}

async function runWizardSteps(rl: readline.Interface, state: SetupState): Promise<void> {

  // ─── STEP 1: WELCOME ─────────────────────────────────────────
  if (state.step <= 1) {
    clearScreen();
    console.log(LOGO);

    const platform = detectPlatform();
    console.log(`  Detected: ${platform.os} (${platform.arch})`);
    console.log(`  Container: ${platform.container === 'none' ? 'not found' : platform.container}`);
    console.log(`  Node.js: ${process.version}`);
    console.log(`  Memory: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB free`);
    console.log();
    printDivider();
    console.log();
    console.log('  Welcome! This wizard will configure MicroClaw in ~3 minutes.');
    console.log('  You can type "back" at any step to go back, or "quit" to exit.');
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
    console.log('  STEP 1 of 7 \u2014 Execution Mode');
    printDivider();
    console.log();
    console.log('  How should MicroClaw run actions on your system?');
    console.log();
    console.log('  [1] ISOLATED MODE (recommended)');
    console.log('      Agents run in containers. Can only access');
    console.log('      files you explicitly allow. Safe for servers.');
    console.log();
    console.log('  [2] FULL CONTROL MODE');
    console.log('      Agents run on your host. Full access to files,');
    console.log('      terminal, and package installation.');
    console.log('      Only use on a machine you own and control.');
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
        console.log('  \u26A0  Full Control gives MicroClaw host-level access.');
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

    console.log(`\n  \u2713 Mode: ${state.mode === 'isolated' ? 'Isolated' : 'Full Control'}`);
    state.step = 3;
    saveState(state);
  }

  // ─── STEP 3: AI PROVIDERS (multi-select) ──────────────────────
  if (state.step <= 3) {
    console.log();
    printDivider();
    console.log('  STEP 2 of 7 \u2014 AI Providers');
    printDivider();
    console.log();
    console.log('  Which AI providers do you want to configure?');
    console.log('  Enter numbers separated by commas, or "done" when finished.');
    console.log();

    for (const p of PROVIDERS) {
      const pad = p.num.length === 1 ? ' ' : '';
      const already = state.providers.some(sp => sp.id === p.id) ? ' \u2713' : '';
      console.log(`  [${pad}${p.num}] ${p.name.padEnd(15)} ${p.desc}${already}`);
    }
    console.log(`  [13] Skip             Configure later`);
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
            console.log(`  \u2713 ${provider.name} added (no key needed)`);
          } else {
            const existingKey = process.env[provider.envVar];
            if (existingKey) {
              console.log(`  Found existing key for ${provider.name}: ${maskKey(existingKey)}`);
              const use = await ask(rl, `  Use this key? (Y/n): `);
              if (use.toLowerCase() !== 'n' && use.toLowerCase() !== 'no') {
                state.providers.push({ id: provider.id, name: provider.name, apiKey: existingKey });
                console.log(`  \u2713 ${provider.name} added`);
                continue;
              }
            }

            console.log(`  Get your key at: ${provider.url}`);
            let keyValid = false;
            while (!keyValid) {
              const key = await ask(rl, `  ${provider.name} API key: `);
              if (key === 'skip' || key === '') {
                console.log(`  Skipped ${provider.name}`);
                keyValid = true;
              } else {
                const validation = validateApiKey(provider.id, key);
                if (validation.valid) {
                  state.providers.push({ id: provider.id, name: provider.name, apiKey: key });
                  console.log(`  \u2713 ${provider.name} added: ${maskKey(key)}`);
                  keyValid = true;
                } else {
                  console.log(`  \u2717 ${validation.error}`);
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
      console.log('\n  No providers configured. You can add them later with "microclaw provider add".');
    } else {
      console.log(`\n  \u2713 Providers: ${state.providers.map(p => p.name).join(', ')}`);
    }
    state.step = 4;
    saveState(state);
  }

  // ─── STEP 4: SEARCH PROVIDERS ─────────────────────────────────
  if (state.step <= 4) {
    console.log();
    printDivider();
    console.log('  STEP 3 of 7 \u2014 Web Search (optional)');
    printDivider();
    console.log();
    console.log('  Enable web search so your assistant can look things up?');
    console.log();
    console.log('  [1] Brave Search   \u2014 brave.com/search/api (recommended)');
    console.log('  [2] Serper         \u2014 serper.dev (Google search results)');
    console.log('  [3] Both           \u2014 Brave primary, Serper fallback');
    console.log('  [4] Skip           \u2014 No web search');
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
        console.log(`  Found existing ${def.name} key: ${maskKey(existingKey)}`);
        state.searchProviders.push({ id: searchId, apiKey: existingKey });
        console.log(`  \u2713 ${def.name} enabled`);
      } else {
        console.log(`  Get your key at: ${def.url}`);
        const key = await ask(rl, `  ${def.name} API key: `);
        if (key && key !== 'skip') {
          state.searchProviders.push({ id: searchId, apiKey: key });
          console.log(`  \u2713 ${def.name} enabled: ${maskKey(key)}`);
        } else {
          console.log(`  Skipped ${def.name}`);
        }
      }
    }

    if (state.searchProviders.length === 0) {
      console.log('\n  \u2713 Web search: disabled (add later via .env)');
    } else {
      console.log(`\n  \u2713 Search: ${state.searchProviders.map(s => SEARCH_PROVIDERS.find(d => d.id === s.id)?.name).join(', ')}`);
    }
    state.step = 5;
    saveState(state);
  }

  // ─── STEP 5: CHANNELS ─────────────────────────────────────────
  if (state.step <= 5) {
    console.log();
    printDivider();
    console.log('  STEP 4 of 7 \u2014 Channels (optional)');
    printDivider();
    console.log();
    console.log('  CLI chat is always enabled. Want to add messaging channels?');
    console.log();
    console.log('  [1] Telegram       \u2014 Needs TELEGRAM_BOT_TOKEN from @BotFather');
    console.log('  [2] Discord        \u2014 Needs DISCORD_BOT_TOKEN from discord.com/developers');
    console.log('  [3] WhatsApp       \u2014 QR code pairing via Baileys');
    console.log('  [4] Skip           \u2014 CLI only for now');
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
              console.log(`  Found existing ${ch.name} token: ${maskKey(existingToken)}`);
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
                console.log(`  \u2713 ${ch.name} enabled`);
              } else {
                console.log(`  Skipped ${ch.name}`);
              }
            }
          } else {
            state.channels.push(ch.id);
            console.log(`  \u2713 ${ch.name} enabled (QR scan on first start)`);
          }
        }
      }
    }

    if (state.channels.length === 0) {
      console.log('\n  \u2713 Channels: CLI only');
    } else {
      console.log(`\n  \u2713 Channels: CLI + ${state.channels.join(', ')}`);
    }
    state.step = 6;
    saveState(state);
  }

  // ─── STEP 6: PERSONA ──────────────────────────────────────────
  if (state.step <= 6) {
    console.log();
    printDivider();
    console.log('  STEP 5 of 7 \u2014 Persona & Style');
    printDivider();
    console.log();
    console.log('  What communication style do you prefer?');
    console.log();
    console.log('  [1] Concise      \u2014 Short, direct answers. No fluff.');
    console.log('  [2] Detailed     \u2014 Thorough explanations with context.');
    console.log('  [3] Technical    \u2014 Assumes expertise, uses jargon freely.');
    console.log('  [4] Casual       \u2014 Relaxed, conversational, friendly.');
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

    console.log(`\n  \u2713 Style: ${state.persona}`);
    console.log();

    const nameAns = await ask(rl, '  Give your assistant a name (default: Andy): ');
    state.name = nameAns || 'Andy';
    console.log(`  \u2713 Name: ${state.name}`);

    const langAns = await ask(rl, '  Primary language (default: English): ');
    state.language = langAns || 'English';
    console.log(`  \u2713 Language: ${state.language}`);

    const triggerAns = await ask(rl, `  Trigger word for group chats (default: @${state.name}): `);
    state.triggerWord = triggerAns || `@${state.name}`;
    if (!state.triggerWord.startsWith('@')) {
      state.triggerWord = `@${state.triggerWord}`;
    }
    console.log(`  \u2713 Trigger: ${state.triggerWord}`);

    state.step = 7;
    saveState(state);
  }

  // ─── STEP 7: CONFIRMATION ─────────────────────────────────────
  if (state.step <= 7) {
    console.log();
    printDivider();
    console.log('  STEP 6 of 7 \u2014 Confirm Setup');
    printDivider();
    console.log();
    console.log('  Here\'s your configuration:');
    console.log();
    console.log(`    Mode:       ${state.mode === 'isolated' ? 'Isolated (sandboxed)' : 'Full Control (host access)'}`);
    console.log(`    Providers:  ${state.providers.length > 0 ? state.providers.map(p => p.name).join(', ') : 'Not configured'}`);
    console.log(`    Search:     ${state.searchProviders.length > 0 ? state.searchProviders.map(s => SEARCH_PROVIDERS.find(d => d.id === s.id)?.name ?? s.id).join(', ') : 'Disabled'}`);
    console.log(`    Channels:   CLI${state.channels.length > 0 ? ' + ' + state.channels.join(', ') : ''}`);
    console.log(`    Style:      ${state.persona}`);
    console.log(`    Name:       ${state.name}`);
    console.log(`    Language:   ${state.language}`);
    console.log(`    Trigger:    ${state.triggerWord}`);
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

    fs.mkdirSync('groups/default/workspace', { recursive: true });
    fs.mkdirSync('.claude/skills', { recursive: true });

    writeSoulFile('default', state);

    const claudePath = 'groups/default/CLAUDE.md';
    if (!fs.existsSync(claudePath)) {
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
      fs.writeFileSync(claudePath, groupMemory, 'utf-8');
    }

    const globalMemoryPath = 'CLAUDE.md';
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
    console.log('  \u2713 Configuration saved to .micro/config.toon');
    console.log('  \u2713 API keys saved to .env');
    console.log('  \u2713 Persona saved to groups/default/SOUL.md');
    console.log('  \u2713 Runtime directories created');
    console.log();
    printDivider();
    console.log();
    console.log('  STEP 7 of 7 \u2014 Setup complete!');
    console.log();
    console.log('  Here\'s what you can do next:');
    console.log();
    console.log('    microclaw chat           Start chatting');
    console.log('    microclaw start          Start daemon with all channels');
    console.log('    microclaw doctor         Run health check');
    console.log('    microclaw provider add   Add more AI providers');
    console.log('    microclaw skills list    View available skills');
    console.log();

    if (state.providers.length === 0) {
      console.log('  Note: You still need to configure a provider before chatting.');
      console.log('  Run: microclaw provider add');
      console.log();
    }

    if (state.channels.length > 0) {
      console.log('  Tip: Run "microclaw start" to connect your messaging channels.');
      console.log();
    }

    console.log('  Documentation: https://github.com/microclaw');
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
