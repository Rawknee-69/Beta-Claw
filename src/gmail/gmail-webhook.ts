import { gmailManager } from './gmail-manager.js';

export interface GmailPushPayload {
  account:   string;
  from:      string;
  subject:   string;
  snippet:   string;
  body?:     string;
  messageId: string;
}

export interface EnqueueTarget {
  enqueue(msg: {
    id: string;
    groupId: string;
    senderId: string;
    content: string;
    timestamp: number;
    channel: string;
  }): void;
}

export class GmailWebhookHandler {
  constructor(private target: EnqueueTarget) {}

  async handle(payload: GmailPushPayload): Promise<void> {
    const safe = sanitiseEmailContent(payload.body ?? payload.snippet);

    const message = [
      `📧 New email for ${payload.account}`,
      `From: ${payload.from}`,
      `Subject: ${payload.subject}`,
      '---',
      safe,
    ].join('\n');

    const cfg = gmailManager?.getAccount(payload.account);
    const groupId = cfg?.deliverTo;
    if (!groupId) {
      console.log(`[gmail] No delivery group for ${payload.account}. Email logged only.`);
      return;
    }

    this.target.enqueue({
      id:        `gmail-${payload.messageId}`,
      groupId,
      senderId:  `gmail:${payload.account}`,
      content:   message,
      timestamp: Date.now(),
      channel:   'http',
    });
  }
}

function sanitiseEmailContent(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '[script removed]')
    .replace(/<[^>]+>/g, '')
    .slice(0, 20_000);
}
