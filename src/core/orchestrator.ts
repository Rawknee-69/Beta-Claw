import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MicroClawDB } from '../db.js';
import type { ResourceProfile } from '../db.js';
import type { IChannel, InboundMessage } from '../channels/interface.js';
import type { IProviderAdapter } from '../providers/interface.js';
import { ProviderRegistry } from './provider-registry.js';
import { DEFAULT_CATALOG, type ModelEntry } from './model-catalog.js';
import { selectModel } from './model-selector.js';
import { agentLoop } from './agent-loop.js';
import { buildSystemPrompt } from './prompt-builder.js';
import { TaskScheduler } from '../scheduler/task-scheduler.js';
import { HeartbeatScheduler } from '../scheduler/heartbeat-scheduler.js';
import { SkillWatcher } from './skill-watcher.js';
import pino from 'pino';
import { DB_PATH } from './paths.js';
import { MessageQueue, type QueueConfig } from '../execution/message-queue.js';
import { withRetry, getRetryConfig } from '../execution/retry-policy.js';
import { suggestWebSearch, type HistoryMessage } from './complexity-estimator.js';
import { oneShotScheduler } from '../execution/one-shot-scheduler.js';
import { extractAndPersist } from '../memory/post-turn-extractor.js';
import { hookRegistry } from '../hooks/hook-registry.js';
import { sendWithInterception } from '../channels/response-interceptor.js';
import { stopAllContainers, DEFAULT_SANDBOX_CONFIG, type SandboxRunOptions, type SandboxConfig } from '../execution/sandbox.js';
import { z } from 'zod';
import { initGmailManager, gmailManager } from '../gmail/gmail-manager.js';
import { browserManager } from '../browser/browser-manager.js';
import { scheduleClawHubSync, stopClawHubSync } from '../skills/clawhub-sync.js';

/** Read executionMode from .micro/config.toon without a full parse — just regex. */
function readExecutionMode(): 'isolated' | 'full_control' {
  try {
    const configPath = path.join('.micro', 'config.toon');
    if (!fs.existsSync(configPath)) return 'isolated';
    const content = fs.readFileSync(configPath, 'utf-8');
    const match = content.match(/executionMode\s*:\s*([\w_]+)/);
    if (match?.[1] === 'full_control') return 'full_control';
  } catch { /* ignore */ }
  return 'isolated';
}

const SANDBOX_CONFIG_FULL: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, mode: 'off' };
const runtimeSandboxConfig: SandboxConfig =
  readExecutionMode() === 'full_control' ? SANDBOX_CONFIG_FULL : DEFAULT_SANDBOX_CONFIG;

const InboundMessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  senderId: z.string(),
  content: z.string(),
  timestamp: z.number(),
  replyToId: z.string().optional(),
});

interface OrchestratorEvent {
  type: 'message' | 'scheduled_task' | 'webhook' | 'ipc' | 'skill_reload' | 'shutdown';
  groupId?: string;
  payload: unknown;
  timestamp: number;
}

interface OrchestratorConfig {
  dbPath: string;
  profile: ResourceProfile;
  maxConcurrentGroups: number;
  logLevel: pino.Level;
  verbose?: boolean;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  dbPath: DB_PATH,
  profile: 'standard',
  maxConcurrentGroups: 3,
  logLevel: 'info',
  verbose: false,
};

// ANSI helpers for verbose console output
const VC = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[96m',
  yellow:  '\x1b[93m',
  green:   '\x1b[92m',
  magenta: '\x1b[35m',
  red:     '\x1b[91m',
  gray:    '\x1b[90m',
  blue:    '\x1b[94m',
};
function vlog(tag: string, color: string, msg: string, detail?: string): void {
  const ts = new Date().toTimeString().slice(0, 8);
  const tagStr = `${color}${VC.bold}[${tag}]${VC.reset}`;
  const tsStr  = `${VC.gray}${ts}${VC.reset}`;
  const detStr = detail ? ` ${VC.dim}${detail}${VC.reset}` : '';
  console.log(`${tsStr} ${tagStr} ${msg}${detStr}`);
}

function formatToolDetail(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'exec':       return `$ ${String(args['cmd'] ?? '')}`;
    case 'write':      return `→ ${String(args['path'] ?? '')} (${String(args['content'] ?? '').length} chars)`;
    case 'read':       return `← ${String(args['path'] ?? '')}`;
    case 'list':       return `dir ${String(args['path'] ?? '')}`;
    case 'web_search': return `🔍 ${String(args['query'] ?? '')}`;
    case 'web_fetch':  return `GET ${String(args['url'] ?? '')}`;
    case 'browser':    return `[${String(args['action'] ?? '')}] ${String(args['url'] ?? args['selector'] ?? args['text'] ?? args['script'] ?? '')}`;
    case 'memory_write': return String(args['content'] ?? '').slice(0, 80);
    default:           return JSON.stringify(args).slice(0, 120);
  }
}

class Orchestrator extends EventEmitter {
  private readonly db: MicroClawDB;
  private readonly config: OrchestratorConfig;
  private readonly logger: pino.Logger;
  private readonly channels: Map<string, IChannel> = new Map();
  private readonly providers: Map<string, IProviderAdapter> = new Map();
  private readonly registry: ProviderRegistry = new ProviderRegistry();
  private readonly messageQueue: MessageQueue = new MessageQueue();
  private readonly skillWatcher: SkillWatcher = new SkillWatcher();
  private readonly queueConfig: Partial<QueueConfig> = { mode: 'collect', debounceMs: 1000, cap: 20, drop: 'summarize' };
  private catalog: ModelEntry[] = [];
  private scheduler: TaskScheduler | null = null;
  private heartbeatScheduler: HeartbeatScheduler | null = null;
  private running = false;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = pino({ level: this.config.logLevel });
    this.db = new MicroClawDB(this.config.dbPath, this.config.profile);

    this.messageQueue.setHandler(async (entry) => {
      const { msg, channel: ch } = entry;
      if (this.config.verbose) {
        vlog('MSG', VC.cyan, `[${ch.id}] ${msg.groupId}`, `"${msg.content.slice(0, 80)}${msg.content.length > 80 ? '…' : ''}"`);
      }
      await ch.sendTyping?.(msg.groupId).catch(() => {});
      const result = await this.handleMessage(msg, ch).catch((e: unknown) => {
        this.logger.error({ err: e, groupId: msg.groupId }, 'Error processing message');
        if (this.config.verbose) vlog('ERR', VC.red, `${e instanceof Error ? e.message : String(e)}`);
        return { response: `Error: ${e instanceof Error ? e.message : String(e)}`, modelId: '' };
      });
      const { response, modelId: usedModelId } = result;
      if (this.config.verbose) {
        vlog('SEND', VC.green, `[${ch.id}] ${msg.groupId}`, `${response.length} chars`);
      }
      const retryCfg = getRetryConfig(ch.id);
      try {
        const isRemoteChannel = ch.id !== 'cli';
        if (isRemoteChannel && usedModelId) {
          await withRetry(
            () => sendWithInterception(ch, { groupId: msg.groupId, content: response }, usedModelId, msg.groupId),
            retryCfg,
          );
        } else {
          await withRetry(
            () => ch.send({ groupId: msg.groupId, content: response }),
            retryCfg,
          );
        }
      } catch (e) {
        this.logger.error({ err: e, channel: ch.id, groupId: msg.groupId }, 'Send failed — logged, not rethrown');
        if (this.config.verbose) vlog('ERR', VC.red, `Send failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.on('event', (event: OrchestratorEvent) => {
      void this.handleEvent(event);
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger.info({ profile: this.config.profile }, 'Orchestrator starting');

    // Gmail manager (loads saved accounts)
    initGmailManager();

    this.skillWatcher.watch();
    const availableProviderIds = new Set(this.registry.listIds());
    this.catalog = DEFAULT_CATALOG.filter(m => availableProviderIds.has(m.provider_id));

    for (const [, channel] of this.channels) {
      channel.onMessage((msg: InboundMessage) => {
        const parsed = InboundMessageSchema.safeParse(msg);
        if (!parsed.success) {
          this.logger.warn({ err: parsed.error }, 'Invalid message dropped');
          return;
        }
        this.enqueue(msg, channel);
      });
      await channel.connect();
    }

    const whatsappCh = this.channels.get('whatsapp');
    const schedulerWhatsappSend = whatsappCh
      ? (to: string, message: string) => whatsappCh.send({ groupId: to, content: message })
      : undefined;

    this.scheduler = new TaskScheduler(this.db, this.registry, this.catalog, schedulerWhatsappSend, async (groupId, text) => {
      const prefix = groupId.split('_')[0] ?? '';
      const targetChannel = Array.from(this.channels.values()).find(c =>
        (prefix === 'tg' && c.id === 'telegram') ||
        (prefix === 'dc' && c.id === 'discord') ||
        (c.id === 'whatsapp'),
      );
      await targetChannel?.send({ groupId, content: text });
    });
    this.scheduler.start();

    this.heartbeatScheduler = new HeartbeatScheduler({
      db: this.db,
      registry: this.registry,
      catalog: this.catalog,
      deliver: async (groupId, text) => {
        const prefix = groupId.split('_')[0] ?? '';
        const targetChannel = Array.from(this.channels.values()).find(c =>
          (prefix === 'tg' && c.id === 'telegram') ||
          (prefix === 'dc' && c.id === 'discord') ||
          (c.id === 'whatsapp'),
        );
        await targetChannel?.send({ groupId, content: text });
      },
      logger: this.logger,
    });
    this.heartbeatScheduler.start();

    // Init one-shot scheduler — deliver the message DIRECTLY to the channel.
    // Do NOT pass through handleMessage/agentLoop: the AI already wrote the
    // exact reminder text; running it through the LLM would cause it to be
    // interpreted as a new user request and re-schedule itself infinitely.
    oneShotScheduler.init(async (schedMsg) => {
      const prefix = schedMsg.groupId.split('_')[0] ?? '';
      const targetChannel = Array.from(this.channels.values()).find(c =>
        (prefix === 'tg' && c.id === 'telegram') ||
        (prefix === 'dc' && c.id === 'discord') ||
        (c.id === 'whatsapp'),
      ) ?? Array.from(this.channels.values())[0];
      if (targetChannel) {
        if (this.config.verbose) {
          vlog('SCHED', VC.magenta, schedMsg.groupId, `"${schedMsg.content.slice(0, 60)}"`);
        }
        await targetChannel.send({ groupId: schedMsg.groupId, content: schedMsg.content })
          .catch(e => this.logger.warn({ err: e, groupId: schedMsg.groupId }, 'One-shot delivery failed'));
      } else {
        this.logger.warn({ groupId: schedMsg.groupId }, 'One-shot: no channel found for delivery');
      }
    });

    // Load hooks and fire gateway:startup
    await hookRegistry.load();
    await hookRegistry.fire({
      type: 'gateway', action: 'startup', sessionKey: 'main',
      timestamp: new Date(), messages: [], context: {},
    });

    // Start Gmail watches for all registered accounts
    for (const acct of gmailManager.listAccounts()) {
      if (acct.deliverTo) {
        await gmailManager.startWatch(acct.account).catch(e =>
          this.logger.warn({ err: e, account: acct.account }, 'Gmail watch failed'),
        );
      }
    }

    // ClawHub background sync (every 24h, checks for skill updates)
    scheduleClawHubSync();

    this.processPendingIpc();
    this.startOnceTaskPoller();
    this.logger.info('Orchestrator started — event-driven with agent loop');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.logger.info('Orchestrator shutting down');

    this.scheduler?.stop();
    this.heartbeatScheduler?.stop();
    this.skillWatcher.close();
    stopClawHubSync();

    for (const [, channel] of this.channels) {
      await channel.disconnect();
    }

    await browserManager.closeAll();
    await stopAllContainers();
    this.db.close();
    this.emit('event', {
      type: 'shutdown',
      payload: null,
      timestamp: Date.now(),
    } satisfies OrchestratorEvent);
    this.removeAllListeners();
    this.logger.info('Orchestrator stopped');
  }

  registerChannel(channel: IChannel): void {
    this.channels.set(channel.id, channel);
    this.logger.info({ channelId: channel.id }, 'Channel registered');
  }

  registerProvider(provider: IProviderAdapter): void {
    this.providers.set(provider.id, provider);
    this.registry.register(provider);
    this.logger.info({ providerId: provider.id }, 'Provider registered');
  }

  getProvider(id: string): IProviderAdapter | undefined {
    return this.providers.get(id);
  }

  getChannel(id: string): IChannel | undefined {
    return this.channels.get(id);
  }

  getDB(): MicroClawDB {
    return this.db;
  }

  isRunning(): boolean {
    return this.running;
  }

  queueStats(): ReturnType<MessageQueue['stats']> {
    return this.messageQueue.stats();
  }

  private buildSandboxOpts(groupId: string, sessionKey: string, isMain: boolean): SandboxRunOptions {
    return {
      sessionKey,
      agentId:  'main',
      isMain,
      elevated: 'off',
      groupId,
      cfg:      runtimeSandboxConfig,
    };
  }

  private enqueue(msg: InboundMessage, channel: IChannel): void {
    this.messageQueue.enqueue(msg, channel, this.queueConfig);
  }

  private async handleMessage(msg: InboundMessage, channel: IChannel): Promise<{ response: string; modelId: string }> {
    this.db.insertMessage({
      id: msg.id,
      group_id: msg.groupId,
      sender_id: msg.senderId,
      content: msg.content,
      timestamp: msg.timestamp,
      channel: channel.id,
      reply_to_id: msg.replyToId ?? null,
      processed: 0,
      error: null,
      content_redacted: null,
    });

    this.db.updateGroupLastActive(msg.groupId);

    const history = this.db.getMessages(msg.groupId, 40);

    if (this.config.verbose) {
      const ctxChars = history.reduce((n, m) => n + m.content.length, 0);
      vlog('CTX', VC.blue, `${history.length} msgs`, `~${ctxChars} chars from ${msg.groupId.slice(0, 20)}`);
    }

    const messages = history.map(m => ({
      role: (m.sender_id === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));

    const historyForTier: HistoryMessage[] = messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const lastAssistant = [...history].reverse().find(m => m.sender_id === 'assistant');
    const recentToolUse = Boolean(lastAssistant && /\b(exec|write|read|web_search|web_fetch|browser|memory_write)\b/.test(lastAssistant.content));

    const sel = selectModel(this.catalog, msg.content, { history: historyForTier, recentToolUse });
    if (!sel) return { response: 'No model available. Run `microclaw provider add`.', modelId: '' };

    const provider = this.registry.get(sel.model.provider_id);
    if (!provider) return { response: `Provider ${sel.model.provider_id} not connected.`, modelId: '' };

    if (this.config.verbose) {
      vlog('MODEL', VC.magenta, `${sel.model.id}`, `tier=${sel.tier}`);
    }

    const recentHistory = this.db.getMessages(msg.groupId, 5);
    const lastAssistantMsg = [...recentHistory].reverse().find(m => m.sender_id === 'assistant')?.content;

    const toolHint = suggestWebSearch(msg.content, lastAssistantMsg);

    const skills = this.skillWatcher.listSkills();

    // Fire agent:bootstrap hook
    const bootstrapFiles: Array<{ path: string; content: string }> = [];
    await hookRegistry.fire({
      type: 'agent', action: 'bootstrap',
      sessionKey: msg.senderId, timestamp: new Date(), messages: [],
      context: { groupId: msg.groupId, bootstrapFiles },
    });

    const systemPrompt = await buildSystemPrompt({
      groupId: msg.groupId,
      skills,
      context: { senderId: msg.senderId, channel: channel.id },
      db: this.db,
      lastUserMessage: msg.content,
      toolHint: toolHint || undefined,
      lastAssistantMessage: lastAssistantMsg,
      modelId: sel.model.id,
    });

    const sessionKey = `${channel.id}-${msg.groupId}`;
    const isMain = channel.id === 'cli';
    const sandboxOpts = this.buildSandboxOpts(msg.groupId, sessionKey, isMain);

    const response = await agentLoop(messages, {
      provider,
      model: sel.model,
      systemPrompt,
      db: this.db,
      groupId: msg.groupId,
      senderId: msg.senderId,
      sessionKey,
      sandboxOpts,
      onLLMCall: (iter, msgs) => {
        if (this.config.verbose) {
          vlog('LLM', VC.cyan, `round ${iter + 1}`, `model=${sel.model.id}  msgs=${msgs}`);
        }
      },
      onToolStart: (name, args) => {
        this.logger.info({ tool: name }, 'Tool called');
        if (this.config.verbose) {
          const detail = formatToolDetail(name, args);
          vlog('TOOL', VC.yellow, `→ ${name}`, detail);
        }
      },
      onToolCall: (name, _args, result) => {
        if (this.config.verbose) {
          const resultPreview = result.length > 400 ? result.slice(0, 400) + '…' : result;
          vlog('RSLT', VC.gray, `← ${name}`, resultPreview.replace(/\n/g, ' ↵ '));
        }
      },
    });

    if (this.config.verbose) {
      vlog('DONE', VC.green, `${response.length} chars`, `model=${sel.model.id}`);
    }

    const responseId = randomUUID();
    this.db.insertMessage({
      id: responseId,
      group_id: msg.groupId,
      sender_id: 'assistant',
      content: response,
      timestamp: Date.now(),
      channel: channel.id,
      processed: 1,
    });

    void extractAndPersist({
      userMsg: msg.content,
      assistantReply: response,
      groupId: msg.groupId,
      db: this.db,
      registry: this.registry,
      catalog: this.catalog,
    }).catch(() => { /* swallow silently */ });

    return { response, modelId: sel.model.id };
  }

  private async handleEvent(event: OrchestratorEvent): Promise<void> {
    if (!this.running && event.type !== 'shutdown') return;

    switch (event.type) {
      case 'scheduled_task':
        this.logger.info('Scheduled task handled via TaskScheduler');
        break;
      case 'webhook':
        this.logger.info('Webhook handling (placeholder)');
        break;
      case 'ipc':
        this.logger.info('IPC handling (placeholder)');
        break;
      case 'skill_reload':
        this.logger.info('Skills reloaded');
        break;
      case 'shutdown':
        this.logger.info('Shutdown event received');
        break;
      case 'message':
        break;
    }
  }

  private processPendingIpc(): void {
    const pending = this.db.getUnprocessedIpcMessages();
    for (const msg of pending) {
      this.emit('event', {
        type: 'ipc',
        payload: msg,
        timestamp: Date.now(),
      } satisfies OrchestratorEvent);
      this.db.markIpcProcessed(msg.id);
    }
  }

  private startOnceTaskPoller(): void {
    const poll = () => {
      if (!this.running) return;
      try {
        const tasks = this.db.getPendingOnceTasks();
        for (const task of tasks) {
          const delayMs = Math.max(0, task.run_at - Date.now());
          this.db.markOnceTaskPickedUp(task.id);
          oneShotScheduler.scheduleOnce(task.group_id, task.message, delayMs);
          this.logger.info({ id: task.id, groupId: task.group_id, delayMs }, 'One-shot task picked up from DB');
        }
      } catch (e) {
        this.logger.warn({ err: e }, 'Once-task poller error');
      }
      if (this.running) setTimeout(poll, 5_000);
    };
    setTimeout(poll, 2_000);
  }
}

// Cleanup on process exit
process.on('SIGTERM', async () => { await browserManager.closeAll(); await stopAllContainers(); process.exit(0); });
process.on('SIGINT',  async () => { await browserManager.closeAll(); await stopAllContainers(); process.exit(0); });

export { Orchestrator };
export type { OrchestratorEvent, OrchestratorConfig };
