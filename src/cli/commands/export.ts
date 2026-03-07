import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MicroClawDB } from '../../db.js';

interface ExportOptions {
  group?: string;
  format?: 'json' | 'md';
  output?: string;
}

interface ExportPayload {
  exportedAt: string;
  groups: Array<{
    id: string;
    channel: string;
    name: string | null;
  }>;
  sessions: Array<{
    id: string;
    group_id: string;
    summary: string | null;
    key_facts: string | null;
    token_count: number | null;
    started_at: number;
    ended_at: number | null;
    model_used: string | null;
  }>;
  messages: Array<{
    id: string;
    group_id: string;
    sender_id: string;
    content: string;
    timestamp: number;
    channel: string;
  }>;
  memory: Array<{
    chunk_id: string;
    content: string;
    group_id: string;
    source_type: string;
  }>;
}

function buildPayload(db: MicroClawDB, groupId?: string): ExportPayload {
  const groups = groupId
    ? [db.getGroup(groupId)].filter(Boolean) as ExportPayload['groups']
    : db.getAllGroups();

  const groupIds = groups.map((g) => g.id);

  const sessions = db.db
    .prepare(
      groupIds.length > 0
        ? `SELECT * FROM sessions WHERE group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY started_at DESC`
        : 'SELECT * FROM sessions ORDER BY started_at DESC',
    )
    .all(...groupIds) as ExportPayload['sessions'];

  const messages = db.db
    .prepare(
      groupIds.length > 0
        ? `SELECT id, group_id, sender_id, content, timestamp, channel FROM messages WHERE group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY timestamp DESC LIMIT 500`
        : 'SELECT id, group_id, sender_id, content, timestamp, channel FROM messages ORDER BY timestamp DESC LIMIT 500',
    )
    .all(...groupIds) as ExportPayload['messages'];

  const memory = db.db
    .prepare(
      groupIds.length > 0
        ? `SELECT chunk_id, content, group_id, source_type FROM memory_fts WHERE group_id IN (${groupIds.map(() => '?').join(',')}) LIMIT 500`
        : 'SELECT chunk_id, content, group_id, source_type FROM memory_fts LIMIT 500',
    )
    .all(...groupIds) as ExportPayload['memory'];

  return {
    exportedAt: new Date().toISOString(),
    groups,
    sessions,
    messages,
    memory,
  };
}

function toMarkdown(payload: ExportPayload): string {
  const lines: string[] = [
    `# MicroClaw Export`,
    ``,
    `Exported at: ${payload.exportedAt}`,
    ``,
  ];

  if (payload.groups.length > 0) {
    lines.push('## Groups', '');
    for (const g of payload.groups) {
      lines.push(`- **${g.id}** (${g.channel})${g.name ? ` — ${g.name}` : ''}`);
    }
    lines.push('');
  }

  if (payload.sessions.length > 0) {
    lines.push('## Sessions', '');
    for (const s of payload.sessions) {
      lines.push(`### Session ${s.id}`);
      lines.push(`- Group: ${s.group_id}`);
      lines.push(`- Started: ${new Date(s.started_at * 1000).toISOString()}`);
      if (s.ended_at) lines.push(`- Ended: ${new Date(s.ended_at * 1000).toISOString()}`);
      if (s.model_used) lines.push(`- Model: ${s.model_used}`);
      if (s.token_count) lines.push(`- Tokens: ${s.token_count}`);
      if (s.summary) lines.push(`- Summary: ${s.summary}`);
      if (s.key_facts) lines.push(`- Key facts: ${s.key_facts}`);
      lines.push('');
    }
  }

  if (payload.messages.length > 0) {
    lines.push('## Messages', '');
    for (const m of payload.messages) {
      const ts = new Date(m.timestamp * 1000).toISOString();
      lines.push(`- [${ts}] **${m.sender_id}** (${m.channel}): ${m.content}`);
    }
    lines.push('');
  }

  if (payload.memory.length > 0) {
    lines.push('## Memory Chunks', '');
    for (const c of payload.memory) {
      lines.push(`- [${c.source_type}] (${c.group_id}) ${c.content.slice(0, 120)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function runExport(options: ExportOptions): void {
  const dbPath = resolve(process.cwd(), '.micro', 'microclaw.db');
  let db: MicroClawDB;
  try {
    db = new MicroClawDB(dbPath);
  } catch {
    console.error('Could not open database at', dbPath);
    console.error('Run "microclaw setup" first.');
    return;
  }

  try {
    const payload = buildPayload(db, options.group);
    const fmt = options.format ?? 'json';
    const content =
      fmt === 'md' ? toMarkdown(payload) : JSON.stringify(payload, null, 2);

    if (options.output) {
      const outPath = resolve(options.output);
      writeFileSync(outPath, content, 'utf-8');
      console.log(`Exported to ${outPath}`);
    } else {
      console.log(content);
    }
  } finally {
    db.close();
  }
}

const exportCommand = new Command('export')
  .description('Export conversations, memory, and session data')
  .option('--group <id>', 'Export a specific group only')
  .option('--format <fmt>', 'Output format: json or md (default: json)')
  .option('--output <path>', 'Write to file instead of stdout')
  .action((options: ExportOptions) => {
    runExport(options);
  });

export { exportCommand };
