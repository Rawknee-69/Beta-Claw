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

const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000, inputCost: 3.0, outputCost: 15.0, tier: 'pro' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000, inputCost: 15.0, outputCost: 75.0, tier: 'max' },
  { id: 'claude-haiku-3-5-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000, inputCost: 0.80, outputCost: 4.0, tier: 'standard' },
] as const;

const AnthropicResponseSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  content: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
      z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
        input: z.record(z.unknown()),
      }),
    ]),
  ),
  model: z.string(),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
    cache_creation_input_tokens: z.number().int().optional(),
    cache_read_input_tokens: z.number().int().optional(),
  }),
});

const AnthropicStreamEventSchema = z.object({
  type: z.string(),
  index: z.number().int().optional(),
  delta: z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      stop_reason: z.string().nullable().optional(),
    })
    .optional(),
  message: z
    .object({
      usage: z
        .object({
          input_tokens: z.number().int(),
          output_tokens: z.number().int(),
        })
        .optional(),
    })
    .optional(),
  usage: z
    .object({
      output_tokens: z.number().int(),
    })
    .optional(),
});

type SecretAccessor = () => string;

class AnthropicAdapter implements IProviderAdapter {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  readonly baseURL = 'https://api.anthropic.com/v1';

  private readonly getApiKey: SecretAccessor;

  constructor(getApiKey: SecretAccessor) {
    this.getApiKey = getApiKey;
  }

  async fetchAvailableModels(): Promise<ModelCatalogResponse> {
    return {
      models: ANTHROPIC_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        inputCostPer1M: m.inputCost,
        outputCostPer1M: m.outputCost,
        capabilities: ['streaming', 'function_calling', 'vision', 'prompt_caching', 'system_message'],
        deprecated: false,
      })),
      fetchedAt: Math.floor(Date.now() / 1000),
      providerID: this.id,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(req);

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic completion failed: ${response.status} ${errorText}`);
    }

    const raw = await response.json();
    const parsed = AnthropicResponseSchema.parse(raw);

    let content = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

    for (const block of parsed.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    const cachedTokens =
      (parsed.usage.cache_read_input_tokens ?? 0) +
      (parsed.usage.cache_creation_input_tokens ?? 0);

    return {
      content,
      model: parsed.model,
      usage: {
        inputTokens: parsed.usage.input_tokens,
        outputTokens: parsed.usage.output_tokens,
        totalTokens: parsed.usage.input_tokens + parsed.usage.output_tokens,
        cachedTokens: cachedTokens > 0 ? cachedTokens : undefined,
      },
      finishReason: this.mapStopReason(parsed.stop_reason),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body = this.buildRequestBody(req);
    body['stream'] = true;

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic stream failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Anthropic stream returned no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          try {
            const event = AnthropicStreamEventSchema.parse(JSON.parse(data));

            if (event.type === 'message_start' && event.message?.usage) {
              totalInputTokens = event.message.usage.input_tokens;
            }

            if (event.type === 'content_block_delta' && event.delta?.text) {
              yield { content: event.delta.text, done: false };
            }

            if (event.type === 'message_delta') {
              if (event.usage) {
                totalOutputTokens = event.usage.output_tokens;
              }
              yield {
                content: '',
                done: true,
                usage: {
                  inputTokens: totalInputTokens,
                  outputTokens: totalOutputTokens,
                  totalTokens: totalInputTokens + totalOutputTokens,
                },
              };
            }
          } catch {
            // Skip malformed events
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

    const model = ANTHROPIC_MODELS.find((m) => req.model.includes(m.id.split('-').slice(0, 2).join('-')));
    const inputCost = model?.inputCost ?? 3.0;
    const outputCost = model?.outputCost ?? 15.0;

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
      'vision',
      'prompt_caching',
      'system_message',
    ]);
    return supported.has(feature);
  }

  private buildHeaders(): Record<string, string> {
    const apiKey = this.getApiKey();
    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
    const buf = Buffer.from(apiKey);
    buf.fill(0);
    return headers;
  }

  private buildRequestBody(req: CompletionRequest): Record<string, unknown> {
    const messages = req.messages.map((m) => ({
      role: m.role === 'system' ? 'user' : m.role,
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
    };

    if (req.systemPrompt) {
      body['system'] = req.systemPrompt;
    }

    if (req.temperature !== undefined) {
      body['temperature'] = req.temperature;
    }

    if (req.tools && req.tools.length > 0) {
      body['tools'] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return body;
  }

  private mapStopReason(reason: string | null): 'stop' | 'length' | 'tool_use' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_use';
      default:
        return 'stop';
    }
  }
}

export { AnthropicAdapter };
