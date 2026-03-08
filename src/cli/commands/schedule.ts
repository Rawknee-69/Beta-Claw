import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { oneShotScheduler, OneShotScheduler } from '../../execution/one-shot-scheduler.js';
dotenv.config();

async function getDB() {
  const { MicroClawDB } = await import('../../db.js');
  const { DB_PATH } = await import('../../core/paths.js');
  return new MicroClawDB(DB_PATH);
}

const scheduleCommand = new Command('schedule')
  .description('Manage MicroClaw internal scheduled tasks (supports sub-minute intervals)');

scheduleCommand
  .command('add')
  .description('Add a recurring task (6-field cron: sec min hr dom mon dow)')
  .requiredOption('--cron <expr>', 'Cron expression (e.g. "*/30 * * * * *" for every 30s)')
  .requiredOption('--name <name>', 'Human-readable task name')
  .requiredOption('--instruction <text>', 'What the agent should do when this fires')
  .option('--group <groupId>', 'Target group/chat to deliver message to', 'default')
  .action(async (opts: { cron: string; name: string; instruction: string; group: string }) => {
    const db = await getDB();
    const id = randomUUID();
    try {
      db.insertScheduledTask({
        id,
        group_id: opts.group,
        name: opts.name,
        cron: opts.cron,
        instruction: opts.instruction,
        enabled: 1,
        last_run: null,
        next_run: null,
      });
      console.log(`\u2713 Task added: ${opts.name} (${opts.cron}) → ID: ${id}`);
      console.log(`  Restart microclaw for it to take effect.`);
    } catch (e) {
      console.error(`Failed to add task: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      db.close();
    }
  });

scheduleCommand
  .command('list')
  .description('List all scheduled tasks')
  .action(async () => {
    const db = await getDB();
    try {
      const tasks = db.getEnabledTasks();
      if (tasks.length === 0) {
        console.log('  No scheduled tasks.');
      } else {
        console.log(`\n  Scheduled Tasks (${tasks.length}):\n`);
        for (const t of tasks) {
          const status = t.enabled ? '\u2713' : '\u2717';
          console.log(`  ${status} [${t.id.slice(0, 8)}] ${t.name}`);
          console.log(`      Cron:   ${t.cron}`);
          console.log(`      Group:  ${t.group_id}`);
          console.log(`      Task:   ${t.instruction}`);
          if (t.last_run) console.log(`      Last:   ${new Date(t.last_run).toLocaleString()}`);
          console.log();
        }
      }
    } finally {
      db.close();
    }
  });

scheduleCommand
  .command('remove')
  .description('Remove a scheduled task by ID or name')
  .argument('<id-or-name>', 'Task ID (first 8 chars ok) or exact name')
  .action(async (idOrName: string) => {
    const db = await getDB();
    try {
      const tasks = db.getEnabledTasks();
      const task = tasks.find(t =>
        t.id === idOrName ||
        t.id.startsWith(idOrName) ||
        t.name === idOrName,
      );
      if (!task) {
        console.error(`  Task not found: ${idOrName}`);
        console.log(`  Run "microclaw schedule list" to see all tasks.`);
        process.exit(1);
      }
      db.deleteScheduledTask(task.id, task.group_id);
      console.log(`\u2713 Task removed: ${task.name} (${task.id})`);
    } finally {
      db.close();
    }
  });

scheduleCommand
  .command('once')
  .description('Schedule a one-shot message after a delay')
  .requiredOption('--group <groupId>', 'Target group/chat')
  .requiredOption('--delay <delay>', 'Delay (e.g. "30 seconds", "5 minutes")')
  .requiredOption('--message <message>', 'Message to deliver')
  .action(async (opts: { group: string; delay: string; message: string }) => {
    const ms = OneShotScheduler.parseDelay(opts.delay);
    if (!ms)              { console.error('Invalid delay format'); process.exit(1); }
    if (ms < 10_000)      { console.error('Minimum: 10 seconds');  process.exit(1); }
    if (ms > 604_800_000) { console.error('Maximum: 7 days');      process.exit(1); }
    const id = `once-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runAt = Date.now() + ms;
    const db = await getDB();
    try {
      db.insertPendingOnceTask({ id, groupId: opts.group, message: opts.message, runAt });
      console.log(`[scheduler] ${id}: "${opts.message.slice(0, 50)}" in ${Math.round(ms / 1000)}s`);
      console.log(`Scheduled: ${id}`);
    } finally {
      db.close();
    }
  });

scheduleCommand
  .command('list-pending')
  .description('List pending one-shot tasks')
  .option('--group <groupId>', 'Filter by group')
  .action((opts: { group?: string }) => {
    const tasks = oneShotScheduler.list(opts.group);
    if (!tasks.length) { console.log('No pending tasks.'); return; }
    tasks.forEach(t => {
      const s = Math.max(0, Math.round((t.runAt - Date.now()) / 1000));
      console.log(`${t.id}: "${t.message.slice(0, 60)}" in ${s}s`);
    });
  });

scheduleCommand
  .command('cancel')
  .description('Cancel a pending one-shot task by ID')
  .requiredOption('--id <id>', 'Task ID')
  .action((opts: { id: string }) => {
    console.log(oneShotScheduler.cancel(opts.id) ? `Cancelled: ${opts.id}` : `Not found: ${opts.id}`);
  });

export { scheduleCommand };
