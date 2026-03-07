import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MicroClawDB } from './db.js';
import type { IpcMessage } from './db.js';

const IpcSendSchema = z.object({
  targetGroupId: z.string().min(1),
  message: z.string().min(1),
  priority: z.number().int().min(0).max(10).default(5),
});

interface IpcPayload {
  targetGroupId: string;
  message: string;
  priority: number;
  sentAt: number;
}

const IpcPayloadSchema = z.object({
  targetGroupId: z.string(),
  message: z.string(),
  priority: z.number(),
  sentAt: z.number(),
});

export class IpcWatcher extends EventEmitter {
  private readonly db: MicroClawDB;
  private readonly processedIds: Set<string> = new Set();
  private watching = false;
  private abortController: AbortController | null = null;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(db: MicroClawDB) {
    super();
    this.db = db;
  }

  start(): void {
    if (this.watching) return;
    this.watching = true;
    this.abortController = new AbortController();
    this.emit('started');
    this.schedulePoll();
  }

  stop(): void {
    if (!this.watching) return;
    this.watching = false;
    if (this.pollHandle !== null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.emit('stopped');
  }

  send(targetGroupId: string, message: string, priority = 5): string {
    const validated = IpcSendSchema.parse({ targetGroupId, message, priority });
    const id = randomUUID();

    const payload: IpcPayload = {
      targetGroupId: validated.targetGroupId,
      message: validated.message,
      priority: validated.priority,
      sentAt: Date.now(),
    };

    this.db.insertIpcMessage({
      id,
      type: 'group_message',
      payload: JSON.stringify(payload),
      processed: 0,
    });

    this.emit('sent', { id, ...payload });
    return id;
  }

  processPending(groupId: string): IpcMessage[] {
    z.string().min(1).parse(groupId);

    const unprocessed = this.db.getUnprocessedIpcMessages();
    const matching: IpcMessage[] = [];

    for (const msg of unprocessed) {
      if (this.processedIds.has(msg.id)) continue;

      const parseResult = IpcPayloadSchema.safeParse(this.parsePayload(msg.payload));
      if (!parseResult.success) continue;

      if (parseResult.data.targetGroupId === groupId) {
        this.processedIds.add(msg.id);
        this.db.markIpcProcessed(msg.id);
        matching.push(msg);
        this.emit('processed', msg);
      }
    }

    return matching;
  }

  isWatching(): boolean {
    return this.watching;
  }

  getProcessedCount(): number {
    return this.processedIds.size;
  }

  private parsePayload(raw: string): unknown {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private schedulePoll(): void {
    if (!this.watching) return;

    this.pollHandle = setTimeout(() => {
      if (!this.watching) return;

      const unprocessed = this.db.getUnprocessedIpcMessages();
      for (const msg of unprocessed) {
        if (this.processedIds.has(msg.id)) continue;

        const parseResult = IpcPayloadSchema.safeParse(this.parsePayload(msg.payload));
        if (!parseResult.success) continue;

        this.emit('message', {
          id: msg.id,
          targetGroupId: parseResult.data.targetGroupId,
          message: parseResult.data.message,
          priority: parseResult.data.priority,
        });
      }

      this.schedulePoll();
    }, 100);
  }
}

export type { IpcPayload };
export { IpcSendSchema, IpcPayloadSchema };
