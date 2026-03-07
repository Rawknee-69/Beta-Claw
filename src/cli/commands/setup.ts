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
  provider: string;
  apiKey: string;
  persona: string;
  triggerWord: string;
  name: string;
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

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[0f');
}

function printDivider(): void {
  console.log('  ' + '─'.repeat(46));
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

function validateApiKey(provider: string, key: string): { valid: boolean; error: string } {
  if (!key || key.length < 10) {
    return { valid: false, error: 'Key is too short.' };
  }
  switch (provider) {
    case 'anthropic':
      if (!key.startsWith('sk-ant-')) return { valid: false, error: 'Anthropic keys start with "sk-ant-". Get yours at https://console.anthropic.com/settings/keys' };
      break;
    case 'openai':
      if (!key.startsWith('sk-')) return { valid: false, error: 'OpenAI keys start with "sk-". Get yours at https://platform.openai.com/api-keys' };
      break;
    case 'google':
      if (!key.startsWith('AIza')) return { valid: false, error: 'Google keys start with "AIza". Get yours at https://aistudio.google.com/apikey' };
      break;
    case 'openrouter':
      if (!key.startsWith('sk-or-')) return { valid: false, error: 'OpenRouter keys start with "sk-or-". Get yours at https://openrouter.ai/keys' };
      break;
    case 'groq':
      if (!key.startsWith('gsk_')) return { valid: false, error: 'Groq keys start with "gsk_". Get yours at https://console.groq.com/keys' };
      break;
    case 'deepseek':
      if (!key.startsWith('sk-')) return { valid: false, error: 'DeepSeek keys start with "sk-". Get yours at https://platform.deepseek.com/api-keys' };
      break;
  }
  return { valid: true, error: '' };
}

function getEnvVarName(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    ollama: '',
  };
  return map[provider] ?? '';
}

function writeConfig(state: SetupState): void {
  fs.mkdirSync(MICRO_DIR, { recursive: true });
  fs.mkdirSync(path.join(MICRO_DIR, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(MICRO_DIR, 'snapshots'), { recursive: true });

  const config: Record<string, unknown> = {
    version: '2.0.0',
    profile: 'standard',
    executionMode: state.mode,
    triggerWord: state.triggerWord,
    persona: {
      name: state.name || 'Andy',
      style: state.persona,
    },
    providers: {} as Record<string, unknown>,
    channels: {
      cli: { enabled: true },
      http: { enabled: false, port: 3210 },
    },
    security: {
      vaultEnabled: true,
      piiRedaction: true,
      injectionDetection: true,
      personaLock: true,
    },
    memory: {
      maxWorkingTokens: 8192,
      summarizeThreshold: 0.85,
      ragChunkSize: 500,
      ragChunkOverlap: 50,
    },
  };

  if (state.provider !== 'skip' && state.provider !== 'ollama') {
    (config['providers'] as Record<string, unknown>)[state.provider] = { configured: true };
  }

  const toonContent = `# MicroClaw Configuration — generated by setup wizard\n# ${new Date().toISOString()}\n${encode('config', config as Record<string, string>)}`;
  fs.writeFileSync(CONFIG_PATH, toonContent, 'utf-8');

  if (state.provider !== 'skip' && state.provider !== 'ollama' && state.apiKey) {
    const envVar = getEnvVarName(state.provider);
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { /* new file */ }

    const lines = envContent.split('\n').filter((l) => !l.startsWith(`${envVar}=`));
    lines.push(`${envVar}=${state.apiKey}`);
    fs.writeFileSync(envPath, lines.filter(Boolean).join('\n') + '\n', 'utf-8');
  }
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
    provider: '',
    apiKey: '',
    persona: '',
    triggerWord: '@Andy',
    name: '',
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
    console.log('  Welcome! This wizard will configure MicroClaw in ~2 minutes.');
    console.log('  You can type "back" at any step to go back, or "quit" to exit.');
    console.log();

    const resume = loadState();
    if (resume && resume.step > 1) {
      const ans = await ask(rl, '  Resume previous setup? (Y/n): ');
      if (ans.toLowerCase() === 'n' || ans.toLowerCase() === 'no') {
        state.step = 2;
        state.mode = '';
        state.provider = '';
        state.apiKey = '';
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
    console.log('  STEP 1 of 5 — Execution Mode');
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
        console.log('  ⚠  Full Control gives MicroClaw host-level access.');
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

    console.log(`\n  ✓ Mode: ${state.mode === 'isolated' ? 'Isolated' : 'Full Control'}`);
    state.step = 3;
    saveState(state);
  }

  // ─── STEP 3: AI PROVIDER ──────────────────────────────────────
  if (state.step <= 3) {
    console.log();
    printDivider();
    console.log('  STEP 2 of 5 — AI Provider');
    printDivider();
    console.log();
    console.log('  Which AI provider would you like to use?');
    console.log();
    console.log('  [1] OpenRouter    — 200+ models, one API key (recommended)');
    console.log('  [2] Anthropic     — Claude models (Sonnet, Haiku, Opus)');
    console.log('  [3] OpenAI        — GPT-4o, o3, GPT-4-turbo');
    console.log('  [4] Google        — Gemini 2.0 Flash, Gemini Pro');
    console.log('  [5] Groq          — Ultra-fast inference (Llama, Mixtral)');
    console.log('  [6] DeepSeek      — Cost-efficient coding models');
    console.log('  [7] Ollama        — Local models (no API key needed)');
    console.log('  [8] Skip          — Configure later');
    console.log();

    const providerMap: Record<string, string> = {
      '1': 'openrouter', '2': 'anthropic', '3': 'openai', '4': 'google',
      '5': 'groq', '6': 'deepseek', '7': 'ollama', '8': 'skip',
      'openrouter': 'openrouter', 'anthropic': 'anthropic', 'openai': 'openai',
      'google': 'google', 'groq': 'groq', 'deepseek': 'deepseek',
      'ollama': 'ollama', 'skip': 'skip',
    };

    let valid = false;
    while (!valid) {
      const ans = await ask(rl, '  Choose [1-8]: ');
      if (ans === 'quit') { saveState(state); return; }
      if (ans === 'back') { state.step = 2; saveState(state); return runWizardSteps(rl, state); }
      const mapped = providerMap[ans.toLowerCase()];
      if (mapped) {
        state.provider = mapped;
        valid = true;
      } else {
        console.log('  Please enter a number 1-8 or provider name.');
      }
    }

    const displayNames: Record<string, string> = {
      openrouter: 'OpenRouter', anthropic: 'Anthropic', openai: 'OpenAI',
      google: 'Google Gemini', groq: 'Groq', deepseek: 'DeepSeek',
      ollama: 'Ollama (local)', skip: 'Skipped',
    };
    console.log(`\n  ✓ Provider: ${displayNames[state.provider] ?? state.provider}`);
    state.step = 4;
    saveState(state);
  }

  // ─── STEP 4: API KEY ──────────────────────────────────────────
  if (state.step <= 4) {
    if (state.provider !== 'skip' && state.provider !== 'ollama') {
      console.log();
      printDivider();
      console.log('  STEP 3 of 5 — API Key');
      printDivider();
      console.log();

      const urls: Record<string, string> = {
        openrouter: 'https://openrouter.ai/keys',
        anthropic: 'https://console.anthropic.com/settings/keys',
        openai: 'https://platform.openai.com/api-keys',
        google: 'https://aistudio.google.com/apikey',
        groq: 'https://console.groq.com/keys',
        deepseek: 'https://platform.deepseek.com/api-keys',
      };

      const existingKey = process.env[getEnvVarName(state.provider)];
      if (existingKey) {
        console.log(`  Found existing key in environment: ${maskKey(existingKey)}`);
        const use = await ask(rl, '  Use this key? (Y/n): ');
        if (use.toLowerCase() !== 'n' && use.toLowerCase() !== 'no') {
          state.apiKey = existingKey;
          console.log('\n  ✓ Using existing API key');
          state.step = 5;
          saveState(state);
        }
      }

      if (state.step <= 4) {
        console.log(`  Get your key at: ${urls[state.provider] ?? 'provider dashboard'}`);
        console.log('  (Key will be stored locally in .env, never sent anywhere else)');
        console.log();

        let valid = false;
        while (!valid) {
          const ans = await ask(rl, '  Paste your API key: ');
          if (ans === 'quit') { saveState(state); return; }
          if (ans === 'back') { state.step = 3; saveState(state); return runWizardSteps(rl, state); }
          if (ans === 'skip') {
            state.provider = 'skip';
            state.apiKey = '';
            console.log('\n  ✓ Skipped API key — configure later with "microclaw provider add"');
            valid = true;
          } else {
            const validation = validateApiKey(state.provider, ans);
            if (validation.valid) {
              state.apiKey = ans;
              console.log(`\n  ✓ API key saved: ${maskKey(ans)}`);
              valid = true;
            } else {
              console.log(`  ✗ ${validation.error}`);
              console.log();
            }
          }
        }
        state.step = 5;
        saveState(state);
      }
    } else {
      if (state.provider === 'ollama') {
        console.log();
        console.log('  Ollama runs locally — no API key needed.');
        console.log('  Make sure Ollama is running: https://ollama.ai');
      }
      state.step = 5;
      saveState(state);
    }
  }

  // ─── STEP 5: PERSONA ──────────────────────────────────────────
  if (state.step <= 5) {
    console.log();
    printDivider();
    console.log('  STEP 4 of 5 — Persona & Style');
    printDivider();
    console.log();
    console.log('  What communication style do you prefer?');
    console.log();
    console.log('  [1] Concise      — Short, direct answers. No fluff.');
    console.log('  [2] Detailed     — Thorough explanations with context.');
    console.log('  [3] Technical    — Assumes expertise, uses jargon freely.');
    console.log('  [4] Casual       — Relaxed, conversational, friendly.');
    console.log();

    const personaMap: Record<string, string> = {
      '1': 'concise', '2': 'detailed', '3': 'technical', '4': 'casual',
      'concise': 'concise', 'detailed': 'detailed', 'technical': 'technical', 'casual': 'casual',
    };

    let valid = false;
    while (!valid) {
      const ans = await ask(rl, '  Choose [1-4]: ');
      if (ans === 'quit') { saveState(state); return; }
      if (ans === 'back') { state.step = 4; saveState(state); return runWizardSteps(rl, state); }
      const mapped = personaMap[ans.toLowerCase()];
      if (mapped) {
        state.persona = mapped;
        valid = true;
      } else {
        console.log('  Please enter 1-4 or a style name.');
      }
    }

    console.log(`\n  ✓ Style: ${state.persona}`);
    console.log();

    const nameAns = await ask(rl, '  Give your assistant a name (default: Andy): ');
    state.name = nameAns || 'Andy';
    console.log(`  ✓ Name: ${state.name}`);

    const triggerAns = await ask(rl, `  Trigger word to summon it (default: @${state.name}): `);
    state.triggerWord = triggerAns || `@${state.name}`;
    if (!state.triggerWord.startsWith('@')) {
      state.triggerWord = `@${state.triggerWord}`;
    }
    console.log(`  ✓ Trigger: ${state.triggerWord}`);

    state.step = 6;
    saveState(state);
  }

  // ─── STEP 6: CONFIRMATION ─────────────────────────────────────
  if (state.step <= 6) {
    console.log();
    printDivider();
    console.log('  STEP 5 of 5 — Confirm Setup');
    printDivider();
    console.log();
    console.log('  Here\'s your configuration:');
    console.log();
    console.log(`    Mode:       ${state.mode === 'isolated' ? 'Isolated (sandboxed)' : 'Full Control (host access)'}`);
    console.log(`    Provider:   ${state.provider === 'skip' ? 'Not configured yet' : state.provider}`);
    if (state.apiKey) {
      console.log(`    API Key:    ${maskKey(state.apiKey)}`);
    }
    console.log(`    Style:      ${state.persona}`);
    console.log(`    Name:       ${state.name}`);
    console.log(`    Trigger:    ${state.triggerWord}`);
    console.log();

    const confirm = await ask(rl, '  Apply this configuration? (Y/n): ');
    if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
      const which = await ask(rl, '  Which step to redo? (1-4, or "all"): ');
      const stepMap: Record<string, number> = { '1': 2, '2': 3, '3': 4, '4': 5, 'all': 2 };
      state.step = stepMap[which] ?? 2;
      saveState(state);
      return runWizardSteps(rl, state);
    }

    // Write configuration
    writeConfig(state);
    clearState();

    // Create initial directories
    fs.mkdirSync('groups', { recursive: true });
    fs.mkdirSync('.claude/skills', { recursive: true });

    console.log();
    printDivider();
    console.log();
    console.log('  ✓ Configuration saved to .micro/config.toon');
    if (state.apiKey) {
      console.log('  ✓ API key saved to .env');
    }
    console.log('  ✓ Runtime directories created');
    console.log();
    printDivider();
    console.log();
    console.log('  Setup complete! Here\'s what you can do next:');
    console.log();
    console.log('    microclaw chat           Start chatting');
    console.log('    microclaw start          Start the daemon');
    console.log('    microclaw doctor         Run health check');
    console.log('    microclaw provider add   Add more AI providers');
    console.log('    microclaw skills list    View available skills');
    console.log();

    if (state.provider === 'skip') {
      console.log('  Note: You still need to configure a provider before chatting.');
      console.log('  Run: microclaw provider add');
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
