import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import type { MicroClawDB } from '../db.js';
import type { TaskScheduler, TaskFiredEvent } from './task-scheduler.js';

const PrefetchRuleSchema = z.object({
  query: z.string().min(1),
  cron: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
});

type PrefetchRule = z.infer<typeof PrefetchRuleSchema>;

const PREFETCH_PREFIX = 'prefetch:';

const PrefetchPayloadSchema = z.object({
  q: z.string(),
  t: z.number().int().positive(),
  c: z.string(),
});

function encodePrefetchInstruction(rule: PrefetchRule): string {
  return `${PREFETCH_PREFIX}${JSON.stringify({ q: rule.query, t: rule.ttlSeconds, c: rule.cron })}`;
}

function decodePrefetchInstruction(instruction: string): PrefetchRule | null {
  if (!instruction.startsWith(PREFETCH_PREFIX)) return null;
  try {
    const raw: unknown = JSON.parse(instruction.slice(PREFETCH_PREFIX.length));
    const parsed = PrefetchPayloadSchema.parse(raw);
    return { query: parsed.q, ttlSeconds: parsed.t, cron: parsed.c };
  } catch {
    return null;
  }
}

type SearchFn = (query: string) => Promise<string>;

const PREFETCH_CONFIG_RE = /query:"([^"]+)"\s*\|\s*cron:"([^"]+)"\s*\|\s*ttl:(\d+)/;

class Prefetcher {
  private readonly db: MicroClawDB;
  private readonly scheduler: TaskScheduler;
  private readonly searchFn: SearchFn;
  private readonly boundHandler: (event: TaskFiredEvent) => void;
  private listening = false;

  constructor(db: MicroClawDB, scheduler: TaskScheduler, searchFn?: SearchFn) {
    this.db = db;
    this.scheduler = scheduler;
    this.searchFn = searchFn ?? (async () => '');
    this.boundHandler = (event: TaskFiredEvent) => {
      const decoded = decodePrefetchInstruction(event.instruction);
      if (decoded) {
        void this.prefetch(decoded);
      }
    };
  }

  parseConfig(claudeContent: string): PrefetchRule[] {
    const rules: PrefetchRule[] = [];
    const lines = claudeContent.split('\n');
    let inPrefetchSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^## prefetch/i.test(trimmed)) {
        inPrefetchSection = true;
        continue;
      }
      if (inPrefetchSection && trimmed.startsWith('## ')) {
        break;
      }
      if (!inPrefetchSection) continue;

      const match = PREFETCH_CONFIG_RE.exec(trimmed);
      if (match) {
        const query = match[1];
        const cron = match[2];
        const ttlStr = match[3];
        if (query && cron && ttlStr) {
          const ttl = parseInt(ttlStr, 10);
          if (!isNaN(ttl) && ttl > 0) {
            rules.push({ query, cron, ttlSeconds: ttl });
          }
        }
      }
    }

    return rules;
  }

  registerRules(groupId: string, rules: PrefetchRule[]): void {
    for (const rule of rules) {
      const validated = PrefetchRuleSchema.parse(rule);
      const taskId = `prefetch-${randomUUID()}`;
      this.scheduler.addTask({
        id: taskId,
        groupId,
        name: `Prefetch: ${validated.query}`,
        cron: validated.cron,
        instruction: encodePrefetchInstruction(validated),
      });
    }
  }

  async prefetch(rule: PrefetchRule): Promise<void> {
    const result = await this.searchFn(rule.query);
    const now = Math.floor(Date.now() / 1000);
    const inputHash = createHash('sha256').update(rule.query).digest('hex');

    this.db.insertToolCacheEntry({
      id: randomUUID(),
      tool_name: 'prefetch',
      input_hash: inputHash,
      result,
      group_id: null,
      created_at: now,
      expires_at: now + rule.ttlSeconds,
      hit_count: 0,
    });
  }

  start(): void {
    if (this.listening) return;
    this.scheduler.on('task:fired', this.boundHandler);
    this.listening = true;
  }

  stop(): void {
    if (!this.listening) return;
    this.scheduler.removeListener('task:fired', this.boundHandler);
    this.listening = false;
  }
}

export { Prefetcher, PrefetchRuleSchema, PREFETCH_PREFIX };
export { encodePrefetchInstruction, decodePrefetchInstruction };
export type { PrefetchRule, SearchFn };
