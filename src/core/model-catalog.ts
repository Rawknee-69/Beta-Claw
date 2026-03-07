import type { MicroClawDB, ModelCatalogEntry } from '../db.js';
import type { IProviderAdapter, ModelEntry as ProviderModel } from '../providers/interface.js';
import type { ProviderRegistry } from './provider-registry.js';
import pino from 'pino';

export type ModelTier = 'nano' | 'standard' | 'pro' | 'max';

export interface ModelEntry {
  id: string;
  provider_id: string;
  tier: ModelTier;
  contextTokens: number;
  note?: string;
}

export const DEFAULT_CATALOG: ModelEntry[] = [
  // ─── Anthropic ────────────────────────────────────────────────
  { id: 'claude-haiku-4-5-20251001',  provider_id: 'anthropic', tier: 'nano',     contextTokens: 200_000 },
  { id: 'claude-sonnet-4-6',          provider_id: 'anthropic', tier: 'standard', contextTokens: 200_000 },
  { id: 'claude-opus-4-6',            provider_id: 'anthropic', tier: 'pro',      contextTokens: 200_000 },

  // ─── Google Gemini ────────────────────────────────────────────
  { id: 'gemini-2.5-flash-lite',      provider_id: 'google',    tier: 'nano',     contextTokens: 1_000_000 },
  { id: 'gemini-2.5-flash',           provider_id: 'google',    tier: 'standard', contextTokens: 1_000_000 },
  { id: 'gemini-2.5-pro',             provider_id: 'google',    tier: 'pro',      contextTokens: 1_000_000 },
  { id: 'gemini-3.1-pro-preview',     provider_id: 'google',    tier: 'max',      contextTokens: 1_000_000, note: 'preview — flagship' },
  { id: 'gemini-3-flash-preview',     provider_id: 'google',    tier: 'standard', contextTokens: 1_000_000, note: 'preview' },
  { id: 'gemini-3.1-flash-lite-preview', provider_id: 'google', tier: 'nano',    contextTokens: 1_000_000, note: 'preview' },

  // ─── OpenRouter (multi-provider) ─────────────────────────────
  { id: 'meta-llama/llama-3.1-8b-instruct',      provider_id: 'openrouter', tier: 'nano',     contextTokens: 128_000 },
  { id: 'meta-llama/llama-3.2-3b-instruct',      provider_id: 'openrouter', tier: 'nano',     contextTokens: 128_000 },
  { id: 'meta-llama/llama-4-maverick',            provider_id: 'openrouter', tier: 'standard', contextTokens: 128_000 },
  { id: 'meta-llama/llama-4-scout',               provider_id: 'openrouter', tier: 'standard', contextTokens: 128_000 },
  { id: 'meta-llama/llama-3.3-70b-instruct',      provider_id: 'openrouter', tier: 'standard', contextTokens: 128_000 },
  { id: 'deepseek/deepseek-chat-v3-0324',         provider_id: 'openrouter', tier: 'standard', contextTokens: 128_000 },
  { id: 'mistralai/mistral-large-2',              provider_id: 'openrouter', tier: 'standard', contextTokens: 128_000 },
  { id: 'mistralai/devstral-2',                   provider_id: 'openrouter', tier: 'standard', contextTokens: 262_000, note: 'coding agent' },
  { id: 'qwen/qwen3-235b-a22b',                   provider_id: 'openrouter', tier: 'standard', contextTokens: 131_072 },
  { id: 'qwen/qwen3-72b',                         provider_id: 'openrouter', tier: 'pro',      contextTokens: 131_072 },
  { id: 'deepseek/deepseek-r1',                   provider_id: 'openrouter', tier: 'pro',      contextTokens: 128_000, note: 'reasoning/CoT' },
  { id: 'openai/gpt-4o',                          provider_id: 'openrouter', tier: 'pro',      contextTokens: 128_000 },
  { id: 'openai/gpt-4o-mini',                     provider_id: 'openrouter', tier: 'standard', contextTokens: 128_000 },
  { id: 'openai/o3',                              provider_id: 'openrouter', tier: 'max',      contextTokens: 200_000, note: 'extended reasoning' },
  { id: 'openai/gpt-5',                           provider_id: 'openrouter', tier: 'max',      contextTokens: 200_000, note: 'flagship' },

  // ─── OpenAI direct ───────────────────────────────────────────
  { id: 'gpt-4o',                     provider_id: 'openai',    tier: 'pro',      contextTokens: 128_000 },
  { id: 'gpt-4o-mini',                provider_id: 'openai',    tier: 'standard', contextTokens: 128_000 },
  { id: 'gpt-5',                      provider_id: 'openai',    tier: 'max',      contextTokens: 200_000 },
  { id: 'o3',                         provider_id: 'openai',    tier: 'max',      contextTokens: 200_000 },
  { id: 'o3-mini',                    provider_id: 'openai',    tier: 'pro',      contextTokens: 200_000 },

  // ─── Groq ────────────────────────────────────────────────────
  { id: 'llama-3.1-8b-instant',       provider_id: 'groq',      tier: 'nano',     contextTokens: 128_000 },
  { id: 'llama-3.3-70b-versatile',    provider_id: 'groq',      tier: 'standard', contextTokens: 128_000 },
  { id: 'llama-4-maverick-17b-128e-instruct', provider_id: 'groq', tier: 'standard', contextTokens: 128_000 },
  { id: 'llama-4-scout-17b-16e-instruct',     provider_id: 'groq', tier: 'nano',    contextTokens: 128_000 },

  // ─── DeepSeek direct ─────────────────────────────────────────
  { id: 'deepseek-chat',              provider_id: 'deepseek',  tier: 'standard', contextTokens: 64_000 },
  { id: 'deepseek-reasoner',          provider_id: 'deepseek',  tier: 'pro',      contextTokens: 64_000, note: 'R1 reasoning' },

  // ─── Mistral direct ──────────────────────────────────────────
  { id: 'mistral-large-latest',       provider_id: 'mistral',   tier: 'standard', contextTokens: 128_000 },
  { id: 'mistral-small-latest',       provider_id: 'mistral',   tier: 'nano',     contextTokens: 128_000 },
  { id: 'devstral-latest',            provider_id: 'mistral',   tier: 'standard', contextTokens: 262_000 },
];

interface TierThresholds {
  nanoMaxCost: number;
  standardMaxCost: number;
  proMaxCost: number;
  maxMinCost?: number;
}

const DEFAULT_THRESHOLDS: TierThresholds = {
  nanoMaxCost: 0.5,
  standardMaxCost: 5.0,
  proMaxCost: 20.0,
  maxMinCost: 20.0,
};

const CATALOG_TTL_MS = 4 * 60 * 60 * 1000;

class ModelCatalog {
  private readonly db: MicroClawDB;
  private readonly registry: ProviderRegistry;
  private readonly logger: pino.Logger;
  private readonly thresholds: TierThresholds;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    db: MicroClawDB,
    registry: ProviderRegistry,
    logger?: pino.Logger,
    thresholds?: TierThresholds,
  ) {
    this.db = db;
    this.registry = registry;
    this.logger = logger ?? pino({ level: 'silent' });
    this.thresholds = thresholds ?? DEFAULT_THRESHOLDS;
  }

  async refreshAll(): Promise<void> {
    const providers = this.registry.list();
    const results = await Promise.allSettled(
      providers.map((p) => this.refreshProvider(p)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        this.logger.warn(
          { providerId: providers[i]!.id, error: String(result.reason) },
          'Failed to refresh model catalog',
        );
      }
    }
  }

  async refreshProvider(provider: IProviderAdapter): Promise<number> {
    const catalog = await provider.fetchAvailableModels();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + Math.floor(CATALOG_TTL_MS / 1000);

    this.db.clearProviderModels(provider.id);

    let count = 0;
    for (const model of catalog.models) {
      if (model.deprecated) continue;

      const tier = this.assignTier(model);
      this.db.upsertModelCatalogEntry({
        provider_id: provider.id,
        model_id: model.id,
        model_name: model.name,
        context_window: model.contextWindow,
        input_cost_per_1m: model.inputCostPer1M,
        output_cost_per_1m: model.outputCostPer1M,
        capabilities: JSON.stringify(model.capabilities),
        tier,
        fetched_at: now,
        expires_at: expiresAt,
      });
      count++;
    }

    this.logger.info({ providerId: provider.id, modelCount: count }, 'Model catalog refreshed');
    return count;
  }

  getModelsByTier(tier: ModelTier): ModelCatalogEntry[] {
    return this.db.getModelsByTier(tier);
  }

  getModelsByProvider(providerId: string): ModelCatalogEntry[] {
    return this.db.getModelsByProvider(providerId);
  }

  getAllModels(): ModelCatalogEntry[] {
    const providers = this.registry.listIds();
    const all: ModelCatalogEntry[] = [];
    for (const pid of providers) {
      all.push(...this.db.getModelsByProvider(pid));
    }
    return all;
  }

  findModel(modelId: string): ModelCatalogEntry | undefined {
    const all = this.getAllModels();
    return all.find((m) => m.model_id === modelId);
  }

  getBestModelForTier(tier: ModelTier): ModelCatalogEntry | undefined {
    const models = this.getModelsByTier(tier);
    if (models.length === 0) return undefined;

    return models.sort((a, b) => {
      const capA = a.capabilities ? (JSON.parse(a.capabilities) as string[]).length : 0;
      const capB = b.capabilities ? (JSON.parse(b.capabilities) as string[]).length : 0;
      if (capA !== capB) return capB - capA;
      return (a.input_cost_per_1m ?? Infinity) - (b.input_cost_per_1m ?? Infinity);
    })[0];
  }

  startAutoRefresh(): void {
    this.stopAutoRefresh();
    const refresh = (): void => {
      void this.refreshAll().finally(() => {
        if (this.refreshTimer !== null) {
          this.refreshTimer = setTimeout(refresh, CATALOG_TTL_MS);
        }
      });
    };
    this.refreshTimer = setTimeout(refresh, CATALOG_TTL_MS);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private assignTier(model: ProviderModel): ModelTier {
    const avgCost = (model.inputCostPer1M + model.outputCostPer1M) / 2;
    const maxMin = this.thresholds.maxMinCost ?? 20.0;

    // Name-based overrides for well-known flagship models
    const id = model.id.toLowerCase();
    if (id.includes('o3') || id.includes('o4') || id.includes('gpt-5') || id.includes('claude-opus-4')) {
      return 'max';
    }
    if (id.includes('opus') || id.includes('deepseek-r1') || id.includes('o3-mini')) {
      return 'pro';
    }

    if (avgCost > maxMin) return 'max';
    if (avgCost <= this.thresholds.nanoMaxCost) return 'nano';
    if (avgCost <= this.thresholds.standardMaxCost) return 'standard';
    return 'pro';
  }
}

export { ModelCatalog, CATALOG_TTL_MS };
export type { TierThresholds };
