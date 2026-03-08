import { EventEmitter } from 'node:events';
import cron from 'node-cron';
import type { MicroClawDB, ScheduledTask } from '../db.js';
import type { ProviderRegistry } from '../core/provider-registry.js';
import type { ModelEntry } from '../core/model-catalog.js';
import { agentLoop } from '../core/agent-loop.js';
import { buildSystemPrompt } from '../core/prompt-builder.js';
import { selectModel } from '../core/model-selector.js';
import { DEFAULT_SANDBOX_CONFIG, type SandboxRunOptions } from '../execution/sandbox.js';
/** @deprecated WhatsAppSendFn has been removed; kept for backward compat with TaskScheduler constructor */
type WhatsAppSendFn = (to: string, message: string) => Promise<void>;

export interface TaskFiredEvent {
  taskId: string;
  groupId: string;
  instruction: string;
  scheduledTime: Date;
}

export class TaskScheduler extends EventEmitter {
  private jobs = new Map<string, cron.ScheduledTask>();

  constructor(
    private db: MicroClawDB,
    private registry?: ProviderRegistry,
    private catalog?: ModelEntry[],
    _whatsappSend?: WhatsAppSendFn,    // kept for backward compatibility; no longer used
    private onMessage?: (groupId: string, text: string) => Promise<void>,
  ) {
    super();
  }

  start(): void {
    const tasks = this.db.getEnabledTasks();
    for (const task of tasks) {
      if (task.enabled) this.schedule(task);
    }
    console.log(`[cron] ${tasks.filter(t => t.enabled).length} tasks scheduled`);
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  schedule(task: ScheduledTask): void {
    this.unschedule(task.id);
    if (!cron.validate(task.cron)) {
      console.warn(`[cron] Invalid cron expression for task ${task.id}: ${task.cron}`);
      return;
    }
    const job = cron.schedule(task.cron, () => {
      void this.runTask(task);
    });

    this.jobs.set(task.id, job);
  }

  addTask(config: { id: string; groupId: string; name: string; cron: string; instruction: string }): void {
    this.db.insertScheduledTask({
      id: config.id,
      group_id: config.groupId,
      name: config.name,
      cron: config.cron,
      instruction: config.instruction,
      enabled: 1,
      last_run: null,
      next_run: null,
    });
    const task = this.db.getEnabledTasks().find(t => t.id === config.id);
    if (task) this.schedule(task);
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    console.log(`[cron] Running task: ${task.name} (${task.id})`);

    this.emit('task:fired', {
      taskId: task.id,
      groupId: task.group_id,
      instruction: task.instruction,
      scheduledTime: new Date(),
    } satisfies TaskFiredEvent);

    if (!this.registry || !this.catalog) {
      console.warn(`[cron] Task ${task.id} skipped — no registry/catalog`);
      return;
    }

    if (!this.onMessage) {
      console.warn(`[cron] Task ${task.id} has no delivery channel — onMessage not configured`);
      return;
    }

    let response: string | null = null;

    try {
      const sel = selectModel(this.catalog, task.instruction);
      if (!sel) { console.warn('[cron] No model available'); return; }

      const provider = this.registry.get(sel.model.provider_id);
      if (!provider) { console.warn(`[cron] Provider ${sel.model.provider_id} not found`); return; }

      // Extract sender JID from group_id for cron context (stored as senderId when task was created)
      const senderJid = task.group_id.includes('@') ? task.group_id : undefined;
      const systemPrompt = await buildSystemPrompt(task.group_id, undefined, {
        senderId: senderJid,
        channel: 'whatsapp',
      });
      const schedulerSandboxOpts: SandboxRunOptions = {
        sessionKey: `cron-${task.id}`, agentId: 'cron', isMain: false,
        elevated: 'off', groupId: task.group_id, cfg: DEFAULT_SANDBOX_CONFIG,
      };
      response = await agentLoop(
        [{ role: 'user', content: `[SCHEDULED TASK: ${task.name}]\n${task.instruction}` }],
        { provider, model: sel.model, systemPrompt, db: this.db, groupId: task.group_id, sandboxOpts: schedulerSandboxOpts },
      );
    } catch (e) {
      console.error(`[cron] Task ${task.id} agentLoop failed:`, e);
      return;
    }

    if (!response) {
      console.warn(`[cron] Task ${task.id} produced empty response — not delivering`);
      return;
    }

    try {
      await this.onMessage(task.group_id, response);
      // Mark as run only after successful delivery
      this.db.updateTaskLastRunOnly(task.id, Date.now());
      console.log(`[cron] Task ${task.id} delivered to ${task.group_id}`);
    } catch (e) {
      console.error(`[cron] Task ${task.id} delivery to ${task.group_id} failed:`, e);
    }
  }

  unschedule(id: string): void {
    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
  }

  refresh(): void {
    const tasks = this.db.getEnabledTasks();
    for (const task of tasks) {
      if (task.enabled && !this.jobs.has(task.id)) {
        this.schedule(task);
      }
    }
  }
}
