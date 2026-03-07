import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prefetcher } from '../../src/scheduler/prefetcher.js';
import type { PrefetchRule } from '../../src/scheduler/prefetcher.js';
import { TaskScheduler } from '../../src/scheduler/task-scheduler.js';
import { MicroClawDB } from '../../src/db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'microclaw-prefetcher-test-'));
  return path.join(dir, 'test.db');
}

const CLAUDE_MD_WITH_PREFETCH = `# Agent Config

## Instructions
You are a helpful assistant.

## Prefetch
- query:"AI news today" | cron:"0 7 * * 1-5" | ttl:3600
- query:"bitcoin price" | cron:"*/30 * * * *" | ttl:1800
- query:"weather forecast" | cron:"0 6 * * *" | ttl:7200

## Other Section
Some other content.
`;

const CLAUDE_MD_NO_PREFETCH = `# Agent Config

## Instructions
You are a helpful assistant.

## Tools
- search
- code_runner
`;

const CLAUDE_MD_EMPTY_PREFETCH = `# Agent Config

## Prefetch

## Other Section
Nothing here.
`;

const CLAUDE_MD_WITH_INVALID_LINES = `# Agent Config

## Prefetch
- query:"valid query" | cron:"0 7 * * *" | ttl:3600
- this is not a valid config line
- query:"another valid" | cron:"*/15 * * * *" | ttl:900
- missing_fields: true
`;

describe('Prefetcher', () => {
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

  describe('parseConfig', () => {
    it('parses valid prefetch rules from CLAUDE.md content', () => {
      const prefetcher = new Prefetcher(db, scheduler);
      const rules = prefetcher.parseConfig(CLAUDE_MD_WITH_PREFETCH);

      expect(rules).toHaveLength(3);
      expect(rules[0]).toEqual({ query: 'AI news today', cron: '0 7 * * 1-5', ttlSeconds: 3600 });
      expect(rules[1]).toEqual({ query: 'bitcoin price', cron: '*/30 * * * *', ttlSeconds: 1800 });
      expect(rules[2]).toEqual({
        query: 'weather forecast',
        cron: '0 6 * * *',
        ttlSeconds: 7200,
      });
    });

    it('returns empty array when no prefetch section exists', () => {
      const prefetcher = new Prefetcher(db, scheduler);
      const rules = prefetcher.parseConfig(CLAUDE_MD_NO_PREFETCH);
      expect(rules).toEqual([]);
    });

    it('returns empty array for empty prefetch section', () => {
      const prefetcher = new Prefetcher(db, scheduler);
      const rules = prefetcher.parseConfig(CLAUDE_MD_EMPTY_PREFETCH);
      expect(rules).toEqual([]);
    });

    it('parses multiple rules correctly', () => {
      const prefetcher = new Prefetcher(db, scheduler);
      const rules = prefetcher.parseConfig(CLAUDE_MD_WITH_PREFETCH);

      expect(rules).toHaveLength(3);
      for (const rule of rules) {
        expect(rule.query).toBeTruthy();
        expect(rule.cron).toBeTruthy();
        expect(rule.ttlSeconds).toBeGreaterThan(0);
      }
    });

    it('ignores invalid config lines gracefully', () => {
      const prefetcher = new Prefetcher(db, scheduler);
      const rules = prefetcher.parseConfig(CLAUDE_MD_WITH_INVALID_LINES);

      expect(rules).toHaveLength(2);
      expect(rules[0]!.query).toBe('valid query');
      expect(rules[1]!.query).toBe('another valid');
    });
  });

  describe('registerRules', () => {
    it('creates scheduled tasks for each rule', () => {
      const prefetcher = new Prefetcher(db, scheduler);
      const rules: PrefetchRule[] = [
        { query: 'test query 1', cron: '0 8 * * *', ttlSeconds: 3600 },
        { query: 'test query 2', cron: '0 12 * * *', ttlSeconds: 1800 },
      ];

      prefetcher.registerRules('grp-1', rules);

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0]!.groupId).toBe('grp-1');
      expect(tasks[1]!.groupId).toBe('grp-1');
      expect(tasks[0]!.name).toContain('Prefetch');
      expect(tasks[1]!.name).toContain('Prefetch');
    });
  });

  describe('prefetch', () => {
    it('stores search result in tool_cache', async () => {
      const mockSearch = vi.fn<(q: string) => Promise<string>>().mockResolvedValue('search result data');
      const prefetcher = new Prefetcher(db, scheduler, mockSearch);

      await prefetcher.prefetch({ query: 'test query', cron: '0 8 * * *', ttlSeconds: 3600 });

      expect(mockSearch).toHaveBeenCalledWith('test query');

      const rows = db.db.prepare('SELECT * FROM tool_cache WHERE tool_name = ?').all('prefetch') as Array<{
        result: string;
        expires_at: number;
        created_at: number;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.result).toBe('search result data');
      expect(rows[0]!.expires_at - rows[0]!.created_at).toBe(3600);
    });
  });

  describe('start / stop', () => {
    it('starts listening for task:fired events and handles prefetch tasks', async () => {
      const mockSearch = vi.fn<(q: string) => Promise<string>>().mockResolvedValue('prefetched');
      const prefetcher = new Prefetcher(db, scheduler, mockSearch);

      prefetcher.registerRules('grp-1', [
        { query: 'auto query', cron: '* * * * *', ttlSeconds: 900 },
      ]);

      prefetcher.start();

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(1);
      scheduler.runNow(tasks[0]!.id);

      await vi.waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith('auto query');
      });

      const rows = db.db.prepare('SELECT * FROM tool_cache WHERE tool_name = ?').all('prefetch');
      expect(rows).toHaveLength(1);
    });

    it('stop removes the event listener', async () => {
      const mockSearch = vi.fn<(q: string) => Promise<string>>().mockResolvedValue('should not appear');
      const prefetcher = new Prefetcher(db, scheduler, mockSearch);

      prefetcher.registerRules('grp-1', [
        { query: 'stopped query', cron: '* * * * *', ttlSeconds: 600 },
      ]);

      prefetcher.start();
      prefetcher.stop();

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(1);
      scheduler.runNow(tasks[0]!.id);

      // Give any potential async handlers time to run
      await new Promise<void>((r) => setTimeout(r, 50));

      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('start is idempotent — calling twice does not double-register', async () => {
      const mockSearch = vi.fn<(q: string) => Promise<string>>().mockResolvedValue('once');
      const prefetcher = new Prefetcher(db, scheduler, mockSearch);

      prefetcher.registerRules('grp-1', [
        { query: 'idempotent', cron: '* * * * *', ttlSeconds: 600 },
      ]);

      prefetcher.start();
      prefetcher.start();

      const tasks = scheduler.listTasks();
      scheduler.runNow(tasks[0]!.id);

      await vi.waitFor(() => {
        expect(mockSearch).toHaveBeenCalledTimes(1);
      });
    });
  });
});
