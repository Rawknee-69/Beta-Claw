import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskScheduler } from '../../src/scheduler/task-scheduler.js';
import type { ScheduledTaskConfig, TaskFiredEvent, TaskAddedEvent, TaskRemovedEvent } from '../../src/scheduler/task-scheduler.js';
import { MicroClawDB } from '../../src/db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'microclaw-scheduler-test-'));
  return path.join(dir, 'test.db');
}

describe('TaskScheduler', () => {
  let db: MicroClawDB;
  let dbPath: string;
  let scheduler: TaskScheduler;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MicroClawDB(dbPath);
    scheduler = new TaskScheduler(db);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
    db.close();
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Files may not exist
    }
    try {
      fs.rmdirSync(path.dirname(dbPath));
    } catch {
      // Dir may not be empty
    }
  });

  const makeConfig = (overrides?: Partial<ScheduledTaskConfig>): ScheduledTaskConfig => ({
    id: 'task-1',
    groupId: 'grp-1',
    name: 'Morning Briefing',
    cron: '0 7 * * 1-5',
    instruction: 'Summarize the latest news',
    ...overrides,
  });

  describe('addTask / listTasks', () => {
    it('adds a task and lists it', () => {
      const config = makeConfig();
      scheduler.addTask(config);

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: 'task-1',
        groupId: 'grp-1',
        name: 'Morning Briefing',
        cron: '0 7 * * 1-5',
        instruction: 'Summarize the latest news',
      });
    });

    it('emits task:added event', () => {
      const handler = vi.fn();
      scheduler.on('task:added', handler);

      scheduler.addTask(makeConfig());

      expect(handler).toHaveBeenCalledOnce();
      const event = handler.mock.calls[0]![0] as TaskAddedEvent;
      expect(event.taskId).toBe('task-1');
      expect(event.name).toBe('Morning Briefing');
    });

    it('persists task to database', () => {
      scheduler.addTask(makeConfig());

      const rows = db.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').all('task-1');
      expect(rows).toHaveLength(1);
    });
  });

  describe('removeTask', () => {
    it('removes a task from the in-memory list and database', () => {
      scheduler.addTask(makeConfig());
      expect(scheduler.listTasks()).toHaveLength(1);

      scheduler.removeTask('task-1');

      expect(scheduler.listTasks()).toHaveLength(0);
      const rows = db.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').all('task-1');
      expect(rows).toHaveLength(0);
    });

    it('emits task:removed event', () => {
      const handler = vi.fn();
      scheduler.on('task:removed', handler);
      scheduler.addTask(makeConfig());

      scheduler.removeTask('task-1');

      expect(handler).toHaveBeenCalledOnce();
      const event = handler.mock.calls[0]![0] as TaskRemovedEvent;
      expect(event.taskId).toBe('task-1');
    });
  });

  describe('setEnabled', () => {
    it('disables a task and removes its timer', () => {
      scheduler.addTask(makeConfig());
      expect(scheduler.listTasks()).toHaveLength(1);

      scheduler.setEnabled('task-1', false);

      expect(scheduler.listTasks()).toHaveLength(0);
      const row = db.db.prepare('SELECT enabled FROM scheduled_tasks WHERE id = ?').get('task-1') as
        | { enabled: number }
        | undefined;
      expect(row?.enabled).toBe(0);
    });

    it('re-enables a task and reschedules it', () => {
      scheduler.addTask(makeConfig());
      scheduler.setEnabled('task-1', false);
      expect(scheduler.listTasks()).toHaveLength(0);

      scheduler.setEnabled('task-1', true);

      expect(scheduler.listTasks()).toHaveLength(1);
      const row = db.db.prepare('SELECT enabled FROM scheduled_tasks WHERE id = ?').get('task-1') as
        | { enabled: number }
        | undefined;
      expect(row?.enabled).toBe(1);
    });
  });

  describe('start', () => {
    it('loads enabled tasks from the database', () => {
      db.insertScheduledTask({
        id: 'db-task-1',
        group_id: 'grp-1',
        name: 'DB Task 1',
        cron: '0 9 * * *',
        instruction: 'do task 1',
        enabled: 1,
        last_run: null,
        next_run: null,
      });
      db.insertScheduledTask({
        id: 'db-task-2',
        group_id: 'grp-1',
        name: 'DB Task 2',
        cron: '0 10 * * *',
        instruction: 'do task 2',
        enabled: 1,
        last_run: null,
        next_run: null,
      });

      scheduler.start();

      expect(scheduler.listTasks()).toHaveLength(2);
    });

    it('skips disabled tasks from the database', () => {
      db.insertScheduledTask({
        id: 'enabled-task',
        group_id: 'grp-1',
        name: 'Enabled',
        cron: '0 9 * * *',
        instruction: 'enabled',
        enabled: 1,
        last_run: null,
        next_run: null,
      });
      db.insertScheduledTask({
        id: 'disabled-task',
        group_id: 'grp-1',
        name: 'Disabled',
        cron: '0 10 * * *',
        instruction: 'disabled',
        enabled: 0,
        last_run: null,
        next_run: null,
      });

      scheduler.start();

      expect(scheduler.listTasks()).toHaveLength(1);
      expect(scheduler.listTasks()[0]!.id).toBe('enabled-task');
    });

    it('fires past-due tasks immediately', () => {
      const pastDue = Math.floor(Date.now() / 1000) - 3600;
      db.insertScheduledTask({
        id: 'overdue',
        group_id: 'grp-1',
        name: 'Overdue Task',
        cron: '0 0 * * *',
        instruction: 'overdue instruction',
        enabled: 1,
        last_run: null,
        next_run: pastDue,
      });

      const handler = vi.fn();
      scheduler.on('task:fired', handler);

      scheduler.start();

      expect(handler).toHaveBeenCalledOnce();
      const event = handler.mock.calls[0]![0] as TaskFiredEvent;
      expect(event.taskId).toBe('overdue');
      expect(event.instruction).toBe('overdue instruction');
    });
  });

  describe('stop', () => {
    it('clears all pending timers', () => {
      scheduler.addTask(makeConfig({ id: 'a', cron: '0 0 * * *' }));
      scheduler.addTask(makeConfig({ id: 'b', cron: '0 12 * * *' }));

      scheduler.stop();

      // After stop, tasks remain in memory for listing but timers are gone.
      // Verify no late firing by adding a handler and advancing time.
      const handler = vi.fn();
      scheduler.on('task:fired', handler);

      vi.useFakeTimers();
      vi.advanceTimersByTime(86_400_000);
      vi.useRealTimers();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('cron parsing', () => {
    it('produces valid next run dates for standard crons', () => {
      scheduler.addTask(makeConfig({ id: 'cron-test', cron: '*/5 * * * *' }));

      const nextRun = scheduler.getNextRun('cron-test');
      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun!.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws on invalid cron expressions', () => {
      expect(() => {
        scheduler.addTask(makeConfig({ id: 'bad-cron', cron: 'not a cron' }));
      }).toThrow();
    });
  });

  describe('task:fired event', () => {
    it('emits task:fired with correct payload when using runNow', () => {
      scheduler.addTask(makeConfig());

      const handler = vi.fn();
      scheduler.on('task:fired', handler);

      scheduler.runNow('task-1');

      expect(handler).toHaveBeenCalledOnce();
      const event = handler.mock.calls[0]![0] as TaskFiredEvent;
      expect(event.taskId).toBe('task-1');
      expect(event.groupId).toBe('grp-1');
      expect(event.instruction).toBe('Summarize the latest news');
      expect(event.scheduledTime).toBeInstanceOf(Date);
    });

    it('updates last_run and next_run in the database on fire', () => {
      scheduler.addTask(makeConfig());
      scheduler.runNow('task-1');

      const row = db.db.prepare('SELECT last_run, next_run FROM scheduled_tasks WHERE id = ?').get('task-1') as
        | { last_run: number | null; next_run: number | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.last_run).toBeTypeOf('number');
      expect(row!.next_run).toBeTypeOf('number');
      expect(row!.last_run).toBeGreaterThan(0);
    });
  });

  describe('runNow', () => {
    it('fires the task immediately without waiting for cron', () => {
      scheduler.addTask(makeConfig());

      const handler = vi.fn();
      scheduler.on('task:fired', handler);

      scheduler.runNow('task-1');

      expect(handler).toHaveBeenCalledOnce();
    });

    it('does nothing for unknown task ids', () => {
      const handler = vi.fn();
      scheduler.on('task:fired', handler);

      scheduler.runNow('nonexistent');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('multiple tasks', () => {
    it('handles multiple tasks scheduled simultaneously', () => {
      scheduler.addTask(makeConfig({ id: 't1', name: 'Task 1', cron: '0 8 * * *' }));
      scheduler.addTask(makeConfig({ id: 't2', name: 'Task 2', cron: '0 9 * * *' }));
      scheduler.addTask(makeConfig({ id: 't3', name: 'Task 3', cron: '0 10 * * *' }));

      expect(scheduler.listTasks()).toHaveLength(3);

      const handler = vi.fn();
      scheduler.on('task:fired', handler);

      scheduler.runNow('t1');
      scheduler.runNow('t2');
      scheduler.runNow('t3');

      expect(handler).toHaveBeenCalledTimes(3);
      const ids = handler.mock.calls.map((c: [TaskFiredEvent]) => c[0].taskId);
      expect(ids).toContain('t1');
      expect(ids).toContain('t2');
      expect(ids).toContain('t3');
    });
  });

  describe('getNextRun', () => {
    it('returns a future Date for a valid task', () => {
      scheduler.addTask(makeConfig({ cron: '*/10 * * * *' }));

      const next = scheduler.getNextRun('task-1');
      expect(next).toBeInstanceOf(Date);
      expect(next!.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns null for unknown task id', () => {
      expect(scheduler.getNextRun('nonexistent')).toBeNull();
    });
  });
});
