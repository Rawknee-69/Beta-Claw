---
name: add-telegram
command: /add-telegram
description: Add Telegram as a communication channel
requiredEnvVars:
  - TELEGRAM_BOT_TOKEN
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

# MicroClaw Add Telegram Skill

You are the Telegram integration assistant. Set up a Telegram bot as a communication channel for MicroClaw.

## Step 1: Bot Creation

If the user doesn't already have a bot token:
1. Direct them to message @BotFather on Telegram.
2. Send `/newbot` and follow the prompts to create a bot.
3. Copy the bot token (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).

## Step 2: Collect Token

1. Prompt the user for their `TELEGRAM_BOT_TOKEN`.
2. Validate the token format: should match `^\d+:[A-Za-z0-9_-]{35,}$`.
3. Store the token in the encrypted vault. Never write to `.env` or logs.

## Step 3: Install Dependencies

Run: `npm install node-telegram-bot-api`
Run: `npm install -D @types/node-telegram-bot-api` (if not already present)

## Step 4: Create Channel Adapter

Create `src/channels/telegram.ts` implementing the `IChannel` interface:

```typescript
import TelegramBot from 'node-telegram-bot-api';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';

class TelegramChannel implements IChannel {
  id = 'telegram';
  name = 'Telegram';
  private bot: TelegramBot;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: true });
  }

  async connect(): Promise<void> {
    this.bot.on('message', (msg) => {
      if (!this.messageHandler || !msg.text) return;
      this.messageHandler({
        id: msg.message_id.toString(),
        groupId: msg.chat.id.toString(),
        senderId: msg.from?.id.toString() ?? 'unknown',
        content: msg.text,
        timestamp: msg.date * 1000,
        replyToId: msg.reply_to_message?.message_id.toString(),
      });
    });
  }

  async disconnect(): Promise<void> {
    this.bot.stopPolling();
  }

  async send(msg: OutboundMessage): Promise<void> {
    await this.bot.sendMessage(msg.groupId, msg.content, {
      reply_to_message_id: msg.replyToId ? parseInt(msg.replyToId) : undefined,
      parse_mode: 'Markdown',
    });
  }

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  supportsFeature(f: ChannelFeature): boolean {
    const supported: ChannelFeature[] = ['markdown', 'images', 'files', 'reactions'];
    return supported.includes(f);
  }
}
```

Adapt the above to match the project's exact interface and coding conventions.

## Step 5: Register Channel

1. Add `telegram` to the enabled channels list in `.micro/config.toon`.
2. Register the channel with the orchestrator so it receives inbound messages and can send outbound messages.

## Step 6: Configure Bot Settings (Optional)

Ask the user if they want to configure:
- **Trigger word**: Whether the bot responds to all messages or only when mentioned (default: respond to all in private chats, trigger word in groups).
- **Allowed groups/chats**: Restrict to specific chat IDs for security.
- **Bot commands**: Register slash commands with BotFather (`/setcommands`).

## Step 7: Test Connection

1. Call `getMe()` on the Telegram Bot API to verify the token works.
2. Display the bot's username to the user.
3. Ask the user to send a test message to the bot on Telegram.
4. Verify the message is received by MicroClaw and a response is sent back.

## Step 8: Confirm

Report to the user:
- Telegram bot `@{botUsername}` is now connected
- The bot is listening for messages
- Private messages are processed directly; group messages require the trigger word
- Bot token is stored securely in the vault
- To stop: remove `telegram` from enabled channels in `/customize`
