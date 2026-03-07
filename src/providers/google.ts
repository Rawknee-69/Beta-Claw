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

const GEMINI_MODELS = [
  // --- Gemini 3.x series (latest) ---
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    capabilities: ['streaming', 'function_calling', 'vision', 'json_mode', 'structured_output', 'system_message', 'thinking', 'caching', 'code_execution', 'search_grounding'],
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
    capabilities: ['streaming', 'function_calling', 'vision', 'json_mode', 'structured_output', 'system_message', 'thinking', 'caching', 'code_execution', 'computer_use', 'search_grounding'],
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash-Lite Preview',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.30,
    capabilities: ['streaming', 'function_calling', 'vision', 'json_mode', 'structured_output', 'system_message', 'thinking', 'caching', 'code_execution', 'search_grounding'],
  },

  // --- Gemini 2.5 series ---
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    capabilities: ['streaming', 'function_calling', 'vision', 'json_mode', 'structured_output', 'system_message', 'thinking', 'caching', 'code_execution', 'search_grounding'],
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
    capabilities: ['streaming', 'function_calling', 'vision', 'json_mode', 'structured_output', 'system_message', 'thinking', 'caching', 'code_execution', 'search_grounding'],
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.30,
    capabilities: ['streaming', 'function_calling', 'vision', 'json_mode', 'structured_output', 'system_message', 'caching'],
  },
];

const GeminiResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(z.object({
          text: z.string().optional(),
          functionCall: z.object({
            name: z.string(),
            args: z.record(z.unknown()),
          }).optional(),
        })),
        role: z.string(),
      }).optional(),
      finishReason: z.string().optional(),
    }),
  ),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().default(0),
      candidatesTokenCount: z.number().int().default(0),
      totalTokenCount: z.number().int().default(0),
    })
    .optional(),
});

type SecretAccessor = () => string;

class GoogleAdapter implements IProviderAdapter {
  readonly id = 'google';
  readonly name = 'Google (Gemini)';
  readonly baseURL = 'https://generativelanguage.googleapis.com/v1beta';

  private readonly getApiKey: SecretAccessor;

  constructor(getApiKey: SecretAccessor) {
    this.getApiKey = getApiKey;
  }

  async fetchAvailableModels(): Promise<ModelCatalogResponse> {
    return {
      models: GEMINI_MODELS.map((m) => ({
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
    const url = `${this.baseURL}/models/${req.model}:generateContent?key=${this.getApiKey()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google completion failed: ${response.status} ${errorText}`);
    }

    const raw: unknown = await response.json();
    const parsed = GeminiResponseSchema.parse(raw);

    const candidate = parsed.candidates[0];
    if (!candidate) {
      throw new Error('Google returned empty candidates');
    }

    const parts = candidate.content?.parts ?? [];

    const content = parts
      .filter(p => p.text !== undefined)
      .map(p => p.text!)
      .join('');

    const toolCalls = parts
      .filter(p => p.functionCall !== undefined)
      .map(p => ({
        id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: p.functionCall!.name,
        arguments: p.functionCall!.args as Record<string, unknown>,
      }));

    return {
      content,
      model: req.model,
      usage: {
        inputTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: parsed.usageMetadata?.totalTokenCount ?? 0,
      },
      finishReason: this.mapFinishReason(candidate.finishReason),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body = this.buildRequestBody(req);
    const url = `${this.baseURL}/models/${req.model}:streamGenerateContent?key=${this.getApiKey()}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google stream failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Google stream returned no body');
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

          try {
            const chunk = GeminiResponseSchema.parse(JSON.parse(data));
            const candidate = chunk.candidates[0];
            const content = candidate?.content?.parts.map((p) => p.text ?? '').join('') ?? '';
            const isDone =
              candidate?.finishReason === 'STOP' || candidate?.finishReason === 'MAX_TOKENS';

            yield {
              content,
              done: isDone,
              usage:
                isDone && chunk.usageMetadata
                  ? {
                      inputTokens: chunk.usageMetadata.promptTokenCount,
                      outputTokens: chunk.usageMetadata.candidatesTokenCount,
                      totalTokens: chunk.usageMetadata.totalTokenCount,
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

    const model = GEMINI_MODELS.find((m) => req.model === m.id);
    const inputCost = model?.inputCostPer1M ?? 0.1;
    const outputCost = model?.outputCostPer1M ?? 0.4;

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
      'json_mode',
      'structured_output',
      'system_message',
    ]);
    return supported.has(feature);
  }

  private buildRequestBody(req: CompletionRequest): Record<string, unknown> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const msg of req.messages) {
      // Skip empty messages to avoid Gemini API errors
      if (!msg.content || msg.content.trim() === '') continue;
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    // Gemini requires alternating user/model turns; merge consecutive same-role messages
    const merged: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const turn of contents) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === turn.role) {
        prev.parts.push(...turn.parts);
      } else {
        merged.push({ role: turn.role, parts: [...turn.parts] });
      }
    }

    const body: Record<string, unknown> = { contents: merged };

    if (req.systemPrompt) {
      body['systemInstruction'] = { parts: [{ text: req.systemPrompt }] };
    }

    const generationConfig: Record<string, unknown> = {};
    if (req.maxTokens) generationConfig['maxOutputTokens'] = req.maxTokens;
    if (req.temperature !== undefined) generationConfig['temperature'] = req.temperature;
    if (Object.keys(generationConfig).length > 0) {
      body['generationConfig'] = generationConfig;
    }

    if (req.tools && req.tools.length > 0) {
      body['tools'] = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          })),
        },
      ];
    }

    return body;
  }

  private mapFinishReason(
    reason: string | undefined,
  ): 'stop' | 'length' | 'tool_use' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'error';
      default:
        return 'stop';
    }
  }
}

export { GoogleAdapter };
