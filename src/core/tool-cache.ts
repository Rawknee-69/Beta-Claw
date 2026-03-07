import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { encode } from './toon-serializer.js';
import { MicroClawDB } from '../db.js';

interface CachedToolResult {
  toolName: string;
  inputHash: string;
  result: string;
  createdAt: number;
  ttlMs: number;
  hitCount: number;
}

const DEFAULT_TTL_SECONDS: Record<string, number> = {
  brave_search: 86400,
  serper_search: 86400,
  fetch_url: 1800,
  run_code: 0,
  read_file: 300,
  install_pkg: 604800,
};

const NEWS_KEYWORDS = ['news', 'latest', 'today', 'breaking', 'recent', 'update'];

function isNewsQuery(inputs: Record<string, unknown>): boolean {
  const query = String(inputs['query'] ?? inputs['q'] ?? '').toLowerCase();
  return NEWS_KEYWORDS.some((kw) => query.includes(kw));
}

function getEffectiveTTL(toolName: string, inputs: Record<string, unknown>): number {
  if (toolName === 'brave_search' || toolName === 'serper_search') {
    return isNewsQuery(inputs) ? 3600 : 86400;
  }
  return DEFAULT_TTL_SECONDS[toolName] ?? 3600;
}

function computeInputHash(inputs: Record<string, unknown>, groupId?: string): string {
  const toonEncoded = encode('input', inputs);
  const payload = groupId ? `${groupId}:${toonEncoded}` : toonEncoded;
  return createHash('sha256').update(payload).digest('hex');
}

class ToolCache {
  private readonly db: MicroClawDB;
  private readonly groupId: string | undefined;

  constructor(db: MicroClawDB, groupId?: string) {
    this.db = db;
    this.groupId = groupId;
  }

  get(toolName: string, inputs: Record<string, unknown>): string | undefined {
    const ttl = getEffectiveTTL(toolName, inputs);
    if (ttl === 0) return undefined;

    const inputHash = computeInputHash(inputs, this.groupId);
    const cached = this.db.getCachedToolResult(toolName, inputHash);
    if (!cached) return undefined;

    return cached.result;
  }

  set(toolName: string, inputs: Record<string, unknown>, result: string): void {
    const ttl = getEffectiveTTL(toolName, inputs);
    if (ttl === 0) return;

    const now = Math.floor(Date.now() / 1000);
    const inputHash = computeInputHash(inputs, this.groupId);

    this.db.insertToolCacheEntry({
      id: uuidv4(),
      tool_name: toolName,
      input_hash: inputHash,
      result,
      group_id: this.groupId ?? null,
      created_at: now,
      expires_at: now + ttl,
      hit_count: 0,
    });
  }

  invalidate(toolName: string, inputs: Record<string, unknown>): void {
    const inputHash = computeInputHash(inputs, this.groupId);
    this.db.db
      .prepare('DELETE FROM tool_cache WHERE tool_name = ? AND input_hash = ?')
      .run(toolName, inputHash);
  }

  cleanup(): number {
    return this.db.clearExpiredCache();
  }

  getTTL(toolName: string): number {
    return DEFAULT_TTL_SECONDS[toolName] ?? 3600;
  }
}

export { ToolCache, computeInputHash };
export type { CachedToolResult };
