import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';

type MessageHandler = (msg: InboundMessage) => void | Promise<void>;

const AUTH_DIR = '.micro/whatsapp-auth';
const TRIGGER = process.env['TRIGGER_WORD'] ?? '@Andy';

const SUPPORTED_FEATURES: ReadonlySet<ChannelFeature> = new Set([
  'images',
  'files',
  'reactions',
]);

export class WhatsAppChannel implements IChannel {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';

  private readonly emitter = new EventEmitter();
  private handlers: MessageHandler[] = [];
  private connected = false;
  private sock: Record<string, unknown> | null = null;

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    fs.mkdirSync(AUTH_DIR, { recursive: true });

    try {
      /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      const baileys: any = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default ?? baileys.makeWASocket;
      const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      const sock: any = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
      });

      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update: any) => {
        if (update.qr) console.log('[whatsapp] Scan QR code to connect');
        if (update.connection === 'close') {
          const statusCode = update.lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            console.log('[whatsapp] Reconnecting...');
            setTimeout(() => void this.connect(), 3000);
          } else {
            console.log('[whatsapp] Logged out. Delete .micro/whatsapp-auth and restart.');
          }
        }
        if (update.connection === 'open') {
          this.connected = true;
          console.log('[whatsapp] Connected');
        }
      });

      sock.ev.on('messages.upsert', async (upsert: any) => {
        if (upsert.type !== 'notify') return;
        for (const msg of upsert.messages) {
          if (!msg.message || msg.key.fromMe) continue;
          const text: string =
            msg.message.conversation ??
            msg.message.extendedTextMessage?.text ??
            '';
          if (!text.includes(TRIGGER)) continue;

          const content = text.replace(TRIGGER, '').trim();
          const groupId: string = msg.key.remoteJid ?? 'default';
          const senderId: string = msg.key.participant ?? msg.key.remoteJid ?? 'unknown';
          const ts: number = typeof msg.messageTimestamp === 'number'
            ? msg.messageTimestamp * 1000
            : Date.now();

          const inbound: InboundMessage = {
            id: msg.key.id ?? `wa_${Date.now()}`,
            groupId,
            senderId,
            content,
            timestamp: ts,
          };

          for (const handler of this.handlers) {
            await handler(inbound);
          }
        }
      });
      /* eslint-enable */

      this.connected = true;
      this.emitter.emit('connected');
    } catch {
      console.warn('[whatsapp] @whiskeysockets/baileys not available or failed to connect. Channel disabled.');
      this.connected = false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      if (this.sock && typeof (this.sock as Record<string, unknown>)['logout'] === 'function') {
        await (this.sock as Record<string, (...a: unknown[]) => Promise<void>>)['logout']!();
      }
    } catch { /* ignore */ }
    this.sock = null;
    this.connected = false;
    this.emitter.emit('disconnected');
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const sendMessage = (this.sock as Record<string, (...a: unknown[]) => Promise<void>>)['sendMessage'];
    if (!sendMessage) throw new Error('WhatsApp socket has no sendMessage');
    const chunks = chunkText(msg.content, 4000);
    for (const chunk of chunks) {
      await sendMessage.call(this.sock, msg.groupId, { text: chunk });
    }
  }

  supportsFeature(f: ChannelFeature): boolean {
    return SUPPORTED_FEATURES.has(f);
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleIncomingMessage(rawJid: string, rawContent: string, groupId?: string): void {
    const msg: InboundMessage = {
      id: randomUUID(),
      groupId: groupId ?? rawJid,
      senderId: rawJid,
      content: rawContent,
      timestamp: Date.now(),
    };

    for (const handler of this.handlers) {
      void Promise.resolve(handler(msg));
    }
  }
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
