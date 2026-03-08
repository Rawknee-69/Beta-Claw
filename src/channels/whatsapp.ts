import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';

type MessageHandler = (msg: InboundMessage) => void | Promise<void>;

const AUTH_DIR = '.micro/whatsapp-auth';
// Trigger word is only required in GROUP chats to avoid responding to every message.
// In DMs (1-on-1) every message is processed without needing a trigger.
const TRIGGER = process.env['TRIGGER_WORD'] ?? '@rem';

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

      const { version } = await fetchLatestBaileysVersion();

      // Use pino with level 'silent' — Baileys requires a real pino-compatible logger
      const pino = (await import('pino')).default;
      const silentLogger = pino({ level: 'silent' });

      // Track whether we ever successfully opened to decide whether to wipe auth on retry.
      let everConnected = false;
      let qrCount = 0;
      // 515 = restartRequired — happens right after a successful QR scan; do NOT wipe auth.
      const RESTART_REQUIRED = 515;

      const startSocket = async (reconnectAfterClose = false): Promise<void> => {
        // Wipe auth only when showing a fresh QR (retry), not when reconnecting after 515 post-scan.
        if (!everConnected && qrCount > 0 && !reconnectAfterClose) {
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            fs.mkdirSync(AUTH_DIR, { recursive: true });
          } catch { /* ignore */ }
        }
        qrCount++;

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        const sock: any = makeWASocket({
          version,
          auth: state,
          logger: silentLogger,
          browser: ['MicroClaw', 'Desktop', '3.0.0'],
        });

        this.sock = sock;

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update: any) => {
          if (update.qr) {
            try {
              const qrTerminalMod = await import('qrcode-terminal');
              const qrTerminal = (qrTerminalMod.default ?? qrTerminalMod) as { generate: (qr: string, opts: { small: boolean }) => void };
              console.log('\n[whatsapp] Scan this QR code with WhatsApp → Linked Devices → Link a Device:\n');
              qrTerminal.generate(update.qr as string, { small: true });
              console.log('\n[whatsapp] Waiting for scan... If it refreshes, scan the newest one.\n');
            } catch {
              console.log('[whatsapp] QR code available — install qrcode-terminal to display it, or use microclaw setup to pair.');
            }
          }
          if (update.connection === 'open') {
            everConnected = true;
            this.connected = true;
            console.log('[whatsapp] Connected');
          }
          if (update.connection === 'close') {
            this.connected = false;
            const statusCode = update.lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
              console.log('[whatsapp] Logged out. Delete .micro/whatsapp-auth and restart.');
              return;
            }
            const isRestartRequired = statusCode === RESTART_REQUIRED;
            if (isRestartRequired) {
              console.log('[whatsapp] Reconnecting with your credentials...');
            } else {
              console.log('[whatsapp] Reconnecting...');
            }
            setTimeout(() => void startSocket(isRestartRequired), isRestartRequired ? 5000 : 3000);
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
            if (!text) continue;

            const remoteJid: string = msg.key.remoteJid ?? '';
            const isGroupChat = remoteJid.endsWith('@g.us');

            // In group chats require the trigger word; in DMs respond to everything
            if (isGroupChat && !text.includes(TRIGGER)) continue;

            // Mark message as read so double-ticks go blue in WhatsApp
            try {
              await sock.readMessages([msg.key]);
            } catch { /* non-fatal */ }

            const content = isGroupChat ? text.replace(TRIGGER, '').trim() : text.trim();
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
      };

      await startSocket();
      /* eslint-enable */

      // connected flag is set in connection.update → 'open', not here
      this.emitter.emit('connecting');
    } catch {
      console.warn('[whatsapp] @whiskeysockets/baileys not available or failed to connect. Channel disabled.');
      this.connected = false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      // Use end() to cleanly close the socket WITHOUT logging out from WhatsApp.
      // logout() removes the linked device permanently and requires re-scanning the QR.
      if (this.sock && typeof (this.sock as Record<string, unknown>)['end'] === 'function') {
        (this.sock as Record<string, (...a: unknown[]) => void>)['end']!();
      }
    } catch { /* ignore */ }
    this.sock = null;
    this.emitter.emit('disconnected');
  }

  async send(msg: OutboundMessage): Promise<void> {
    await this.waitForConnection();
    if (!this.sock) throw new Error('WhatsApp not connected');
    const sendMessage = (this.sock as Record<string, (...a: unknown[]) => Promise<void>>)['sendMessage'];
    if (!sendMessage) throw new Error('WhatsApp socket has no sendMessage');
    const chunks = chunkText(msg.content, 4000);
    for (const chunk of chunks) {
      await sendMessage.call(this.sock, msg.groupId, { text: chunk });
    }
  }

  private waitForConnection(timeoutMs = 15_000): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = setInterval(() => {
        if (this.connected) {
          clearInterval(check);
          resolve();
        } else if (Date.now() >= deadline) {
          clearInterval(check);
          reject(new Error('WhatsApp reconnection timed out'));
        }
      }, 250);
    });
  }

  supportsFeature(f: ChannelFeature): boolean {
    return SUPPORTED_FEATURES.has(f);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendTyping(jid: string): Promise<void> {
    if (!this.sock) return;
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      await (this.sock as any).sendPresenceUpdate('composing', jid);
      /* eslint-enable */
    } catch { /* non-fatal */ }
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
