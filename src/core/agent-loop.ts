import type { IProviderAdapter, CompletionResponse } from '../providers/interface.js';
import type { ModelEntry } from './model-catalog.js';
import { TOOLS, type ToolDefinition } from './tools.js';
import { ToolExecutor, type ApprovalCallback } from './tool-executor.js';
import { trimHistory, type Message } from './token-budget.js';
import type { MicroClawDB } from '../db.js';
import type { SandboxRunOptions } from '../execution/sandbox.js';
import { hookRegistry } from '../hooks/hook-registry.js';
import { skillRegistry } from '../skills/skill-registry.js';
import { runSkillEphemeral } from '../execution/ephemeral-sandbox.js';
import { BROWSER_TOOL_DEFINITION } from '../browser/browser-tool.js';

const MAX_ITERATIONS = 10;

export interface LoopConfig {
  provider: IProviderAdapter;
  model: ModelEntry;
  systemPrompt: string;
  db: MicroClawDB;
  groupId: string;
  senderId?: string;
  sessionKey?: string;
  sandboxOpts: SandboxRunOptions;
  onToolCall?: (name: string) => void;
  onApprovalRequired?: ApprovalCallback;
  maxIterations?: number;
  activeSkillName?: string;
  useEphemeral?: boolean;
}

interface ToolCall { name: string; args: Record<string, unknown> }

export async function agentLoop(messages: Message[], cfg: LoopConfig): Promise<string> {
  const exec = new ToolExecutor(cfg.groupId, process.cwd(), cfg.sandboxOpts);
  if (cfg.onApprovalRequired) exec.onApprovalRequired = cfg.onApprovalRequired;
  const max = cfg.maxIterations ?? MAX_ITERATIONS;
  let hist = [...messages];
  const sessionKey = cfg.sessionKey ?? 'main';

  // Determine if this skill run should use ephemeral sandbox
  const activeSkill = cfg.activeSkillName;
  const skillEntry  = activeSkill ? skillRegistry.get(activeSkill) : undefined;
  const useEphemeral = skillEntry?.status === 'converted' || cfg.useEphemeral;

  // Build tool list: include browser tool if the active skill needs it
  const tools: ToolDefinition[] = [...TOOLS];
  if (skillEntry?.meta.allowedTools.includes('browser') || !activeSkill) {
    tools.push(BROWSER_TOOL_DEFINITION);
  }

  for (let i = 0; i < max; i++) {
    const trimmed = trimHistory(hist, cfg.model.id, cfg.systemPrompt);

    let response: CompletionResponse;
    try {
      response = await cfg.provider.complete({
        model: cfg.model.id,
        messages: trimmed,
        maxTokens: 2048,
        systemPrompt: cfg.systemPrompt,
        tools,
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

      let rawResult: string;
      if (useEphemeral && call.name === 'exec' && activeSkill) {
        rawResult = await runSkillEphemeral(activeSkill, call.args['cmd'] as string);
      } else {
        rawResult = await exec.run(call.name, call.args);
      }

      const finalResult = hookRegistry.applyToolResult({
        type: 'tool_result', toolName: call.name, result: rawResult, sessionKey,
      });
      resultLines.push(`[${call.name}] ${typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult)}`);
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
