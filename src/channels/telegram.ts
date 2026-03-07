import { Bot } from 'grammy';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';

type MessageHandler = (msg: InboundMessage) => void | Promise<void>;

export class TelegramChannel implements IChannel {
  readonly id = 'telegram';
  readonly name = 'Telegram';
  private bot: Bot | null = null;
  private handlers: MessageHandler[] = [];

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async connect(): Promise<void> {
    const token = process.env['TELEGRAM_BOT_TOKEN'];
    if (!token) {
      console.warn('[telegram] TELEGRAM_BOT_TOKEN not set. Channel disabled.');
      return;
    }

    this.bot = new Bot(token);

    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text ?? '';
      const trigger = process.env['TRIGGER_WORD'] ?? '@Andy';

      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      if (isGroup && !text.includes(trigger)) return;

      const content = isGroup ? text.replace(trigger, '').trim() : text.trim();
      const groupId = `tg_${ctx.chat.id}`;
      const senderId = String(ctx.from?.id ?? 'unknown');

      const inbound: InboundMessage = {
        id: String(ctx.message.message_id),
        groupId,
        senderId,
        content,
        timestamp: Date.now(),
      };

      for (const handler of this.handlers) {
        await handler(inbound);
      }
    });

    this.bot.catch((err) => console.error('[telegram] Error:', err));
    void this.bot.start({ drop_pending_updates: true });
    console.log('[telegram] Connected');
  }

  async disconnect(): Promise<void> {
    await this.bot?.stop();
    this.bot = null;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) return;
    const chatId = msg.groupId.replace('tg_', '');
    const chunks = chunkText(msg.content, 4096);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk);
    }
  }

  supportsFeature(f: ChannelFeature): boolean {
    const supported = new Set<ChannelFeature>(['markdown', 'images', 'files']);
    return supported.has(f);
  }
}

function chunkText(t: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += n) out.push(t.slice(i, i + n));
  return out;
}
