---
name: add-discord
command: /add-discord
description: Add Discord as a communication channel
requiredEnvVars:
  - DISCORD_BOT_TOKEN
requiredTools:
  - write_file
  - read_file
  - run_code
  - install_pkg
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Add Discord Skill

You are the Discord integration assistant. Set up a Discord bot as a communication channel for MicroClaw.

## Step 1: Bot Creation

If the user doesn't have a Discord bot yet:
1. Go to https://discord.com/developers/applications
2. Click "New Application", name it (e.g., "MicroClaw")
3. Go to the "Bot" tab, click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - **Message Content Intent** (required to read message text)
   - **Server Members Intent** (optional, for user identification)
5. Copy the bot token from the Bot tab
6. Go to "OAuth2" > "URL Generator":
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Attach Files`, `Use Slash Commands`
7. Copy the generated invite URL and open it to add the bot to a server

## Step 2: Collect Token

1. Prompt the user for their `DISCORD_BOT_TOKEN`.
2. Store the token in the encrypted vault.

## Step 3: Install Dependencies

Run: `npm install discord.js`

## Step 4: Create Channel Adapter

Create `src/channels/discord.ts` implementing the `IChannel` interface:

```typescript
import { Client, GatewayIntentBits, Events } from 'discord.js';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';

class DiscordChannel implements IChannel {
  id = 'discord';
  name = 'Discord';
  private client: Client;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;

  constructor(private token: string) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });
  }

  async connect(): Promise<void> {
    this.client.on(Events.MessageCreate, (msg) => {
      if (msg.author.bot || !this.messageHandler) return;
      this.messageHandler({
        id: msg.id,
        groupId: msg.channelId,
        senderId: msg.author.id,
        content: msg.content,
        timestamp: msg.createdTimestamp,
        replyToId: msg.reference?.messageId ?? undefined,
      });
    });
    await this.client.login(this.token);
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }

  async send(msg: OutboundMessage): Promise<void> {
    const channel = await this.client.channels.fetch(msg.groupId);
    if (channel?.isTextBased() && 'send' in channel) {
      await channel.send({
        content: msg.content,
        reply: msg.replyToId ? { messageReference: msg.replyToId } : undefined,
      });
    }
  }

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  supportsFeature(f: ChannelFeature): boolean {
    const supported: ChannelFeature[] = ['markdown', 'images', 'files', 'reactions', 'threads'];
    return supported.includes(f);
  }
}
```

Adapt to match the project's exact interface and coding conventions.

## Step 5: Register Channel

1. Add `discord` to the enabled channels list in `.micro/config.toon`.
2. Register the channel with the orchestrator.

## Step 6: Configure Bot Behavior

Ask the user:
- **Trigger mode**: Respond to all messages, only when mentioned (`@BotName`), or only to specific prefixes.
- **Allowed channels**: Restrict to specific Discord channel IDs (recommended for security).
- **Thread support**: Whether to create threads for long conversations.

## Step 7: Test Connection

1. Log in the bot and verify it connects to Discord's gateway.
2. Display the bot's username and discriminator.
3. Ask the user to send a test message in a channel the bot has access to.
4. Verify the message is received and a response is sent back.

## Step 8: Confirm

Report:
- Discord bot is connected and listening
- The bot is active in the servers it's been invited to
- Configured behavior (trigger mode, allowed channels)
- Bot token stored securely in vault
- To manage: use `/customize` to adjust Discord settings
