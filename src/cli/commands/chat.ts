import { Command } from 'commander';
import readline from 'node:readline';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { MicroClawDB } from '../../db.js';
import { ProviderRegistry } from '../../core/provider-registry.js';
import { DEFAULT_CATALOG, type ModelEntry } from '../../core/model-catalog.js';
import { selectModel } from '../../core/model-selector.js';
import { agentLoop } from '../../core/agent-loop.js';
import { buildSystemPrompt } from '../../core/prompt-builder.js';
import { TaskScheduler } from '../../scheduler/task-scheduler.js';
import { OpenRouterAdapter } from '../../providers/openrouter.js';
import { AnthropicAdapter } from '../../providers/anthropic.js';
import { OpenAIAdapter } from '../../providers/openai.js';
import { GoogleAdapter } from '../../providers/google.js';
import { GroqAdapter } from '../../providers/groq.js';
import { MistralAdapter } from '../../providers/mistral.js';
import { CohereAdapter } from '../../providers/cohere.js';
import { TogetherAdapter } from '../../providers/together.js';
import { DeepSeekAdapter } from '../../providers/deepseek.js';
import { PerplexityAdapter } from '../../providers/perplexity.js';
import { OllamaAdapter } from '../../providers/ollama.js';
import { LMStudioAdapter } from '../../providers/lmstudio.js';

interface ChatOptions {
  group?: string;
  model?: string;
  provider?: string;
  noPersona?: boolean;
}

const PROVIDER_ENV_MAP: Array<{
  envVar: string;
  name: string;
  id: string;
  create: (getKey: () => string) => InstanceType<typeof OpenRouterAdapter> | InstanceType<typeof AnthropicAdapter> | InstanceType<typeof OpenAIAdapter> | InstanceType<typeof GoogleAdapter> | InstanceType<typeof GroqAdapter> | InstanceType<typeof MistralAdapter> | InstanceType<typeof CohereAdapter> | InstanceType<typeof TogetherAdapter> | InstanceType<typeof DeepSeekAdapter> | InstanceType<typeof PerplexityAdapter>;
}> = [
  { envVar: 'OPENROUTER_API_KEY', name: 'OpenRouter', id: 'openrouter', create: (g) => new OpenRouterAdapter(g) },
  { envVar: 'ANTHROPIC_API_KEY', name: 'Anthropic', id: 'anthropic', create: (g) => new AnthropicAdapter(g) },
  { envVar: 'OPENAI_API_KEY', name: 'OpenAI', id: 'openai', create: (g) => new OpenAIAdapter(g) },
  { envVar: 'GOOGLE_API_KEY', name: 'Google Gemini', id: 'google', create: (g) => new GoogleAdapter(g) },
  { envVar: 'GROQ_API_KEY', name: 'Groq', id: 'groq', create: (g) => new GroqAdapter(g) },
  { envVar: 'MISTRAL_API_KEY', name: 'Mistral', id: 'mistral', create: (g) => new MistralAdapter(g) },
  { envVar: 'COHERE_API_KEY', name: 'Cohere', id: 'cohere', create: (g) => new CohereAdapter(g) },
  { envVar: 'TOGETHER_API_KEY', name: 'Together AI', id: 'together', create: (g) => new TogetherAdapter(g) },
  { envVar: 'DEEPSEEK_API_KEY', name: 'DeepSeek', id: 'deepseek', create: (g) => new DeepSeekAdapter(g) },
  { envVar: 'PERPLEXITY_API_KEY', name: 'Perplexity', id: 'perplexity', create: (g) => new PerplexityAdapter(g) },
];

function registerAvailableProviders(registry: ProviderRegistry): string[] {
  const registered: string[] = [];

  for (const entry of PROVIDER_ENV_MAP) {
    const key = process.env[entry.envVar];
    if (key) {
      const envVar = entry.envVar;
      registry.register(entry.create(() => {
        const k = process.env[envVar];
        if (!k) throw new Error(`${envVar} not set`);
        return k;
      }));
      registered.push(entry.name);
    }
  }

  try {
    const ollamaAdapter = new OllamaAdapter();
    registry.register(ollamaAdapter);
    registered.push('Ollama (local)');
  } catch {
    // Ollama not available
  }

  try {
    const lmStudioAdapter = new LMStudioAdapter();
    registry.register(lmStudioAdapter);
    registered.push('LM Studio (local)');
  } catch {
    // LM Studio not available
  }

  return registered;
}

async function startChat(options: ChatOptions): Promise<void> {
  dotenv.config();

  const db = new MicroClawDB('microclaw.db');
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
  const soulPath = `groups/${groupId}/SOUL.md`;
  fs.mkdirSync(`groups/${groupId}`, { recursive: true });

  if (!fs.existsSync(soulPath)) {
    console.log('\n\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
    console.log('\u2502  First run \u2014 define your assistant      \u2502');
    console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n');
    const ask = (q: string, def: string) => new Promise<string>(resolve => {
      const r = readline.createInterface({ input: process.stdin, output: process.stdout });
      r.question(`  ${q} [${def}]: `, a => { r.close(); resolve(a.trim() || def); });
    });
    const name = await ask('Assistant name', 'Andy');
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
      trigger_word: process.env['TRIGGER_WORD'] ?? '@Andy',
      execution_mode: 'isolated',
    });
  }

  const scheduler = new TaskScheduler(db, registry, catalog, async (_groupId, text) => {
    console.log(`\n[cron] ${text}\n`);
    rl.prompt();
  });
  scheduler.start();

  console.log('\nMicroClaw v2.0 \u2014 Interactive Chat');
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
      const skillPath = `.claude/skills/${input.slice(1)}/SKILL.md`;
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
    const sel = selectModel(catalog, content);
    if (!sel) { console.log('\n[No model available]\n'); rl.prompt(); return; }
    const provider = registry.get(sel.model.provider_id);
    if (!provider) { console.log(`\n[Provider ${sel.model.provider_id} unavailable]\n`); rl.prompt(); return; }

    const history = db.getMessages(groupId, 20);
    const messages = [
      ...history.map(m => ({
        role: (m.sender_id === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
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
      const systemPrompt = await buildSystemPrompt(groupId);
      const response = await agentLoop(messages, {
        provider,
        model: sel.model,
        systemPrompt,
        db,
        groupId,
        onToolCall: (name) => process.stdout.write(`\n  \u21B3 ${name}...`),
      });

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
