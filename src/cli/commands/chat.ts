import { Command } from 'commander';
import readline from 'node:readline';
import fs from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { MicroClawDB } from '../../db.js';
import { ProviderRegistry } from '../../core/provider-registry.js';
import { ModelCatalog } from '../../core/model-catalog.js';
import { estimateComplexity } from '../../core/complexity-estimator.js';
import { selectModel } from '../../core/model-selector.js';
import { getConfig } from '../../core/config-loader.js';
import { PromptLoader } from '../../core/prompt-loader.js';
import { SkillWatcher } from '../../core/skill-watcher.js';
import { Guardrails } from '../../security/guardrails.js';
import { EpisodicMemory } from '../../memory/episodic.js';
import { WorkingMemory } from '../../memory/working-memory.js';
import { Compactor } from '../../memory/compactor.js';
import { Retriever } from '../../memory/retriever.js';
import { PlannerAgent } from '../../agents/planner.js';
import { ResearchAgent } from '../../agents/research.js';
import { ExecutionAgent } from '../../agents/execution.js';
import { MemoryAgent } from '../../agents/memory.js';
import { ComposerAgent } from '../../agents/composer.js';
import { executeDAG } from '../../execution/dag-executor.js';
import type { AgentNode } from '../../execution/dag-executor.js';
import { encode, parseAll } from '../../core/toon-serializer.js';
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
import { v4 as uuidv4 } from 'uuid';

interface ChatOptions {
  group?: string;
  model?: string;
  provider?: string;
  noPersona?: boolean;
}

const PROVIDER_ENV_MAP: Array<{
  envVar: string;
  name: string;
  create: (getKey: () => string) => InstanceType<typeof OpenRouterAdapter> | InstanceType<typeof AnthropicAdapter> | InstanceType<typeof OpenAIAdapter> | InstanceType<typeof GoogleAdapter> | InstanceType<typeof GroqAdapter> | InstanceType<typeof MistralAdapter> | InstanceType<typeof CohereAdapter> | InstanceType<typeof TogetherAdapter> | InstanceType<typeof DeepSeekAdapter> | InstanceType<typeof PerplexityAdapter>;
}> = [
  { envVar: 'OPENROUTER_API_KEY', name: 'OpenRouter', create: (g) => new OpenRouterAdapter(g) },
  { envVar: 'ANTHROPIC_API_KEY', name: 'Anthropic', create: (g) => new AnthropicAdapter(g) },
  { envVar: 'OPENAI_API_KEY', name: 'OpenAI', create: (g) => new OpenAIAdapter(g) },
  { envVar: 'GOOGLE_API_KEY', name: 'Google Gemini', create: (g) => new GoogleAdapter(g) },
  { envVar: 'GROQ_API_KEY', name: 'Groq', create: (g) => new GroqAdapter(g) },
  { envVar: 'MISTRAL_API_KEY', name: 'Mistral', create: (g) => new MistralAdapter(g) },
  { envVar: 'COHERE_API_KEY', name: 'Cohere', create: (g) => new CohereAdapter(g) },
  { envVar: 'TOGETHER_API_KEY', name: 'Together AI', create: (g) => new TogetherAdapter(g) },
  { envVar: 'DEEPSEEK_API_KEY', name: 'DeepSeek', create: (g) => new DeepSeekAdapter(g) },
  { envVar: 'PERPLEXITY_API_KEY', name: 'Perplexity', create: (g) => new PerplexityAdapter(g) },
];

function loadEnv(): void {
  dotenv.config();
}

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

function buildDAGNodes(planBlock: { type: string; data: Record<string, unknown> }): AgentNode[] {
  const rawSteps = planBlock.data['steps'];
  if (!Array.isArray(rawSteps)) return [];

  const nodes: AgentNode[] = [];
  const nodeIds: string[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const step = rawSteps[i];
    if (typeof step !== 'object' || step === null) continue;
    const stepObj = step as Record<string, unknown>;
    const id = String(stepObj['id'] ?? `step_${i}`);
    const agentType = String(stepObj['agent'] ?? stepObj['agentType'] ?? 'research');
    const brief = String(stepObj['brief'] ?? planBlock.data['brief'] ?? '');
    const rawDeps = stepObj['dependsOn'];
    const dependsOn = Array.isArray(rawDeps) ? rawDeps.map(String) : [];

    nodeIds.push(id);
    nodes.push({ id, agentType, brief, dependsOn });
  }

  if (nodes.length > 0 && !nodes.some(n => n.agentType === 'composer')) {
    nodes.push({
      id: 'composer',
      agentType: 'composer',
      brief: String(planBlock.data['brief'] ?? ''),
      dependsOn: nodeIds,
    });
  }

  return nodes;
}

function extractHumanResponse(toonOrText: string): string {
  try {
    const blocks = parseAll(toonOrText);
    for (const block of blocks) {
      const d = block.data;
      if (typeof d['response'] === 'string' && d['response']) return d['response'];
      if (typeof d['summary'] === 'string' && d['summary']) return d['summary'];
      if (typeof d['content'] === 'string' && d['content']) return d['content'];
      if (typeof d['stdout'] === 'string' && d['stdout']) return d['stdout'];
    }
  } catch {
    // not TOON
  }
  return toonOrText;
}

async function startChat(options: ChatOptions): Promise<void> {
  loadEnv();

  const config = getConfig();
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

  const catalog = new ModelCatalog(db, registry);

  console.log('\nMicroClaw v2.0 — Interactive Chat');
  console.log(`Providers: ${registered.join(', ')}`);
  console.log('Loading models...');

  await catalog.refreshAll();

  const modelCount = catalog.getAllModels().length;
  console.log(`Models loaded: ${modelCount}`);

  ComposerAgent.setRegistry(registry);
  ComposerAgent.setCatalog(catalog);
  ResearchAgent.setDB(db);
  MemoryAgent.setDB(db);

  const groupId = options.group ?? 'default';

  if (!db.getGroup(groupId)) {
    db.insertGroup({
      id: groupId,
      channel: 'cli',
      name: groupId === 'default' ? 'CLI Chat' : groupId,
      trigger_word: config.triggerWord,
      execution_mode: config.executionMode,
    });
  }

  const sessionId = `sess_${uuidv4()}`;
  db.insertSession({
    id: sessionId,
    group_id: groupId,
    started_at: Math.floor(Date.now() / 1000),
  });

  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const guardrails = new Guardrails(db);
  const promptLoader = new PromptLoader();
  const episodic = new EpisodicMemory();
  const retriever = new Retriever(db);
  const compactor = new Compactor(db);
  const workingMemory = new WorkingMemory({
    profile: config.profile,
    maxTokens: config.maxWorkingTokens,
    summarizeThreshold: config.summarizeThreshold,
  });

  let systemPrompt: string;
  try {
    systemPrompt = await promptLoader.render('system/agent-base.toon', {
      PERSONA_NAME: config.persona,
      PERSONA_STYLE: config.personaStyle,
    });
  } catch {
    systemPrompt = `You are ${config.persona}, style: ${config.personaStyle}. You are an AI assistant.`;
  }
  workingMemory.setSystemTokens(workingMemory.estimateTokens(systemPrompt));

  const groupContext = await episodic.read(groupId);
  if (groupContext) {
    workingMemory.setSummaryTokens(workingMemory.estimateTokens(groupContext.slice(0, 500)));
  }

  const skillWatcher = new SkillWatcher('.claude/skills');
  skillWatcher.watch();

  const defaultProvider = registry.getDefault();
  console.log(`Persona: ${config.persona} (${config.personaStyle})`);
  console.log(`Default provider: ${defaultProvider?.name ?? 'auto-select'}`);
  console.log('Type /quit to exit, /status for system info\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You > ',
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const userInput = line.trim();
    if (!userInput) {
      rl.prompt();
      return;
    }

    if (userInput === '/quit' || userInput === '/exit') {
      console.log('\nGoodbye!');
      skillWatcher.close();
      db.endSession(sessionId, 'Chat ended by user', '', conversationHistory.length);
      db.close();
      rl.close();
      return;
    }

    if (userInput === '/status') {
      const models = catalog.getAllModels();
      const providers = registry.listIds();
      const skills = skillWatcher.listSkills();
      const budget = workingMemory.getBudget();
      console.log(`\n  Providers: ${providers.join(', ')}`);
      console.log(`  Models loaded: ${models.length}`);
      console.log(`  Group: ${groupId}`);
      console.log(`  Persona: ${config.persona} (${config.personaStyle})`);
      console.log(`  Session: ${sessionId}`);
      console.log(`  Messages: ${conversationHistory.length}`);
      console.log(`  Skills: ${skills.length}`);
      console.log(`  Memory: ${Math.round(budget.utilizationPercent)}% used (${budget.totalTokens}/${budget.maxTokens} tokens)\n`);
      rl.prompt();
      return;
    }

    // Skill command handler
    if (userInput.startsWith('/')) {
      const command = userInput.trim();
      const skill = skillWatcher.getSkill(command);
      if (skill) {
        console.log(`\n[Skill] Running ${skill.name}...`);
        for (const envVar of skill.requiredEnvVars ?? []) {
          if (!process.env[envVar]) {
            const ri = readline.createInterface({ input: process.stdin, output: process.stdout });
            const value = await new Promise<string>(resolve => {
              ri.question(`  ${skill.name} needs ${envVar}: `, answer => {
                ri.close();
                resolve(answer.trim());
              });
            });
            process.env[envVar] = value;
            fs.appendFileSync('.env', `\n${envVar}=${value}\n`);
            console.log(`  Saved ${envVar} to .env`);
          }
        }
        console.log(`[Skill] ${skill.description}`);
        rl.prompt();
        return;
      } else {
        console.log(`Unknown command: ${command}. Type /status for system info.`);
        rl.prompt();
        return;
      }
    }

    try {
      // 1. GUARDRAILS INPUT
      const inputResult = guardrails.processInput(userInput, groupId);
      if (!inputResult.allowed) {
        console.log(`\n[Blocked] ${inputResult.events[0]?.details ?? 'Input rejected'}\n`);
        rl.prompt();
        return;
      }
      const safeInput = inputResult.content;

      // 2. WORKING MEMORY — add user message and check budget
      workingMemory.addMessage('user', safeInput);
      if (workingMemory.needsSummarization()) {
        const msgs = workingMemory.getMessagesForSummarization();
        if (msgs.length > 0) {
          const summary = compactor.summarize(msgs.map(m => ({ role: m.role, content: m.content })));
          workingMemory.applySummarization(summary, msgs.length);
          const budget = workingMemory.getBudget();
          console.log(`[Memory] Compacted ${msgs.length} messages. Context ${Math.round(budget.utilizationPercent)}% used.`);
        }
      }

      // 3. RAG RETRIEVAL
      const ragResults = retriever.retrieve(safeInput, groupId, 3);
      if (ragResults.length > 0) {
        const ragContext = ragResults.map(r => r.content).join('\n---\n');
        workingMemory.setRagTokens(workingMemory.estimateTokens(ragContext));
      }

      // 4. RECORD USER MESSAGE IN DB
      db.insertMessage({
        id: `msg_${uuidv4()}`,
        group_id: groupId,
        sender_id: 'user',
        content: safeInput,
        timestamp: Math.floor(Date.now() / 1000),
        channel: 'cli',
        processed: 0,
      });

      conversationHistory.push({ role: 'user', content: safeInput });

      // 5. PLAN THE TASK
      const planner = new PlannerAgent();
      const planResult = await planner.execute({
        id: crypto.randomUUID(),
        type: 'planner',
        brief: safeInput,
        groupId,
        sessionId,
      });

      const planBlocks = parseAll(planResult.output);
      const planBlock = planBlocks.find(b => b.type === 'plan');

      // 6. EXECUTE THE DAG
      const agentMap: Record<string, { execute: (task: { id: string; type: string; brief: string; groupId: string; sessionId: string }) => Promise<{ output: string }> }> = {
        research: new ResearchAgent(),
        execution: new ExecutionAgent(),
        memory: new MemoryAgent(),
        composer: new ComposerAgent(),
      };

      let agentResults: Map<string, string>;

      if (planBlock?.data['steps'] && Array.isArray(planBlock.data['steps']) && (planBlock.data['steps'] as unknown[]).length > 0) {
        const nodes = buildDAGNodes(planBlock);

        if (nodes.length > 0) {
          const completedResults = new Map<string, string>();

          agentResults = await executeDAG(nodes, async (node) => {
            const agent = agentMap[node.agentType];
            if (!agent) return encode('error', { msg: `Unknown agent: ${node.agentType}` });

            let brief = node.brief;
            if (node.agentType === 'composer') {
              const parts: string[] = [`User asked: ${safeInput}`];
              for (const [, output] of completedResults) {
                parts.push(output);
              }
              brief = parts.join('\n');
            }

            const result = await agent.execute({
              id: node.id,
              type: node.agentType,
              brief,
              groupId,
              sessionId,
            });
            completedResults.set(node.id, result.output);
            return result.output;
          });
        } else {
          agentResults = new Map();
        }
      } else {
        agentResults = new Map();
      }

      // Find composer output from DAG results (node ID may be 'step_N', not 'composer')
      let composerNodeId: string | undefined;
      if (planBlock?.data['steps'] && Array.isArray(planBlock.data['steps'])) {
        const nodes = buildDAGNodes(planBlock);
        composerNodeId = nodes.find(n => n.agentType === 'composer')?.id;
      }
      const dagComposerOutput = composerNodeId ? agentResults.get(composerNodeId) : agentResults.get('composer');

      // If no composer ran via DAG, run the simple research+compose cycle
      if (!dagComposerOutput) {
        const researchAgent = new ResearchAgent();
        const composerAgent = new ComposerAgent();

        const researchResult = await researchAgent.execute({
          id: crypto.randomUUID(),
          type: 'research',
          brief: safeInput,
          groupId,
          sessionId,
        });

        const composeResult = await composerAgent.execute({
          id: crypto.randomUUID(),
          type: 'composer',
          brief: `User asked: ${safeInput}\nResearch: ${researchResult.output}`,
          groupId,
          sessionId,
        });
        agentResults.set('composer', composeResult.output);
      }

      // 7. GET FINAL RESPONSE
      const composerOutput = dagComposerOutput ?? agentResults.get('composer') ?? '';
      let finalResponse = extractHumanResponse(composerOutput);
      if (!finalResponse) finalResponse = composerOutput;

      // 8. GUARDRAILS OUTPUT
      const outputResult = guardrails.processOutput(finalResponse, groupId);
      const safeOutput = outputResult.content;

      // 9. SELECT MODEL FOR DISPLAY
      const complexity = estimateComplexity(safeInput);
      const selectedModel = selectModel(catalog, complexity);

      // 10. PRINT AND PERSIST
      process.stdout.write(`\nMC [${options.model ?? selectedModel?.model.model_id ?? 'auto'}] > `);
      console.log(safeOutput);
      console.log('');

      workingMemory.addMessage('assistant', safeOutput);
      conversationHistory.push({ role: 'assistant', content: safeOutput });

      db.insertMessage({
        id: `msg_${uuidv4()}`,
        group_id: groupId,
        sender_id: 'assistant',
        content: safeOutput,
        timestamp: Math.floor(Date.now() / 1000),
        channel: 'cli',
        processed: 1,
      });

      // 11. UPDATE EPISODIC MEMORY
      const memAgent = new MemoryAgent();
      await memAgent.execute({
        id: crypto.randomUUID(),
        type: 'memory',
        brief: `SUMMARIZE and save this to memory: User said "${safeInput}". Assistant responded: "${safeOutput.slice(0, 200)}"`,
        groupId,
        sessionId,
      });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`\nError: ${errorMsg}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    skillWatcher.close();
    db.endSession(sessionId, 'Session closed', '', conversationHistory.length);
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
