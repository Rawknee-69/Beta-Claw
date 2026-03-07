import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MicroClawDB } from '../src/db.js';
import { IpcWatcher } from '../src/ipc.js';
import type { IpcMessage } from '../src/db.js';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'microclaw-ipc-test-'));
  return path.join(dir, 'test.db');
}

describe('IpcWatcher', () => {
  let db: MicroClawDB;
  let dbPath: string;
  let watcher: IpcWatcher;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MicroClawDB(dbPath);
    watcher = new IpcWatcher(db);
  });

  afterEach(() => {
    watcher.stop();
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

  it('send inserts IPC message and returns UUID', () => {
    const id = watcher.send('group-1', 'hello');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const messages = db.getUnprocessedIpcMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const found = messages.find((m) => m.id === id);
    expect(found).toBeDefined();
    expect(found!.type).toBe('group_message');
  });

  it('send stores correct payload with priority', () => {
    const id = watcher.send('group-2', 'urgent msg', 9);
    const messages = db.getUnprocessedIpcMessages();
    const found = messages.find((m) => m.id === id);
    expect(found).toBeDefined();
    const payload = JSON.parse(found!.payload) as { targetGroupId: string; message: string; priority: number };
    expect(payload.targetGroupId).toBe('group-2');
    expect(payload.message).toBe('urgent msg');
    expect(payload.priority).toBe(9);
  });

  it('send uses default priority of 5', () => {
    const id = watcher.send('g1', 'test');
    const messages = db.getUnprocessedIpcMessages();
    const found = messages.find((m) => m.id === id);
    const payload = JSON.parse(found!.payload) as { priority: number };
    expect(payload.priority).toBe(5);
  });

  it('processPending returns matching messages for a group', () => {
    watcher.send('group-A', 'msg1');
    watcher.send('group-A', 'msg2');
    watcher.send('group-B', 'msg3');

    const result = watcher.processPending('group-A');
    expect(result).toHaveLength(2);
  });

  it('processPending marks messages as processed', () => {
    watcher.send('group-X', 'msg');
    watcher.processPending('group-X');

    const unprocessed = db.getUnprocessedIpcMessages();
    const stillPending = unprocessed.filter((m) => {
      const p = JSON.parse(m.payload) as { targetGroupId: string };
      return p.targetGroupId === 'group-X';
    });
    expect(stillPending).toHaveLength(0);
  });

  it('idempotency: same message not processed twice', () => {
    watcher.send('group-1', 'once');

    const first = watcher.processPending('group-1');
    expect(first).toHaveLength(1);

    const second = watcher.processPending('group-1');
    expect(second).toHaveLength(0);
  });

  it('processPending ignores messages for other groups', () => {
    watcher.send('group-A', 'for A');
    watcher.send('group-B', 'for B');

    const result = watcher.processPending('group-A');
    expect(result).toHaveLength(1);

    const bResult = watcher.processPending('group-B');
    expect(bResult).toHaveLength(1);
  });

  it('start and stop lifecycle', () => {
    expect(watcher.isWatching()).toBe(false);
    watcher.start();
    expect(watcher.isWatching()).toBe(true);
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  it('start is idempotent', () => {
    watcher.start();
    watcher.start();
    expect(watcher.isWatching()).toBe(true);
    watcher.stop();
  });

  it('stop is idempotent', () => {
    watcher.start();
    watcher.stop();
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  it('emits started and stopped events', () => {
    const events: string[] = [];
    watcher.on('started', () => events.push('started'));
    watcher.on('stopped', () => events.push('stopped'));

    watcher.start();
    watcher.stop();

    expect(events).toEqual(['started', 'stopped']);
  });

  it('emits sent event on send', () => {
    const sentPayloads: Array<{ id: string; targetGroupId: string }> = [];
    watcher.on('sent', (data: { id: string; targetGroupId: string }) => sentPayloads.push(data));

    watcher.send('g1', 'test message');

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]!.targetGroupId).toBe('g1');
  });

  it('getProcessedCount tracks processed messages', () => {
    expect(watcher.getProcessedCount()).toBe(0);

    watcher.send('g1', 'a');
    watcher.send('g1', 'b');
    watcher.processPending('g1');

    expect(watcher.getProcessedCount()).toBe(2);
  });

  it('send validates inputs with Zod', () => {
    expect(() => watcher.send('', 'msg')).toThrow();
    expect(() => watcher.send('g1', '')).toThrow();
    expect(() => watcher.send('g1', 'msg', -1)).toThrow();
    expect(() => watcher.send('g1', 'msg', 11)).toThrow();
  });

  it('emits message events when watching detects new messages', async () => {
    const received: Array<{ id: string; targetGroupId: string }> = [];
    watcher.on('message', (data: { id: string; targetGroupId: string }) => received.push(data));

    watcher.send('g1', 'watch me');
    watcher.start();

    await new Promise((resolve) => setTimeout(resolve, 250));
    watcher.stop();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]!.targetGroupId).toBe('g1');
  });
});
