import { z } from 'zod';
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  TokenCost,
  ModelCatalogResponse,
  ModelEntry,
  ProviderFeature,
} from './interface.js';

const OpenRouterModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  context_length: z.number().int().default(4096),
  pricing: z.object({
    prompt: z.string().default('0'),
    completion: z.string().default('0'),
  }).default({ prompt: '0', completion: '0' }),
  top_provider: z.object({
    is_moderated: z.boolean().optional(),
  }).optional(),
  architecture: z.object({
    modality: z.string().optional(),
    tokenizer: z.string().optional(),
    instruct_type: z.string().nullable().optional(),
  }).optional(),
});

const OpenRouterModelsResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});

const OpenRouterChatResponseSchema = z.object({
  id: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string().nullable().default(''),
        tool_calls: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            function: z.object({
              name: z.string(),
              arguments: z.string(),
            }),
          }),
        ).optional(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number().int().default(0),
    completion_tokens: z.number().int().default(0),
    total_tokens: z.number().int().default(0),
  }).optional(),
});

const OpenRouterStreamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({
        content: z.string().nullable().optional(),
      }),
      finish_reason: z.string().nullable().optional(),
    }),
  ).optional(),
  usage: z.object({
    prompt_tokens: z.number().int().default(0),
    completion_tokens: z.number().int().default(0),
    total_tokens: z.number().int().default(0),
  }).optional(),
});

type SecretAccessor = () => string;

class OpenRouterAdapter implements IProviderAdapter {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  readonly baseURL = 'https://openrouter.ai/api/v1';

  private readonly getApiKey: SecretAccessor;

  constructor(getApiKey: SecretAccessor) {
    this.getApiKey = getApiKey;
  }

  async fetchAvailableModels(): Promise<ModelCatalogResponse> {
    const response = await fetch(`${this.baseURL}/models`, {
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter models fetch failed: ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    const parsed = OpenRouterModelsResponseSchema.parse(raw);

    const models: ModelEntry[] = parsed.data
      .filter((m) => !m.id.includes(':free') || m.id.endsWith(':free'))
      .map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.context_length,
        inputCostPer1M: parseFloat(m.pricing.prompt) * 1_000_000,
        outputCostPer1M: parseFloat(m.pricing.completion) * 1_000_000,
        capabilities: this.inferCapabilities(m),
        deprecated: false,
      }));

    return {
      models,
      fetchedAt: Math.floor(Date.now() / 1000),
      providerID: this.id,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(req);

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter completion failed: ${response.status} ${errorText}`);
    }

    const raw = await response.json();
    const parsed = OpenRouterChatResponseSchema.parse(raw);

    const choice = parsed.choices[0];
    if (!choice) {
      throw new Error('OpenRouter returned empty choices');
    }

    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content ?? '',
      model: req.model,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
        totalTokens: parsed.usage?.total_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
      toolCalls,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body = this.buildRequestBody(req);
    body['stream'] = true;

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter stream failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('OpenRouter stream returned no body');
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }

          try {
            const parsed = OpenRouterStreamChunkSchema.parse(JSON.parse(data));
            const delta = parsed.choices?.[0]?.delta;
            const content = delta?.content ?? '';
            const isDone = parsed.choices?.[0]?.finish_reason !== null && parsed.choices?.[0]?.finish_reason !== undefined;

            yield {
              content,
              done: isDone,
              usage: parsed.usage
                ? {
                    inputTokens: parsed.usage.prompt_tokens,
                    outputTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  }
                : undefined,
            };
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  estimateCost(req: CompletionRequest): TokenCost {
    const avgCharsPerToken = 4;
    const inputChars = req.messages.reduce((sum, m) => sum + m.content.length, 0) +
      (req.systemPrompt?.length ?? 0);
    const estimatedInputTokens = Math.ceil(inputChars / avgCharsPerToken);
    const estimatedOutputTokens = req.maxTokens ?? Math.ceil(estimatedInputTokens * 0.5);

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUSD: 0,
    };
  }

  supportsFeature(feature: ProviderFeature): boolean {
    const supported: Set<ProviderFeature> = new Set([
      'streaming',
      'function_calling',
      'system_message',
      'json_mode',
    ]);
    return supported.has(feature);
  }

  private buildHeaders(): Record<string, string> {
    const apiKey = this.getApiKey();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/microclaw',
      'X-Title': 'MicroClaw',
    };
    const buf = Buffer.from(apiKey);
    buf.fill(0);
    return headers;
  }

  private buildRequestBody(req: CompletionRequest): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [];

    if (req.systemPrompt) {
      messages.push({ role: 'system', content: req.systemPrompt });
    }

    for (const msg of req.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
    };

    if (req.maxTokens) body['max_tokens'] = req.maxTokens;
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.tools && req.tools.length > 0) {
      body['tools'] = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    return body;
  }

  private mapFinishReason(reason: string | null): 'stop' | 'length' | 'tool_use' | 'error' {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'tool_calls': return 'tool_use';
      case 'function_call': return 'tool_use';
      default: return 'stop';
    }
  }

  private inferCapabilities(model: z.infer<typeof OpenRouterModelSchema>): string[] {
    const caps: string[] = ['streaming', 'system_message'];
    const id = model.id.toLowerCase();

    if (id.includes('gpt') || id.includes('claude') || id.includes('gemini')) {
      caps.push('function_calling');
    }
    if (id.includes('vision') || id.includes('4o') || id.includes('gemini')) {
      caps.push('vision');
    }
    if (id.includes('gpt') || id.includes('gemini')) {
      caps.push('json_mode');
    }

    return caps;
  }
}

export { OpenRouterAdapter };
