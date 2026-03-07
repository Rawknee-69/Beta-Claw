import { z } from 'zod';
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  TokenCost,
  ModelCatalogResponse,
  ProviderFeature,
} from './interface.js';

const COHERE_MODELS = [
  {
    id: 'command-r-plus',
    name: 'Command R+',
    contextWindow: 128_000,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
    capabilities: ['streaming', 'function_calling', 'system_message'],
  },
  {
    id: 'command-r',
    name: 'Command R',
    contextWindow: 128_000,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    capabilities: ['streaming', 'function_calling', 'system_message'],
  },
  {
    id: 'command-light',
    name: 'Command Light',
    contextWindow: 4_096,
    inputCostPer1M: 0.3,
    outputCostPer1M: 0.6,
    capabilities: ['streaming', 'system_message'],
  },
];

const CohereChatResponseSchema = z.object({
  text: z.string(),
  generation_id: z.string().optional(),
  finish_reason: z.string().optional(),
  meta: z
    .object({
      tokens: z
        .object({
          input_tokens: z.number().int().default(0),
          output_tokens: z.number().int().default(0),
        })
        .optional(),
    })
    .optional(),
  tool_calls: z
    .array(
      z.object({
        name: z.string(),
        parameters: z.record(z.unknown()),
      }),
    )
    .optional(),
});

const CohereStreamEventSchema = z.object({
  event_type: z.string(),
  text: z.string().optional(),
  is_finished: z.boolean().optional(),
  finish_reason: z.string().optional(),
  response: z
    .object({
      meta: z
        .object({
          tokens: z
            .object({
              input_tokens: z.number().int().default(0),
              output_tokens: z.number().int().default(0),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

type SecretAccessor = () => string;

class CohereAdapter implements IProviderAdapter {
  readonly id = 'cohere';
  readonly name = 'Cohere';
  readonly baseURL = 'https://api.cohere.ai/v1';

  private readonly getApiKey: SecretAccessor;

  constructor(getApiKey: SecretAccessor) {
    this.getApiKey = getApiKey;
  }

  async fetchAvailableModels(): Promise<ModelCatalogResponse> {
    return {
      models: COHERE_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        inputCostPer1M: m.inputCostPer1M,
        outputCostPer1M: m.outputCostPer1M,
        capabilities: [...m.capabilities],
        deprecated: false,
      })),
      fetchedAt: Math.floor(Date.now() / 1000),
      providerID: this.id,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(req);

    const response = await fetch(`${this.baseURL}/chat`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cohere completion failed: ${response.status} ${errorText}`);
    }

    const raw: unknown = await response.json();
    const parsed = CohereChatResponseSchema.parse(raw);

    const toolCalls = parsed.tool_calls?.map((tc, i) => ({
      id: `cohere-tc-${i}`,
      name: tc.name,
      arguments: tc.parameters,
    }));

    const inputTokens = parsed.meta?.tokens?.input_tokens ?? 0;
    const outputTokens = parsed.meta?.tokens?.output_tokens ?? 0;

    return {
      content: parsed.text,
      model: req.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: this.mapFinishReason(parsed.finish_reason),
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body = this.buildRequestBody(req);
    body['stream'] = true;

    const response = await fetch(`${this.baseURL}/chat`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cohere stream failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Cohere stream returned no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = CohereStreamEventSchema.parse(JSON.parse(trimmed));

            if (event.event_type === 'text-generation' && event.text) {
              yield { content: event.text, done: false };
            }

            if (event.event_type === 'stream-end') {
              const inTok = event.response?.meta?.tokens?.input_tokens ?? 0;
              const outTok = event.response?.meta?.tokens?.output_tokens ?? 0;
              yield {
                content: '',
                done: true,
                usage: {
                  inputTokens: inTok,
                  outputTokens: outTok,
                  totalTokens: inTok + outTok,
                },
              };
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  estimateCost(req: CompletionRequest): TokenCost {
    const avgCharsPerToken = 4;
    const inputChars =
      req.messages.reduce((sum, m) => sum + m.content.length, 0) +
      (req.systemPrompt?.length ?? 0);
    const estimatedInputTokens = Math.ceil(inputChars / avgCharsPerToken);
    const estimatedOutputTokens = req.maxTokens ?? Math.ceil(estimatedInputTokens * 0.5);

    const model = COHERE_MODELS.find((m) => req.model === m.id);
    const inputCost = model?.inputCostPer1M ?? 2.5;
    const outputCost = model?.outputCostPer1M ?? 10.0;

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUSD:
        (estimatedInputTokens / 1_000_000) * inputCost +
        (estimatedOutputTokens / 1_000_000) * outputCost,
    };
  }

  supportsFeature(feature: ProviderFeature): boolean {
    const supported: Set<ProviderFeature> = new Set([
      'streaming',
      'function_calling',
      'system_message',
    ]);
    return supported.has(feature);
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
      'Content-Type': 'application/json',
    };
  }

  private buildRequestBody(req: CompletionRequest): Record<string, unknown> {
    const chatHistory: Array<{ role: string; message: string }> = [];
    const lastMsg = req.messages[req.messages.length - 1];
    const lastMessage = lastMsg?.content ?? '';

    for (let i = 0; i < req.messages.length - 1; i++) {
      const msg = req.messages[i];
      if (msg) {
        chatHistory.push({
          role: msg.role === 'user' ? 'USER' : 'CHATBOT',
          message: msg.content,
        });
      }
    }

    const body: Record<string, unknown> = {
      model: req.model,
      message: lastMessage,
    };

    if (chatHistory.length > 0) {
      body['chat_history'] = chatHistory;
    }

    if (req.systemPrompt) {
      body['preamble'] = req.systemPrompt;
    }

    if (req.temperature !== undefined) {
      body['temperature'] = req.temperature;
    }

    if (req.maxTokens) {
      body['max_tokens'] = req.maxTokens;
    }

    if (req.tools && req.tools.length > 0) {
      body['tools'] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameter_definitions: t.input_schema,
      }));
    }

    return body;
  }

  private mapFinishReason(
    reason: string | undefined,
  ): 'stop' | 'length' | 'tool_use' | 'error' {
    switch (reason) {
      case 'COMPLETE':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'TOOL_CALL':
        return 'tool_use';
      case 'ERROR':
        return 'error';
      default:
        return 'stop';
    }
  }
}

export { CohereAdapter };
