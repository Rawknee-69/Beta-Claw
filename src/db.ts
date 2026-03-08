import Database from 'better-sqlite3';
import fs from 'node:fs';
import { z } from 'zod';
import path from 'node:path';
import { PATHS } from './core/paths.js';

let _dbInstance: MicroClawDB | null = null;

export function getDB(profile: ResourceProfile = 'standard'): MicroClawDB {
  if (_dbInstance) return _dbInstance;
  fs.mkdirSync(PATHS.micro, { recursive: true });
  _dbInstance = new MicroClawDB(PATHS.db, profile);
  return _dbInstance;
}

const MessageSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  sender_id: z.string(),
  content: z.string(),
  content_redacted: z.string().nullable().default(null),
  timestamp: z.number().int(),
  channel: z.string(),
  reply_to_id: z.string().nullable().default(null),
  processed: z.number().int().default(0),
  error: z.string().nullable().default(null),
});

const SessionSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  summary: z.string().nullable().default(null),
  key_facts: z.string().nullable().default(null),
  token_count: z.number().int().nullable().default(null),
  started_at: z.number().int(),
  ended_at: z.number().int().nullable().default(null),
  model_used: z.string().nullable().default(null),
});

const ToolCacheSchema = z.object({
  id: z.string(),
  tool_name: z.string(),
  input_hash: z.string(),
  result: z.string(),
  group_id: z.string().nullable().default(null),
  created_at: z.number().int(),
  expires_at: z.number().int(),
  hit_count: z.number().int().default(0),
});

const ScheduledTaskSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  name: z.string(),
  cron: z.string(),
  instruction: z.string(),
  enabled: z.number().int().default(1),
  last_run: z.number().int().nullable().default(null),
  next_run: z.number().int().nullable().default(null),
});

const GroupSchema = z.object({
  id: z.string(),
  channel: z.string(),
  name: z.string().nullable().default(null),
  trigger_word: z.string().default('@rem'),
  execution_mode: z.string().default('isolated'),
  allowed_tools: z.string().nullable().default(null),
});

const ModelCatalogSchema = z.object({
  provider_id: z.string(),
  model_id: z.string(),
  model_name: z.string(),
  context_window: z.number().int().nullable().default(null),
  input_cost_per_1m: z.number().nullable().default(null),
  output_cost_per_1m: z.number().nullable().default(null),
  capabilities: z.string().nullable().default(null),
  tier: z.string().nullable().default(null),
  fetched_at: z.number().int(),
  expires_at: z.number().int(),
});

const SecurityEventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  group_id: z.string().nullable().default(null),
  severity: z.string(),
  details: z.string().nullable().default(null),
  blocked: z.number().int().default(1),
});

const IpcMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.string(),
  processed: z.number().int().default(0),
});

const SnapshotSchema = z.object({
  id: z.string(),
  description: z.string().nullable().default(null),
  paths: z.string(),
  storage_dir: z.string(),
  expires_at: z.number().int(),
});

const HeartbeatConfigSchema = z.object({
  group_id: z.string(),
  every_ms: z.number().int().default(1800000),
  model: z.string().nullable().default(null),
  light_context: z.number().int().default(1),
  show_ok: z.number().int().default(0),
  show_alerts: z.number().int().default(1),
  use_indicator: z.number().int().default(1),
  target: z.string().default('none'),
  ack_max_chars: z.number().int().default(300),
  last_tick: z.number().int().nullable().default(null),
  next_tick: z.number().int().nullable().default(null),
  enabled: z.number().int().default(1),
});

const HeartbeatLogSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  tick_at: z.number().int(),
  skipped: z.number().int().default(0),
  skip_reason: z.string().nullable().default(null),
  response_type: z.string().nullable().default(null),
  tokens_used: z.number().int().nullable().default(null),
  cost_usd: z.number().nullable().default(null),
});

type Message = z.output<typeof MessageSchema>;
type MessageInput = z.input<typeof MessageSchema>;
type Session = z.output<typeof SessionSchema>;
type SessionInput = z.input<typeof SessionSchema>;
type ToolCacheEntry = z.output<typeof ToolCacheSchema>;
type ToolCacheInput = z.input<typeof ToolCacheSchema>;
type ScheduledTask = z.output<typeof ScheduledTaskSchema>;
type ScheduledTaskInput = z.input<typeof ScheduledTaskSchema>;
type Group = z.output<typeof GroupSchema>;
type GroupInput = z.input<typeof GroupSchema>;
type ModelCatalogEntry = z.output<typeof ModelCatalogSchema>;
type ModelCatalogInput = z.input<typeof ModelCatalogSchema>;
type SecurityEvent = z.output<typeof SecurityEventSchema>;
type SecurityEventInput = z.input<typeof SecurityEventSchema>;
type IpcMessage = z.output<typeof IpcMessageSchema>;
type IpcMessageInput = z.input<typeof IpcMessageSchema>;
type Snapshot = z.output<typeof SnapshotSchema>;
type SnapshotInput = z.input<typeof SnapshotSchema>;
type HeartbeatConfig = z.output<typeof HeartbeatConfigSchema>;
type HeartbeatConfigInput = z.input<typeof HeartbeatConfigSchema>;
type HeartbeatLog = z.output<typeof HeartbeatLogSchema>;
type HeartbeatLogInput = z.input<typeof HeartbeatLogSchema>;

type ResourceProfile = 'micro' | 'lite' | 'standard' | 'full';

const CACHE_SIZES: Record<ResourceProfile, number> = {
  micro: -2000,
  lite: -4000,
  standard: -8000,
  full: -16000,
};

const SCHEMA_SQL = `
-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_redacted TEXT,
  timestamp INTEGER NOT NULL,
  channel TEXT NOT NULL,
  reply_to_id TEXT,
  processed INTEGER DEFAULT 0,
  error TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_messages_group_ts ON messages(group_id, timestamp);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  summary TEXT,
  key_facts TEXT,
  token_count INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  model_used TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id, started_at);

-- Tool result cache
CREATE TABLE IF NOT EXISTS tool_cache (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  group_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  hit_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tool_cache_lookup ON tool_cache(tool_name, input_hash, expires_at);

-- Scheduled tasks
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  instruction TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_run INTEGER,
  next_run INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  name TEXT,
  trigger_word TEXT DEFAULT '@rem',
  execution_mode TEXT DEFAULT 'isolated',
  allowed_tools TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  last_active INTEGER
);

-- Model catalog cache
CREATE TABLE IF NOT EXISTS model_catalog (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  context_window INTEGER,
  input_cost_per_1m REAL,
  output_cost_per_1m REAL,
  capabilities TEXT,
  tier TEXT,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);

-- Security events log
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  group_id TEXT,
  severity TEXT NOT NULL,
  details TEXT,
  blocked INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);

-- IPC messages
CREATE TABLE IF NOT EXISTS ipc_messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Pending one-shot scheduled messages (cross-process, persistent)
CREATE TABLE IF NOT EXISTS pending_once_tasks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  message TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  picked_up INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Snapshots (rollback)
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  description TEXT,
  paths TEXT NOT NULL,
  storage_dir TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

-- Heartbeat config + state
CREATE TABLE IF NOT EXISTS heartbeat_config (
  group_id TEXT PRIMARY KEY,
  every_ms INTEGER NOT NULL DEFAULT 1800000,
  model TEXT,
  light_context INTEGER DEFAULT 1,
  show_ok INTEGER DEFAULT 0,
  show_alerts INTEGER DEFAULT 1,
  use_indicator INTEGER DEFAULT 1,
  target TEXT DEFAULT 'none',
  ack_max_chars INTEGER DEFAULT 300,
  last_tick INTEGER,
  next_tick INTEGER,
  enabled INTEGER DEFAULT 1
);

-- Heartbeat event log
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  tick_at INTEGER NOT NULL,
  skipped INTEGER DEFAULT 0,
  skip_reason TEXT,
  response_type TEXT,
  tokens_used INTEGER,
  cost_usd REAL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Vector embeddings fallback (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  chunk_id,
  content,
  group_id,
  source_type,
  created_at UNINDEXED
);
`;

class MicroClawDB {
  readonly db: Database.Database;

  constructor(dbPath: string = PATHS.db, profile: ResourceProfile = 'standard') {
    const resolvedPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath, { timeout: 5000 });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma(`cache_size = ${CACHE_SIZES[profile]}`);
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // --- Messages ---

  insertMessage(msg: MessageInput): void {
    const validated = MessageSchema.parse(msg);
    this.db
      .prepare(
        `INSERT INTO messages (id, group_id, sender_id, content, content_redacted, timestamp, channel, reply_to_id, processed, error)
       VALUES (@id, @group_id, @sender_id, @content, @content_redacted, @timestamp, @channel, @reply_to_id, @processed, @error)`,
      )
      .run(validated);
  }

  getMessagesByGroup(groupId: string, limit = 50): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(groupId, limit) as Message[];
    return rows;
  }

  getMessages(groupId: string, limit = 20): Message[] {
    return (this.db
      .prepare('SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(groupId, limit) as Message[]).reverse();
  }

  getUnprocessedMessages(groupId: string): Message[] {
    return this.db
      .prepare(
        'SELECT * FROM messages WHERE group_id = ? AND processed = 0 ORDER BY timestamp ASC',
      )
      .all(groupId) as Message[];
  }

  markMessageProcessed(id: string, error?: string): void {
    this.db
      .prepare('UPDATE messages SET processed = 1, error = ? WHERE id = ?')
      .run(error ?? null, id);
  }

  // --- Sessions ---

  insertSession(session: SessionInput): void {
    const validated = SessionSchema.parse(session);
    this.db
      .prepare(
        `INSERT INTO sessions (id, group_id, summary, key_facts, token_count, started_at, ended_at, model_used)
       VALUES (@id, @group_id, @summary, @key_facts, @token_count, @started_at, @ended_at, @model_used)`,
      )
      .run(validated);
  }

  getLatestSession(groupId: string): Session | undefined {
    return this.db
      .prepare('SELECT * FROM sessions WHERE group_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(groupId) as Session | undefined;
  }

  endSession(id: string, summary: string, keyFacts: string, tokenCount: number): void {
    this.db
      .prepare(
        `UPDATE sessions SET ended_at = unixepoch(), summary = ?, key_facts = ?, token_count = ? WHERE id = ?`,
      )
      .run(summary, keyFacts, tokenCount, id);
  }

  // --- Tool Cache ---

  getCachedToolResult(toolName: string, inputHash: string): ToolCacheEntry | undefined {
    const now = Math.floor(Date.now() / 1000);
    const row = this.db
      .prepare(
        'SELECT * FROM tool_cache WHERE tool_name = ? AND input_hash = ? AND expires_at > ?',
      )
      .get(toolName, inputHash, now) as ToolCacheEntry | undefined;
    if (row) {
      this.db.prepare('UPDATE tool_cache SET hit_count = hit_count + 1 WHERE id = ?').run(row.id);
    }
    return row;
  }

  insertToolCacheEntry(entry: ToolCacheInput): void {
    const validated = ToolCacheSchema.parse(entry);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tool_cache (id, tool_name, input_hash, result, group_id, created_at, expires_at, hit_count)
       VALUES (@id, @tool_name, @input_hash, @result, @group_id, @created_at, @expires_at, @hit_count)`,
      )
      .run(validated);
  }

  clearExpiredCache(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare('DELETE FROM tool_cache WHERE expires_at <= ?').run(now);
    return result.changes;
  }

  // --- Scheduled Tasks ---

  insertScheduledTask(task: ScheduledTaskInput): void {
    const validated = ScheduledTaskSchema.parse(task);
    this.db
      .prepare(
        `INSERT INTO scheduled_tasks (id, group_id, name, cron, instruction, enabled, last_run, next_run)
       VALUES (@id, @group_id, @name, @cron, @instruction, @enabled, @last_run, @next_run)`,
      )
      .run(validated);
  }

  getEnabledTasks(): ScheduledTask[] {
    return this.db
      .prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1')
      .all() as ScheduledTask[];
  }

  getScheduledTasksByGroup(groupId: string): ScheduledTask[] {
    return this.db
      .prepare('SELECT * FROM scheduled_tasks WHERE group_id = ? AND enabled = 1')
      .all(groupId) as ScheduledTask[];
  }

  deleteScheduledTask(id: string, groupId: string): void {
    this.db
      .prepare('DELETE FROM scheduled_tasks WHERE id = ? AND group_id = ?')
      .run(id, groupId);
  }

  updateTaskLastRun(id: string, lastRun: number, nextRun: number): void {
    this.db
      .prepare('UPDATE scheduled_tasks SET last_run = ?, next_run = ? WHERE id = ?')
      .run(lastRun, nextRun, id);
  }

  updateTaskLastRunOnly(id: string, timestamp: number): void {
    this.db
      .prepare('UPDATE scheduled_tasks SET last_run = ? WHERE id = ?')
      .run(timestamp, id);
  }

  // --- Groups ---

  insertGroup(group: GroupInput): void {
    const validated = GroupSchema.parse(group);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO groups (id, channel, name, trigger_word, execution_mode, allowed_tools)
       VALUES (@id, @channel, @name, @trigger_word, @execution_mode, @allowed_tools)`,
      )
      .run(validated);
  }

  getGroup(id: string): Group | undefined {
    return this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group | undefined;
  }

  getAllGroups(): Group[] {
    return this.db.prepare('SELECT * FROM groups').all() as Group[];
  }

  updateGroupLastActive(id: string): void {
    this.db.prepare('UPDATE groups SET last_active = unixepoch() WHERE id = ?').run(id);
  }

  // --- Model Catalog ---

  upsertModelCatalogEntry(entry: ModelCatalogInput): void {
    const validated = ModelCatalogSchema.parse(entry);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO model_catalog (provider_id, model_id, model_name, context_window, input_cost_per_1m, output_cost_per_1m, capabilities, tier, fetched_at, expires_at)
       VALUES (@provider_id, @model_id, @model_name, @context_window, @input_cost_per_1m, @output_cost_per_1m, @capabilities, @tier, @fetched_at, @expires_at)`,
      )
      .run(validated);
  }

  getModelsByProvider(providerId: string): ModelCatalogEntry[] {
    const now = Math.floor(Date.now() / 1000);
    return this.db
      .prepare('SELECT * FROM model_catalog WHERE provider_id = ? AND expires_at > ?')
      .all(providerId, now) as ModelCatalogEntry[];
  }

  getModelsByTier(tier: string): ModelCatalogEntry[] {
    const now = Math.floor(Date.now() / 1000);
    return this.db
      .prepare('SELECT * FROM model_catalog WHERE tier = ? AND expires_at > ?')
      .all(tier, now) as ModelCatalogEntry[];
  }

  clearProviderModels(providerId: string): void {
    this.db.prepare('DELETE FROM model_catalog WHERE provider_id = ?').run(providerId);
  }

  // --- Security Events ---

  insertSecurityEvent(event: SecurityEventInput): void {
    const validated = SecurityEventSchema.parse(event);
    this.db
      .prepare(
        `INSERT INTO security_events (id, event_type, group_id, severity, details, blocked)
       VALUES (@id, @event_type, @group_id, @severity, @details, @blocked)`,
      )
      .run(validated);
  }

  getSecurityEvents(limit = 100): SecurityEvent[] {
    return this.db
      .prepare('SELECT * FROM security_events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as SecurityEvent[];
  }

  // --- IPC Messages ---

  insertIpcMessage(msg: IpcMessageInput): void {
    const validated = IpcMessageSchema.parse(msg);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ipc_messages (id, type, payload, processed)
       VALUES (@id, @type, @payload, @processed)`,
      )
      .run(validated);
  }

  getUnprocessedIpcMessages(): IpcMessage[] {
    return this.db
      .prepare('SELECT * FROM ipc_messages WHERE processed = 0 ORDER BY created_at ASC')
      .all() as IpcMessage[];
  }

  markIpcProcessed(id: string): void {
    this.db.prepare('UPDATE ipc_messages SET processed = 1 WHERE id = ?').run(id);
  }

  // --- Pending once-tasks (cross-process one-shot scheduling) ---

  insertPendingOnceTask(task: { id: string; groupId: string; message: string; runAt: number }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO pending_once_tasks (id, group_id, message, run_at)
         VALUES (@id, @group_id, @message, @run_at)`,
      )
      .run({ id: task.id, group_id: task.groupId, message: task.message, run_at: task.runAt });
  }

  getPendingOnceTasks(): Array<{ id: string; group_id: string; message: string; run_at: number }> {
    return this.db
      .prepare('SELECT id, group_id, message, run_at FROM pending_once_tasks WHERE picked_up = 0 ORDER BY run_at ASC')
      .all() as Array<{ id: string; group_id: string; message: string; run_at: number }>;
  }

  markOnceTaskPickedUp(id: string): void {
    this.db.prepare('UPDATE pending_once_tasks SET picked_up = 1 WHERE id = ?').run(id);
  }

  // --- Snapshots ---

  insertSnapshot(snapshot: SnapshotInput): void {
    const validated = SnapshotSchema.parse(snapshot);
    this.db
      .prepare(
        `INSERT INTO snapshots (id, description, paths, storage_dir, expires_at)
       VALUES (@id, @description, @paths, @storage_dir, @expires_at)`,
      )
      .run(validated);
  }

  getSnapshots(limit = 20): Snapshot[] {
    return this.db
      .prepare('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Snapshot[];
  }

  deleteSnapshot(id: string): void {
    this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
  }

  pruneOldSnapshots(retainCount: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM snapshots WHERE id NOT IN (
         SELECT id FROM snapshots ORDER BY created_at DESC LIMIT ?
       )`,
      )
      .run(retainCount);
    return result.changes;
  }

  // --- Heartbeat Config ---

  upsertHeartbeatConfig(config: HeartbeatConfigInput): void {
    const validated = HeartbeatConfigSchema.parse(config);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO heartbeat_config (group_id, every_ms, model, light_context, show_ok, show_alerts, use_indicator, target, ack_max_chars, last_tick, next_tick, enabled)
       VALUES (@group_id, @every_ms, @model, @light_context, @show_ok, @show_alerts, @use_indicator, @target, @ack_max_chars, @last_tick, @next_tick, @enabled)`,
      )
      .run(validated);
  }

  getHeartbeatConfig(groupId: string): HeartbeatConfig | undefined {
    return this.db
      .prepare('SELECT * FROM heartbeat_config WHERE group_id = ? AND enabled = 1')
      .get(groupId) as HeartbeatConfig | undefined;
  }

  getAllHeartbeatConfigs(): HeartbeatConfig[] {
    return this.db
      .prepare('SELECT * FROM heartbeat_config WHERE enabled = 1')
      .all() as HeartbeatConfig[];
  }

  updateHeartbeatTick(groupId: string, lastTick: number, nextTick: number | null): void {
    this.db
      .prepare('UPDATE heartbeat_config SET last_tick = ?, next_tick = ? WHERE group_id = ?')
      .run(lastTick, nextTick, groupId);
  }

  setHeartbeatEnabled(groupId: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE heartbeat_config SET enabled = ? WHERE group_id = ?')
      .run(enabled ? 1 : 0, groupId);
  }

  // --- Heartbeat Log ---

  insertHeartbeatLog(entry: HeartbeatLogInput): void {
    const validated = HeartbeatLogSchema.parse(entry);
    this.db
      .prepare(
        `INSERT INTO heartbeat_log (id, group_id, tick_at, skipped, skip_reason, response_type, tokens_used, cost_usd)
       VALUES (@id, @group_id, @tick_at, @skipped, @skip_reason, @response_type, @tokens_used, @cost_usd)`,
      )
      .run(validated);
  }

  getHeartbeatLogs(groupId: string, limit = 20): HeartbeatLog[] {
    return this.db
      .prepare('SELECT * FROM heartbeat_log WHERE group_id = ? ORDER BY tick_at DESC LIMIT ?')
      .all(groupId, limit) as HeartbeatLog[];
  }

  // --- Memory FTS ---

  insertMemoryChunk(
    chunkId: string,
    content: string,
    groupId: string,
    sourceType: string,
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        'INSERT INTO memory_fts (chunk_id, content, group_id, source_type, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(chunkId, content, groupId, sourceType, now);
  }

  searchMemory(query: string, groupId?: string, limit = 5): Array<{
    chunk_id: string;
    content: string;
    group_id: string;
    source_type: string;
    rank: number;
  }> {
    if (groupId) {
      return this.db
        .prepare(
          `SELECT chunk_id, content, group_id, source_type, rank
         FROM memory_fts
         WHERE memory_fts MATCH ? AND group_id = ?
         ORDER BY rank
         LIMIT ?`,
        )
        .all(query, groupId, limit) as Array<{
        chunk_id: string;
        content: string;
        group_id: string;
        source_type: string;
        rank: number;
      }>;
    }
    return this.db
      .prepare(
        `SELECT chunk_id, content, group_id, source_type, rank
       FROM memory_fts
       WHERE memory_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      )
      .all(query, limit) as Array<{
      chunk_id: string;
      content: string;
      group_id: string;
      source_type: string;
      rank: number;
    }>;
  }

  // --- Transactions ---

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export { MicroClawDB };
export type {
  Message,
  MessageInput,
  Session,
  SessionInput,
  ToolCacheEntry,
  ToolCacheInput,
  ScheduledTask,
  ScheduledTaskInput,
  Group,
  GroupInput,
  ModelCatalogEntry,
  ModelCatalogInput,
  SecurityEvent,
  SecurityEventInput,
  IpcMessage,
  IpcMessageInput,
  Snapshot,
  SnapshotInput,
  HeartbeatConfig,
  HeartbeatConfigInput,
  HeartbeatLog,
  HeartbeatLogInput,
  ResourceProfile,
};
export {
  MessageSchema,
  SessionSchema,
  ToolCacheSchema,
  ScheduledTaskSchema,
  GroupSchema,
  ModelCatalogSchema,
  SecurityEventSchema,
  IpcMessageSchema,
  SnapshotSchema,
  HeartbeatConfigSchema,
  HeartbeatLogSchema,
};
