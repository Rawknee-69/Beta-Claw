import { EventEmitter } from 'node:events';
import cronParser from 'cron-parser';
import { z } from 'zod';
import type { MicroClawDB, ScheduledTask } from '../db.js';

const ScheduledTaskConfigSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  name: z.string().min(1),
  cron: z.string().min(1),
  instruction: z.string().min(1),
});

type ScheduledTaskConfig = z.infer<typeof ScheduledTaskConfigSchema>;

interface TaskFiredEvent {
  taskId: string;
  groupId: string;
  instruction: string;
  scheduledTime: Date;
}

interface TaskAddedEvent {
  taskId: string;
  name: string;
}

interface TaskRemovedEvent {
  taskId: string;
}

class TaskScheduler extends EventEmitter {
  private readonly db: MicroClawDB;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly tasks = new Map<string, ScheduledTaskConfig>();

  constructor(db: MicroClawDB) {
    super();
    this.db = db;
  }

  start(): void {
    const dbTasks = this.db.getEnabledTasks();
    for (const row of dbTasks) {
      const config: ScheduledTaskConfig = {
        id: row.id,
        groupId: row.group_id,
        name: row.name,
        cron: row.cron,
        instruction: row.instruction,
      };
      this.tasks.set(row.id, config);

      if (row.next_run !== null && row.next_run * 1000 <= Date.now()) {
        this.fireTask(config);
      } else {
        this.scheduleNext(config);
      }
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  addTask(config: ScheduledTaskConfig): void {
    const validated = ScheduledTaskConfigSchema.parse(config);

    cronParser.parseExpression(validated.cron);

    const nextRun = this.computeNextRun(validated.cron);

    this.db.insertScheduledTask({
      id: validated.id,
      group_id: validated.groupId,
      name: validated.name,
      cron: validated.cron,
      instruction: validated.instruction,
      enabled: 1,
      last_run: null,
      next_run: nextRun ? Math.floor(nextRun.getTime() / 1000) : null,
    });

    this.tasks.set(validated.id, validated);
    this.scheduleNext(validated);
    this.emit('task:added', { taskId: validated.id, name: validated.name });
  }

  removeTask(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
    this.tasks.delete(taskId);
    this.db.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);
    this.emit('task:removed', { taskId });
  }

  setEnabled(taskId: string, enabled: boolean): void {
    const enabledInt = enabled ? 1 : 0;
    this.db.db
      .prepare('UPDATE scheduled_tasks SET enabled = ? WHERE id = ?')
      .run(enabledInt, taskId);

    if (enabled) {
      const row = this.db.db
        .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
        .get(taskId) as ScheduledTask | undefined;
      if (row) {
        const config: ScheduledTaskConfig = {
          id: row.id,
          groupId: row.group_id,
          name: row.name,
          cron: row.cron,
          instruction: row.instruction,
        };
        this.tasks.set(taskId, config);
        this.scheduleNext(config);
      }
    } else {
      const timer = this.timers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(taskId);
      }
      this.tasks.delete(taskId);
    }
  }

  listTasks(): ScheduledTaskConfig[] {
    return Array.from(this.tasks.values());
  }

  getNextRun(taskId: string): Date | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return this.computeNextRun(task.cron);
  }

  runNow(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.fireTask(task);
  }

  private scheduleNext(config: ScheduledTaskConfig): void {
    const existing = this.timers.get(config.id);
    if (existing) {
      clearTimeout(existing);
    }

    const nextRun = this.computeNextRun(config.cron);
    if (!nextRun) return;

    const delay = Math.max(0, nextRun.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(config.id);
      this.fireTask(config);
    }, delay);

    this.timers.set(config.id, timer);
  }

  private fireTask(config: ScheduledTaskConfig): void {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const nextRun = this.computeNextRun(config.cron);
    const nextRunSec = nextRun ? Math.floor(nextRun.getTime() / 1000) : nowSec;

    this.db.updateTaskLastRun(config.id, nowSec, nextRunSec);

    this.emit('task:fired', {
      taskId: config.id,
      groupId: config.groupId,
      instruction: config.instruction,
      scheduledTime: new Date(now),
    } satisfies TaskFiredEvent);

    if (this.tasks.has(config.id)) {
      this.scheduleNext(config);
    }
  }

  private computeNextRun(cron: string): Date | null {
    try {
      const interval = cronParser.parseExpression(cron);
      return interval.next().toDate();
    } catch {
      return null;
    }
  }
}

export { TaskScheduler, ScheduledTaskConfigSchema };
export type {
  ScheduledTaskConfig,
  TaskFiredEvent,
  TaskAddedEvent,
  TaskRemovedEvent,
};
