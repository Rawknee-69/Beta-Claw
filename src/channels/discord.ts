import { Client, GatewayIntentBits, Events } from 'discord.js';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';

type MessageHandler = (msg: InboundMessage) => void | Promise<void>;

export class DiscordChannel implements IChannel {
  readonly id = 'discord';
  readonly name = 'Discord';
  private client: Client | null = null;
  private handlers: MessageHandler[] = [];

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async connect(): Promise<void> {
    const token = process.env['DISCORD_BOT_TOKEN'];
    if (!token) {
      console.warn('[discord] DISCORD_BOT_TOKEN not set. Channel disabled.');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      const text = message.content;
      const trigger = process.env['TRIGGER_WORD'] ?? '@Andy';
      const isMentioned = this.client?.user ? message.mentions.users.has(this.client.user.id) : false;

      if (!isMentioned && !text.includes(trigger)) return;

      const content = text.replace(/<@\d+>/g, '').replace(trigger, '').trim();
      const groupId = `dc_${message.channelId}`;

      const inbound: InboundMessage = {
        id: message.id,
        groupId,
        senderId: message.author.id,
        content,
        timestamp: message.createdTimestamp,
      };

      for (const handler of this.handlers) {
        await handler(inbound);
      }
    });

    this.client.on(Events.Error, (err) => console.error('[discord] Error:', err));

    await this.client.login(token);
    console.log(`[discord] Connected as ${this.client.user?.tag ?? 'unknown'}`);
  }

  async disconnect(): Promise<void> {
    this.client?.destroy();
    this.client = null;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.client) return;
    const channelId = msg.groupId.replace('dc_', '');
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const chunks = chunkText(msg.content, 1900);
    for (const chunk of chunks) {
      const textChannel = channel as unknown as { send(o: { content: string }): Promise<unknown> };
      await textChannel.send({ content: chunk });
    }
  }

  supportsFeature(f: ChannelFeature): boolean {
    const supported = new Set<ChannelFeature>(['markdown', 'images', 'files', 'reactions', 'threads']);
    return supported.has(f);
  }
}

function chunkText(t: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += n) out.push(t.slice(i, i + n));
  return out;
}
