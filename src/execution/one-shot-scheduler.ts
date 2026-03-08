interface ScheduledTask {
  id:      string;
  groupId: string;
  message: string;
  runAt:   number;
  timer:   ReturnType<typeof setTimeout>;
}

export interface OneShotEnqueueMessage {
  id:        string;
  groupId:   string;
  senderId:  string;
  content:   string;
  timestamp: number;
  channel:   string;
}

type EnqueueFn = (msg: OneShotEnqueueMessage) => Promise<void>;

class OneShotScheduler {
  private tasks       = new Map<string, ScheduledTask>();
  private enqueueFn: EnqueueFn | null = null;

  init(enqueueFn: EnqueueFn): void {
    this.enqueueFn = enqueueFn;
  }

  scheduleOnce(groupId: string, message: string, delayMs: number): string {
    const id    = `sched-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timer = setTimeout(async () => {
      this.tasks.delete(id);
      if (!this.enqueueFn) return;
      await this.enqueueFn({
        id, groupId,
        senderId:  'scheduler',
        content:   message,
        timestamp: Date.now(),
        channel:   'internal',
      });
    }, delayMs);

    const runAt = Date.now() + delayMs;
    this.tasks.set(id, { id, groupId, message, runAt, timer });
    console.log(`[scheduler] ${id}: "${message.slice(0, 50)}" in ${Math.round(delayMs / 1000)}s`);
    return id;
  }

  cancel(id: string): boolean {
    const t = this.tasks.get(id);
    if (!t) return false;
    clearTimeout(t.timer);
    this.tasks.delete(id);
    return true;
  }

  list(groupId?: string): ScheduledTask[] {
    return [...this.tasks.values()]
      .filter(t => !groupId || t.groupId === groupId)
      .sort((a, b) => a.runAt - b.runAt);
  }

  static parseDelay(input: string): number | null {
    const m = input.toLowerCase().trim().match(/(\d+\.?\d*)\s*(second|sec|minute|min|hour|hr|day|week)/);
    if (!m) return null;
    const n = parseFloat(m[1]!);
    const u = m[2]!;
    if (u.startsWith('sec'))  return n * 1_000;
    if (u.startsWith('min'))  return n * 60_000;
    if (u === 'hr' || u.startsWith('hour')) return n * 3_600_000;
    if (u.startsWith('day'))  return n * 86_400_000;
    if (u.startsWith('week')) return n * 604_800_000;
    return null;
  }
}

export const oneShotScheduler = new OneShotScheduler();
export { OneShotScheduler };
