---
name: add-slack
command: /add-slack
description: Add Slack as a communication channel
requiredEnvVars:
  - SLACK_BOT_TOKEN
  - SLACK_SIGNING_SECRET
  - SLACK_APP_TOKEN
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

# MicroClaw Add Slack Skill

You are the Slack integration assistant. Set up a Slack app as a communication channel for MicroClaw.

## Step 1: Slack App Creation

Guide the user through creating a Slack app:
1. Go to https://api.slack.com/apps
2. Click "Create New App" > "From scratch"
3. Name it (e.g., "MicroClaw") and select the workspace
4. Under "OAuth & Permissions", add Bot Token Scopes:
   - `chat:write` — Send messages
   - `channels:history` — Read public channel messages
   - `groups:history` — Read private channel messages
   - `im:history` — Read DMs
   - `app_mentions:read` — Detect mentions
   - `files:read` — Read file attachments
5. Under "Socket Mode", enable it and generate an App-Level Token with `connections:write` scope
6. Under "Event Subscriptions", enable and subscribe to:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `app_mention`
7. Install the app to the workspace
8. Copy the Bot User OAuth Token (`xoxb-...`), Signing Secret, and App-Level Token (`xapp-...`)

## Step 2: Collect Credentials

1. Prompt for `SLACK_BOT_TOKEN` (starts with `xoxb-`).
2. Prompt for `SLACK_SIGNING_SECRET` (hex string from Basic Information page).
3. Prompt for `SLACK_APP_TOKEN` (starts with `xapp-`, for Socket Mode).
4. Store all three in the encrypted vault.

## Step 3: Install Dependencies

Run: `npm install @slack/bolt`

## Step 4: Create Channel Adapter

Create `src/channels/slack.ts` implementing the `IChannel` interface using `@slack/bolt` in Socket Mode (no public URL needed):

```typescript
import { App } from '@slack/bolt';
import type { IChannel, InboundMessage, OutboundMessage, ChannelFeature } from './interface.js';

class SlackChannel implements IChannel {
  id = 'slack';
  name = 'Slack';
  private app: App;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;

  constructor(botToken: string, appToken: string, signingSecret: string) {
    this.app = new App({
      token: botToken,
      appToken: appToken,
      signingSecret: signingSecret,
      socketMode: true,
    });
  }

  async connect(): Promise<void> {
    this.app.message(async ({ message }) => {
      if (!this.messageHandler || message.subtype) return;
      if ('text' in message && 'user' in message) {
        this.messageHandler({
          id: message.ts ?? '',
          groupId: message.channel,
          senderId: message.user ?? 'unknown',
          content: message.text ?? '',
          timestamp: parseFloat(message.ts ?? '0') * 1000,
          replyToId: ('thread_ts' in message) ? message.thread_ts : undefined,
        });
      }
    });
    await this.app.start();
  }

  async disconnect(): Promise<void> {
    await this.app.stop();
  }

  async send(msg: OutboundMessage): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: msg.groupId,
      text: msg.content,
      thread_ts: msg.replyToId,
    });
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

Adapt to match the project's exact interface and conventions.

## Step 5: Register Channel

1. Add `slack` to the enabled channels list in `.micro/config.toon`.
2. Register with the orchestrator.

## Step 6: Configure

Ask the user:
- **Channels to monitor**: Which Slack channels should the bot listen in (invite the bot first).
- **Trigger mode**: Respond to all messages, only app mentions, or specific trigger words.
- **Thread behavior**: Reply in threads to keep channels clean (recommended).

## Step 7: Test Connection

1. Start the Slack app in Socket Mode.
2. Verify the bot appears online in Slack.
3. Ask the user to mention the bot or send a DM.
4. Verify the message is received and a response is sent.

## Step 8: Confirm

Report:
- Slack app is connected via Socket Mode (no public URL required)
- Listening in configured channels
- All credentials stored securely in vault
- Uses Socket Mode so no need for a public-facing server
- To adjust: use `/customize` to change Slack settings
