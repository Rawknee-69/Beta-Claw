import { Command } from 'commander';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { MicroClawDB } from '../../db.js';
import { DB_PATH, GROUPS_DIR, SOUL_FILENAME } from '../../core/paths.js';
import { DEFAULT_SANDBOX_CONFIG, type SandboxRunOptions } from '../../execution/sandbox.js';
import { ProviderRegistry } from '../../core/provider-registry.js';
import { DEFAULT_CATALOG, type ModelEntry } from '../../core/model-catalog.js';
import { selectModel } from '../../core/model-selector.js';
import { agentLoop } from '../../core/agent-loop.js';
import { buildSystemPrompt } from '../../core/prompt-builder.js';
import { TaskScheduler } from '../../scheduler/task-scheduler.js';
import { SkillWatcher } from '../../core/skill-watcher.js';
import { registerAvailableProviders } from '../../core/provider-init.js';
import type { HistoryMessage } from '../../core/complexity-estimator.js';
import { hookRegistry } from '../../hooks/hook-registry.js';

interface ChatOptions {
  group?: string;
  model?: string;
  provider?: string;
  noPersona?: boolean;
}

function warnLegacyPaths(): void {
  if (fs.existsSync('microclaw.db')) {
    console.warn(
      `\n[MicroClaw] MIGRATION: Found legacy microclaw.db at project root.\n` +
      `  Run: mkdir -p .workspace/db && mv microclaw.db .workspace/db/microclaw.db\n`,
    );
  }
  if (fs.existsSync('groups') && fs.statSync('groups').isDirectory()) {
    console.warn(
      `[MicroClaw] MIGRATION: Found legacy groups/ at project root.\n` +
      `  Run: mkdir -p .workspace && mv groups .workspace/groups\n`,
    );
  }
}

async function startChat(options: ChatOptions): Promise<void> {
  dotenv.config();
  warnLegacyPaths();

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new MicroClawDB(DB_PATH);
  const registry = new ProviderRegistry();
  const registered = registerAvailableProviders(registry);

  if (registry.size() === 0) {
    console.log(
      '\n  No AI providers configured.\n\n' +
      '  Run "microclaw setup" to configure a provider, or set one of these:\n\n' +
      '    OPENROUTER_API_KEY   200+ models via one key (recommended)\n' +
      '    ANTHROPIC_API_KEY    Claude models\n' +
      '    OPENAI_API_KEY       GPT-4o, o3\n' +
      '    GOOGLE_API_KEY       Gemini models\n' +
      '    GROQ_API_KEY         Ultra-fast Llama/Mixtral\n' +
      '    DEEPSEEK_API_KEY     Cost-efficient coding models\n\n' +
      '  Or install Ollama for local models: https://ollama.ai\n',
    );
    db.close();
    return;
  }

  if (options.provider && registry.has(options.provider)) {
    registry.setDefault(options.provider);
  }

  const availableProviderIds = new Set(registry.listIds());
  const catalog: ModelEntry[] = DEFAULT_CATALOG.filter(m => availableProviderIds.has(m.provider_id));

  const groupId = options.group ?? 'default';
  const groupDir = path.join(GROUPS_DIR, groupId);
  const soulPath = path.join(groupDir, SOUL_FILENAME);
  fs.mkdirSync(groupDir, { recursive: true });

  if (!fs.existsSync(soulPath)) {
    console.log('\n\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
    console.log('\u2502  First run \u2014 define your assistant      \u2502');
    console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n');
    const ask = (q: string, def: string) => new Promise<string>(resolve => {
      const r = readline.createInterface({ input: process.stdin, output: process.stdout });
      r.question(`  ${q} [${def}]: `, a => { r.close(); resolve(a.trim() || def); });
    });
    const name = await ask('Assistant name', 'rem');
    const style = await ask('Personality style', 'direct and concise');
    const lang  = await ask('Primary language', 'English');
    fs.writeFileSync(soulPath,
      `# Identity\nYou are ${name}.\n\n# Style\n${style}\n\n# Language\nAlways respond in ${lang}.\n`,
      'utf-8',
    );
    console.log(`\n  Persona saved to ${soulPath}\n`);
  }

  if (!db.getGroup(groupId)) {
    db.insertGroup({
      id: groupId,
      channel: 'cli',
      name: groupId === 'default' ? 'CLI Chat' : groupId,
      trigger_word: process.env['TRIGGER_WORD'] ?? '@rem',
      execution_mode: 'isolated',
    });
  }

  const skillWatcher = new SkillWatcher();
  skillWatcher.watch();

  const scheduler = new TaskScheduler(db, registry, catalog, undefined, async (_groupId: string, text: string) => {
    console.log(`\n[cron] ${text}\n`);
    rl.prompt();
  });
  scheduler.start();

  await hookRegistry.load();
  await hookRegistry.fire({
    type: 'gateway', action: 'startup',
    sessionKey: 'cli', timestamp: new Date(), messages: [], context: {},
  });

  let lastTurnUsedTool = false;

  console.log('\nMicroClaw v3.0 \u2014 Interactive Chat');
  console.log(`Providers: ${registered.join(', ')}`);
  console.log(`Models available: ${catalog.length}`);
  console.log(`Group: ${groupId}`);
  console.log('Type /quit to exit, /status for system info\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You > ',
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/quit' || input === '/exit') {
      console.log('\nGoodbye!');
      scheduler.stop();
      db.close();
      rl.close();
      return;
    }

    if (input === '/status') {
      const providers = registry.listIds();
      console.log(`\n  Providers: ${providers.join(', ')}`);
      console.log(`  Models: ${catalog.length}`);
      console.log(`  Group: ${groupId}`);
      console.log('');
      rl.prompt();
      return;
    }

    if (input.startsWith('/') && input !== '/status') {
      const skillPath = `skills/${input.slice(1)}/SKILL.md`;
      if (fs.existsSync(skillPath)) {
        const skillContent = fs.readFileSync(skillPath, 'utf-8');
        await processMessage(`Execute this skill:\n${skillContent}`);
        return;
      }
      console.log(`Unknown command: ${input}. Type /status for system info.`);
      rl.prompt();
      return;
    }

    await processMessage(input);
  });

  async function processMessage(content: string): Promise<void> {
    const history = db.getMessages(groupId, 20);
    const historyForTier: HistoryMessage[] = history.map(m => ({
      role: (m.sender_id === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));

    const sel = selectModel(catalog, content, { history: historyForTier, recentToolUse: lastTurnUsedTool });
    if (!sel) { console.log('\n[No model available]\n'); rl.prompt(); return; }
    const provider = registry.get(sel.model.provider_id);
    if (!provider) { console.log(`\n[Provider ${sel.model.provider_id} unavailable]\n`); rl.prompt(); return; }

    const messages = [
      ...historyForTier,
      { role: 'user' as const, content },
    ];

    db.insertMessage({
      id: randomUUID(),
      group_id: groupId,
      sender_id: 'user',
      content,
      timestamp: Math.floor(Date.now() / 1000),
      channel: 'cli',
      processed: 0,
    });

    process.stdout.write(`\nMC [${sel.model.id}] > `);

    try {
      const skills = skillWatcher.listSkills();
      const systemPrompt = await buildSystemPrompt(groupId, skills);
      const cliSandboxOpts: SandboxRunOptions = {
        sessionKey: 'cli', agentId: 'cli', isMain: true,
        elevated: 'off', groupId, cfg: DEFAULT_SANDBOX_CONFIG,
      };
      let toolUsedThisTurn = false;
      const response = await agentLoop(messages, {
        provider,
        model: sel.model,
        systemPrompt,
        db,
        groupId,
        sandboxOpts: cliSandboxOpts,
        onToolCall: (name) => {
          toolUsedThisTurn = true;
          process.stdout.write(`\n  \u21B3 ${name}...`);
        },
      });
      lastTurnUsedTool = toolUsedThisTurn;

      console.log('\n' + response + '\n');

      db.insertMessage({
        id: randomUUID(),
        group_id: groupId,
        sender_id: 'assistant',
        content: response,
        timestamp: Math.floor(Date.now() / 1000),
        channel: 'cli',
        processed: 1,
      });

      scheduler.refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`\nError: ${errorMsg}\n`);
    }

    rl.prompt();
  }

  rl.on('close', () => {
    scheduler.stop();
    skillWatcher.close();
    db.close();
  });
}

const chatCommand = new Command('chat')
  .description('Open interactive chat session')
  .option('--group <id>', 'Chat in specific group context')
  .option('--model <id>', 'Override model for session')
  .option('--provider <id>', 'Use specific provider')
  .option('--no-persona', 'Disable persona for debug session')
  .action(async (options: ChatOptions) => {
    await startChat(options);
  });

export { chatCommand };
