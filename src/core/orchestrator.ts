import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
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
import pino from 'pino';

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
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  dbPath: 'microclaw.db',
  profile: 'standard',
  maxConcurrentGroups: 3,
  logLevel: 'info',
};

class Orchestrator extends EventEmitter {
  private readonly db: MicroClawDB;
  private readonly config: OrchestratorConfig;
  private readonly logger: pino.Logger;
  private readonly channels: Map<string, IChannel> = new Map();
  private readonly providers: Map<string, IProviderAdapter> = new Map();
  private readonly registry: ProviderRegistry = new ProviderRegistry();
  private readonly groupLocks = new Map<string, Promise<void>>();
  private catalog: ModelEntry[] = [];
  private scheduler: TaskScheduler | null = null;
  private running = false;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = pino({ level: this.config.logLevel });
    this.db = new MicroClawDB(this.config.dbPath, this.config.profile);

    this.on('event', (event: OrchestratorEvent) => {
      void this.handleEvent(event);
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger.info({ profile: this.config.profile }, 'Orchestrator starting');

    const availableProviderIds = new Set(this.registry.listIds());
    this.catalog = DEFAULT_CATALOG.filter(m => availableProviderIds.has(m.provider_id));

    for (const [, channel] of this.channels) {
      channel.onMessage((msg: InboundMessage) => {
        this.enqueue(msg, channel);
      });
      await channel.connect();
    }

    this.scheduler = new TaskScheduler(this.db, this.registry, this.catalog, async (groupId, text) => {
      const prefix = groupId.split('_')[0] ?? '';
      const targetChannel = Array.from(this.channels.values()).find(c =>
        (prefix === 'tg' && c.id === 'telegram') ||
        (prefix === 'dc' && c.id === 'discord') ||
        (c.id === 'whatsapp'),
      );
      await targetChannel?.send({ groupId, content: text });
    });
    this.scheduler.start();

    this.processPendingIpc();
    this.logger.info('Orchestrator started — event-driven with agent loop');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.logger.info('Orchestrator shutting down');

    this.scheduler?.stop();

    for (const [, channel] of this.channels) {
      await channel.disconnect();
    }

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

  private enqueue(msg: InboundMessage, channel: IChannel): void {
    const existing = this.groupLocks.get(msg.groupId) ?? Promise.resolve();
    const next = existing.then(async () => {
      try {
        const response = await this.handleMessage(msg, channel);
        await channel.send({ groupId: msg.groupId, content: response });
      } catch (e) {
        this.logger.error({ err: e, groupId: msg.groupId }, 'Error processing message');
        await channel.send({ groupId: msg.groupId, content: `Error: ${e instanceof Error ? e.message : String(e)}` }).catch(() => {});
      }
    });
    this.groupLocks.set(msg.groupId, next);
    next.finally(() => {
      if (this.groupLocks.get(msg.groupId) === next) this.groupLocks.delete(msg.groupId);
    });
  }

  private async handleMessage(msg: InboundMessage, channel: IChannel): Promise<string> {
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

    const history = this.db.getMessages(msg.groupId, 20);
    const messages = history.map(m => ({
      role: (m.sender_id === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));

    const sel = selectModel(this.catalog, msg.content);
    if (!sel) return 'No model available. Run `microclaw provider add`.';

    const provider = this.registry.get(sel.model.provider_id);
    if (!provider) return `Provider ${sel.model.provider_id} not connected.`;

    const systemPrompt = await buildSystemPrompt(msg.groupId);

    const response = await agentLoop(messages, {
      provider,
      model: sel.model,
      systemPrompt,
      db: this.db,
      groupId: msg.groupId,
      onToolCall: (name) => this.logger.info({ tool: name }, 'Tool called'),
    });

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

    this.scheduler?.refresh();

    return response;
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
}

export { Orchestrator };
export type { OrchestratorEvent, OrchestratorConfig };
