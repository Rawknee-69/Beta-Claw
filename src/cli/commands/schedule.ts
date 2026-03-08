import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
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

export { scheduleCommand };
