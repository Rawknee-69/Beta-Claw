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

const OpenAICompatChatResponseSchema = z.object({
  id: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string().nullable().default(''),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              type: z.string(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .optional(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().default(0),
      completion_tokens: z.number().int().default(0),
      total_tokens: z.number().int().default(0),
    })
    .optional(),
});

const OpenAICompatStreamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({
          content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().default(0),
      completion_tokens: z.number().int().default(0),
      total_tokens: z.number().int().default(0),
    })
    .optional(),
});

interface StaticModelDef {
  id: string;
  name: string;
  contextWindow: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  capabilities: string[];
}

type SecretAccessor = () => string;

interface OpenAICompatConfig {
  id: string;
  name: string;
  baseURL: string;
  features: Set<ProviderFeature>;
  staticModels: StaticModelDef[];
  defaultInputCost: number;
  defaultOutputCost: number;
}

class OpenAICompatAdapter implements IProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly baseURL: string;

  protected readonly getApiKey: SecretAccessor;
  protected readonly features: Set<ProviderFeature>;
  protected readonly staticModels: StaticModelDef[];
  protected readonly defaultInputCost: number;
  protected readonly defaultOutputCost: number;

  constructor(config: OpenAICompatConfig, getApiKey: SecretAccessor) {
    this.id = config.id;
    this.name = config.name;
    this.baseURL = config.baseURL;
    this.features = config.features;
    this.staticModels = config.staticModels;
    this.defaultInputCost = config.defaultInputCost;
    this.defaultOutputCost = config.defaultOutputCost;
    this.getApiKey = getApiKey;
  }

  async fetchAvailableModels(): Promise<ModelCatalogResponse> {
    return {
      models: this.staticModels.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        inputCostPer1M: m.inputCostPer1M,
        outputCostPer1M: m.outputCostPer1M,
        capabilities: m.capabilities,
        deprecated: false,
      })),
      fetchedAt: Math.floor(Date.now() / 1000),
      providerID: this.id,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(req);

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.name} completion failed: ${response.status} ${errorText}`);
    }

    const raw: unknown = await response.json();
    const parsed = OpenAICompatChatResponseSchema.parse(raw);

    const choice = parsed.choices[0];
    if (!choice) {
      throw new Error(`${this.name} returned empty choices`);
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
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body = this.buildRequestBody(req);
    body['stream'] = true;

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.name} stream failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error(`${this.name} stream returned no body`);
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
            const chunk = OpenAICompatStreamChunkSchema.parse(JSON.parse(data));
            const delta = chunk.choices?.[0]?.delta;
            const content = delta?.content ?? '';
            const isDone =
              chunk.choices?.[0]?.finish_reason !== null &&
              chunk.choices?.[0]?.finish_reason !== undefined;

            yield {
              content,
              done: isDone,
              usage: chunk.usage
                ? {
                    inputTokens: chunk.usage.prompt_tokens,
                    outputTokens: chunk.usage.completion_tokens,
                    totalTokens: chunk.usage.total_tokens,
                  }
                : undefined,
            };
          } catch {
            // skip malformed chunks
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

    const model = this.staticModels.find((m) => req.model === m.id);
    const inputCost = model?.inputCostPer1M ?? this.defaultInputCost;
    const outputCost = model?.outputCostPer1M ?? this.defaultOutputCost;

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUSD:
        (estimatedInputTokens / 1_000_000) * inputCost +
        (estimatedOutputTokens / 1_000_000) * outputCost,
    };
  }

  supportsFeature(feature: ProviderFeature): boolean {
    return this.features.has(feature);
  }

  protected buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
      'Content-Type': 'application/json',
    };
  }

  protected buildRequestBody(req: CompletionRequest): Record<string, unknown> {
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

  protected mapFinishReason(reason: string | null): 'stop' | 'length' | 'tool_use' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_use';
      case 'function_call':
        return 'tool_use';
      default:
        return 'stop';
    }
  }
}

export { OpenAICompatAdapter };
export type { StaticModelDef, SecretAccessor, OpenAICompatConfig };
