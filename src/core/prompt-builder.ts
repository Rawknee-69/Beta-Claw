import fs from 'node:fs';
import { compressMemoryFile } from './token-budget.js';

export async function buildSystemPrompt(groupId: string): Promise<string> {
  const soulPath = `groups/${groupId}/SOUL.md`;
  const claudePath = `groups/${groupId}/CLAUDE.md`;

  const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8').trim() : '';
  const rawMemory = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf-8').trim() : '';
  const memory = rawMemory ? compressMemoryFile(rawMemory) : '';

  const parts: string[] = [];

  if (soul) parts.push(soul);

  parts.push(
    `You are a capable AI assistant. You have real tools and you USE them to accomplish tasks.
Do not describe actions — execute them. When asked to create a file, call write_file. When asked to run code, call run_cmd.
Current directory: ${process.cwd()}`,
  );

  if (memory) parts.push(`Long-term memory:\n${memory}`);

  return parts.join('\n\n---\n\n');
}
