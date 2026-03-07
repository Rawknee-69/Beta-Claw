import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolCache, computeInputHash } from '../../src/core/tool-cache.js';
import { MicroClawDB } from '../../src/db.js';
import { encode } from '../../src/core/toon-serializer.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'microclaw-cache-test-'));
  return path.join(dir, 'test.db');
}

describe('ToolCache', () => {
  let db: MicroClawDB;
  let dbPath: string;
  let cache: ToolCache;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MicroClawDB(dbPath);
    cache = new ToolCache(db);
  });

  afterEach(() => {
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

  describe('get/set', () => {
    it('returns undefined on cache miss', () => {
      const result = cache.get('brave_search', { query: 'typescript generics' });
      expect(result).toBeUndefined();
    });

    it('returns cached result on cache hit', () => {
      const inputs = { query: 'typescript generics' };
      const toonResult = encode('result', { data: 'found it' });
      cache.set('brave_search', inputs, toonResult);

      const result = cache.get('brave_search', inputs);
      expect(result).toBe(toonResult);
    });

    it('returns undefined after TTL expires', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const inputs = { query: 'typescript generics' };
      cache.set('read_file', inputs, encode('result', { content: 'hello' }));

      // read_file TTL is 300s — advance past it
      vi.setSystemTime(now + 301_000);

      const result = cache.get('read_file', inputs);
      expect(result).toBeUndefined();
    });

    it('uses shorter TTL for news search queries', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const newsInputs = { query: 'latest AI news' };
      cache.set('brave_search', newsInputs, encode('result', { data: 'news' }));

      // After 1 hour (3600s) the news TTL should be expired
      vi.setSystemTime(now + 3601_000);

      const result = cache.get('brave_search', newsInputs);
      expect(result).toBeUndefined();
    });

    it('uses longer TTL for stable search queries', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const stableInputs = { query: 'typescript generics guide' };
      cache.set('brave_search', stableInputs, encode('result', { data: 'guide' }));

      // After 1 hour — should still be cached (stable = 24h)
      vi.setSystemTime(now + 3601_000);

      const result = cache.get('brave_search', stableInputs);
      expect(result).toBeDefined();
    });

    it('returns default TTL for unknown tools', () => {
      expect(cache.getTTL('unknown_tool')).toBe(3600);
    });
  });

  describe('run_code is never cached', () => {
    it('set does not store run_code results', () => {
      cache.set('run_code', { code: 'console.log("hi")' }, 'output');

      const rows = db.db
        .prepare('SELECT * FROM tool_cache WHERE tool_name = ?')
        .all('run_code');
      expect(rows).toHaveLength(0);
    });

    it('get always returns undefined for run_code', () => {
      // Manually insert a run_code entry to verify get still rejects it
      const now = Math.floor(Date.now() / 1000);
      db.insertToolCacheEntry({
        id: 'forced-run-code',
        tool_name: 'run_code',
        input_hash: 'somehash',
        result: 'output',
        group_id: null,
        created_at: now,
        expires_at: now + 9999,
        hit_count: 0,
      });

      const result = cache.get('run_code', { code: 'console.log("hi")' });
      expect(result).toBeUndefined();
    });

    it('getTTL returns 0 for run_code', () => {
      expect(cache.getTTL('run_code')).toBe(0);
    });
  });

  describe('invalidation', () => {
    it('removes specific cache entries', () => {
      const inputs = { path: '/tmp/file.txt' };
      cache.set('read_file', inputs, encode('result', { content: 'hello' }));

      const beforeInvalidation = cache.get('read_file', inputs);
      expect(beforeInvalidation).toBeDefined();

      cache.invalidate('read_file', inputs);

      const afterInvalidation = cache.get('read_file', inputs);
      expect(afterInvalidation).toBeUndefined();
    });

    it('does not affect other entries', () => {
      const inputsA = { path: '/tmp/a.txt' };
      const inputsB = { path: '/tmp/b.txt' };
      cache.set('read_file', inputsA, encode('result', { content: 'a' }));
      cache.set('read_file', inputsB, encode('result', { content: 'b' }));

      cache.invalidate('read_file', inputsA);

      expect(cache.get('read_file', inputsA)).toBeUndefined();
      expect(cache.get('read_file', inputsB)).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('removes expired entries and returns count', () => {
      const now = Math.floor(Date.now() / 1000);

      db.insertToolCacheEntry({
        id: 'expired-1',
        tool_name: 'fetch_url',
        input_hash: 'hash1',
        result: 'old',
        group_id: null,
        created_at: now - 7200,
        expires_at: now - 3600,
        hit_count: 0,
      });
      db.insertToolCacheEntry({
        id: 'expired-2',
        tool_name: 'fetch_url',
        input_hash: 'hash2',
        result: 'old2',
        group_id: null,
        created_at: now - 7200,
        expires_at: now - 1,
        hit_count: 0,
      });

      const removed = cache.cleanup();
      expect(removed).toBe(2);
    });

    it('keeps non-expired entries', () => {
      const inputs = { url: 'https://example.com' };
      cache.set('fetch_url', inputs, encode('result', { body: 'html' }));

      const removed = cache.cleanup();
      expect(removed).toBe(0);

      expect(cache.get('fetch_url', inputs)).toBeDefined();
    });
  });

  describe('SHA-256 hashing', () => {
    it('produces consistent hashes for same inputs', () => {
      const inputs = { query: 'hello world', limit: 10 };
      const hash1 = computeInputHash(inputs);
      const hash2 = computeInputHash(inputs);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = computeInputHash({ query: 'hello' });
      const hash2 = computeInputHash({ query: 'world' });
      expect(hash1).not.toBe(hash2);
    });

    it('uses TOON encoding of inputs for hashing', () => {
      const inputs = { query: 'test', limit: 5 };
      const toonEncoded = encode('input', inputs);
      const expectedHash = createHash('sha256').update(toonEncoded).digest('hex');
      const actualHash = computeInputHash(inputs);
      expect(actualHash).toBe(expectedHash);
    });

    it('produces 64-character hex strings', () => {
      const hash = computeInputHash({ x: 1 });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('includes groupId in hash when provided', () => {
      const inputs = { query: 'same' };
      const hashNoGroup = computeInputHash(inputs);
      const hashWithGroup = computeInputHash(inputs, 'grp_001');
      expect(hashNoGroup).not.toBe(hashWithGroup);
    });
  });

  describe('groupId-scoped caching', () => {
    it('isolates cache entries by groupId', () => {
      const cacheA = new ToolCache(db, 'grp_A');
      const cacheB = new ToolCache(db, 'grp_B');

      const inputs = { query: 'shared question' };
      const resultA = encode('result', { source: 'groupA' });
      const resultB = encode('result', { source: 'groupB' });

      cacheA.set('brave_search', inputs, resultA);
      cacheB.set('brave_search', inputs, resultB);

      expect(cacheA.get('brave_search', inputs)).toBe(resultA);
      expect(cacheB.get('brave_search', inputs)).toBe(resultB);
    });

    it('group-scoped cache is invisible to unscoped cache', () => {
      const scopedCache = new ToolCache(db, 'grp_001');
      const unscopedCache = new ToolCache(db);

      const inputs = { query: 'test' };
      scopedCache.set('brave_search', inputs, encode('result', { data: 'scoped' }));

      expect(unscopedCache.get('brave_search', inputs)).toBeUndefined();
    });

    it('unscoped cache is invisible to group-scoped cache', () => {
      const scopedCache = new ToolCache(db, 'grp_001');
      const unscopedCache = new ToolCache(db);

      const inputs = { query: 'test' };
      unscopedCache.set('brave_search', inputs, encode('result', { data: 'unscoped' }));

      expect(scopedCache.get('brave_search', inputs)).toBeUndefined();
    });

    it('stores group_id in the database entry', () => {
      const scopedCache = new ToolCache(db, 'grp_XYZ');
      scopedCache.set('fetch_url', { url: 'https://example.com' }, 'result');

      const row = db.db
        .prepare('SELECT group_id FROM tool_cache')
        .get() as { group_id: string | null };
      expect(row.group_id).toBe('grp_XYZ');
    });
  });

  describe('getTTL', () => {
    it('returns correct TTLs for known tools', () => {
      expect(cache.getTTL('brave_search')).toBe(86400);
      expect(cache.getTTL('serper_search')).toBe(86400);
      expect(cache.getTTL('fetch_url')).toBe(1800);
      expect(cache.getTTL('run_code')).toBe(0);
      expect(cache.getTTL('read_file')).toBe(300);
      expect(cache.getTTL('install_pkg')).toBe(604800);
    });

    it('returns 3600 (1 hour) for unknown tools', () => {
      expect(cache.getTTL('custom_tool')).toBe(3600);
      expect(cache.getTTL('my_fancy_tool')).toBe(3600);
    });
  });
});
