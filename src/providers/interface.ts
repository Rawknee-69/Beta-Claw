import { z } from 'zod';

const CompletionMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const CompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(CompletionMessageSchema),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        input_schema: z.record(z.unknown()),
      }),
    )
    .optional(),
  systemPrompt: z.string().optional(),
});

const CompletionResponseSchema = z.object({
  content: z.string(),
  model: z.string(),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    totalTokens: z.number().int(),
    cachedTokens: z.number().int().optional(),
  }),
  finishReason: z.enum(['stop', 'length', 'tool_use', 'error']),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.unknown()),
      }),
    )
    .optional(),
});

const CompletionChunkSchema = z.object({
  content: z.string(),
  done: z.boolean(),
  usage: z
    .object({
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      totalTokens: z.number().int(),
    })
    .optional(),
});

const TokenCostSchema = z.object({
  estimatedInputTokens: z.number().int(),
  estimatedOutputTokens: z.number().int(),
  estimatedCostUSD: z.number(),
});

const ModelEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number().int(),
  inputCostPer1M: z.number(),
  outputCostPer1M: z.number(),
  capabilities: z.array(z.string()),
  deprecated: z.boolean(),
});

const ModelCatalogResponseSchema = z.object({
  models: z.array(ModelEntrySchema),
  fetchedAt: z.number().int(),
  providerID: z.string(),
});

type CompletionMessage = z.infer<typeof CompletionMessageSchema>;
type CompletionRequest = z.infer<typeof CompletionRequestSchema>;
type CompletionResponse = z.infer<typeof CompletionResponseSchema>;
type CompletionChunk = z.infer<typeof CompletionChunkSchema>;
type TokenCost = z.infer<typeof TokenCostSchema>;
type ModelEntry = z.infer<typeof ModelEntrySchema>;
type ModelCatalogResponse = z.infer<typeof ModelCatalogResponseSchema>;

type ProviderFeature =
  | 'streaming'
  | 'function_calling'
  | 'vision'
  | 'prompt_caching'
  | 'json_mode'
  | 'system_message'
  | 'structured_output';

interface IProviderAdapter {
  id: string;
  name: string;
  baseURL: string;

  fetchAvailableModels(): Promise<ModelCatalogResponse>;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  stream(req: CompletionRequest): AsyncIterable<CompletionChunk>;
  estimateCost(req: CompletionRequest): TokenCost;
  supportsFeature(feature: ProviderFeature): boolean;
}

export type {
  IProviderAdapter,
  CompletionMessage,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  TokenCost,
  ModelEntry,
  ModelCatalogResponse,
  ProviderFeature,
};
export {
  CompletionMessageSchema,
  CompletionRequestSchema,
  CompletionResponseSchema,
  CompletionChunkSchema,
  TokenCostSchema,
  ModelEntrySchema,
  ModelCatalogResponseSchema,
};
