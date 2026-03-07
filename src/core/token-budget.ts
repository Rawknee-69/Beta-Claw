export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6':                   200_000,
  'claude-sonnet-4-6':                 200_000,
  'claude-haiku-4-5-20251001':         200_000,

  'gemini-2.5-pro':                  1_000_000,
  'gemini-2.5-flash':                1_000_000,
  'gemini-2.5-flash-lite':           1_000_000,
  'gemini-3.1-pro-preview':          1_000_000,
  'gemini-3-flash':                    200_000,

  'meta-llama/llama-4-maverick':         128_000,
  'meta-llama/llama-3.3-70b-instruct':  128_000,
  'deepseek/deepseek-chat-v3-0324':     128_000,
  'deepseek/deepseek-r1':               128_000,
  'mistralai/mistral-large-2':          128_000,
  'mistralai/devstral-2':               262_000,
  'qwen/qwen3-235b-a22b':              131_072,
  'meta-llama/llama-3.1-8b-instruct':  128_000,

  '_local_default':                      32_000,
};

const RESPONSE_BUFFER = 4_000;
const SYSTEM_OVERHEAD  = 2_000;

export function getContextLimit(modelId: string): number {
  return CONTEXT_LIMITS[modelId] ?? CONTEXT_LIMITS['_local_default']!;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Trim history to fit within the model's context window.
 * Keeps the first user message (often has important context).
 * Removes oldest messages from the middle when over budget.
 */
export function trimHistory(
  messages: Message[],
  modelId: string,
  systemPrompt: string,
): Message[] {
  const limit = getContextLimit(modelId);
  const budget = limit - RESPONSE_BUFFER - SYSTEM_OVERHEAD - estimateTokens(systemPrompt);

  let total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (total <= budget) return messages;

  const trimmed = [...messages];
  while (total > budget && trimmed.length > 2) {
    const removed = trimmed.splice(1, 1)[0]!;
    total -= estimateTokens(removed.content);
  }
  return trimmed;
}

export function compressMemoryFile(content: string, maxTokens = 600): string {
  if (estimateTokens(content) <= maxTokens) return content;
  const lines = content.split('\n');
  let result = '';
  for (const line of lines) {
    if (estimateTokens(result + line) > maxTokens) break;
    result += line + '\n';
  }
  return result + '\n[memory truncated — older entries dropped]';
}
