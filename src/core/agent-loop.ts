import type { IProviderAdapter, CompletionResponse } from '../providers/interface.js';
import type { ModelEntry } from './model-catalog.js';
import { TOOLS } from './tools.js';
import { ToolExecutor } from './tool-executor.js';
import { trimHistory, type Message } from './token-budget.js';
import type { MicroClawDB } from '../db.js';

export interface LoopConfig {
  provider: IProviderAdapter;
  model: ModelEntry;
  systemPrompt: string;
  db: MicroClawDB;
  groupId: string;
  onToolCall?: (name: string) => void;
  maxIterations?: number;
}

interface ToolCall { name: string; args: Record<string, unknown> }

export async function agentLoop(messages: Message[], cfg: LoopConfig): Promise<string> {
  const exec = new ToolExecutor(cfg.db, cfg.groupId);
  const max = cfg.maxIterations ?? 8;
  let hist = [...messages];

  for (let i = 0; i < max; i++) {
    const trimmed = trimHistory(hist, cfg.model.id, cfg.systemPrompt);

    let response: CompletionResponse;
    try {
      response = await cfg.provider.complete({
        model: cfg.model.id,
        messages: trimmed,
        maxTokens: 2048,
        systemPrompt: cfg.systemPrompt,
        tools: TOOLS,
      });
    } catch (e) {
      return `Provider error: ${e instanceof Error ? e.message : String(e)}`;
    }

    const calls = extractCalls(response);

    if (calls.length === 0) {
      return response.content?.trim() ?? '';
    }

    const resultLines: string[] = [];
    for (const call of calls) {
      cfg.onToolCall?.(call.name);
      const result = await exec.run(call.name, call.args);
      resultLines.push(`[${call.name}] ${result}`);
    }

    hist.push({ role: 'assistant', content: response.content || `[Used tools: ${calls.map(c => c.name).join(', ')}]` });
    hist.push({ role: 'user', content: `Tool results:\n${resultLines.join('\n')}` });
  }

  return '(max iterations reached)';
}

function extractCalls(r: CompletionResponse): ToolCall[] {
  if (r.toolCalls?.length) {
    return r.toolCalls.map(t => ({ name: t.name, args: t.arguments }));
  }
  return [];
}
