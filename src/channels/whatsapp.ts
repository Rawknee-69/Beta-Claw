import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';
import { OutboundMessageSchema } from './interface.js';

const WhatsAppConfigSchema = z.object({
  authDir: z.string().default('.whatsapp-auth'),
  printQRInTerminal: z.boolean().default(true),
  retryOnDisconnect: z.boolean().default(true),
  maxRetries: z.number().int().min(0).default(5),
});

type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
type MessageHandler = (msg: InboundMessage) => void;

const SUPPORTED_FEATURES: ReadonlySet<ChannelFeature> = new Set([
  'images',
  'files',
  'reactions',
]);

export class WhatsAppChannel implements IChannel {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';

  private readonly config: WhatsAppConfig;
  private readonly emitter = new EventEmitter();
  private handlers: MessageHandler[] = [];
  private connected = false;

  constructor(config?: Partial<WhatsAppConfig>) {
    this.config = WhatsAppConfigSchema.parse(config ?? {});
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.emitter.emit('connecting');
    this.connected = true;
    this.emitter.emit('connected');
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.emitter.emit('disconnecting');
    this.connected = false;
    this.emitter.emit('disconnected');
  }

  async send(msg: OutboundMessage): Promise<void> {
    const validated = OutboundMessageSchema.parse(msg);
    if (!this.connected) {
      throw new Error('WhatsApp channel is not connected');
    }
    this.emitter.emit('messageSent', validated);
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  supportsFeature(f: ChannelFeature): boolean {
    return SUPPORTED_FEATURES.has(f);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConfig(): Readonly<WhatsAppConfig> {
    return this.config;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.emitter.on(event, listener);
  }

  /**
   * Simulate an incoming message (used internally or for testing).
   * In production, Baileys socket events would call this.
   */
  handleIncomingMessage(rawJid: string, rawContent: string, groupId?: string): void {
    const IncomingSchema = z.object({
      jid: z.string().min(1),
      content: z.string().min(1),
      groupId: z.string().optional(),
    });
    const parsed = IncomingSchema.parse({ jid: rawJid, content: rawContent, groupId });

    const msg: InboundMessage = {
      id: randomUUID(),
      groupId: parsed.groupId ?? parsed.jid,
      senderId: parsed.jid,
      content: parsed.content,
      timestamp: Date.now(),
    };

    for (const handler of this.handlers) {
      handler(msg);
    }
  }
}
