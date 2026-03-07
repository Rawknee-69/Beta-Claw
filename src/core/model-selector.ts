import type { ModelCatalogEntry } from '../db.js';
import type { ModelCatalog, ModelTier } from './model-catalog.js';
import type { ComplexityResult } from './complexity-estimator.js';

interface ModelSelection {
  model: ModelCatalogEntry;
  tier: ModelTier;
  score: number;
  reason: string;
}

interface ModelScoringWeights {
  capability: number;
  speed: number;
  costEfficiency: number;
}

const DEFAULT_WEIGHTS: ModelScoringWeights = {
  capability: 0.4,
  speed: 0.3,
  costEfficiency: 0.3,
};

function selectModel(
  catalog: ModelCatalog,
  complexity: ComplexityResult,
  weights: ModelScoringWeights = DEFAULT_WEIGHTS,
): ModelSelection | null {
  const tier = complexity.tier;
  let candidates = catalog.getModelsByTier(tier);

  if (candidates.length === 0) {
    candidates = tryFallbackTier(catalog, tier);
  }

  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates.map((model) => ({
    model,
    score: scoreModel(model, weights),
  }));

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const tiesAtTopScore = scored.filter((s) => Math.abs(s.score - best.score) < 0.001);

  if (tiesAtTopScore.length > 1) {
    tiesAtTopScore.sort(
      (a, b) => (a.model.input_cost_per_1m ?? 0) - (b.model.input_cost_per_1m ?? 0),
    );
  }

  const selected = tiesAtTopScore[0]!;

  return {
    model: selected.model,
    tier,
    score: selected.score,
    reason: `Selected ${selected.model.model_name} for ${tier} tier (complexity ${complexity.score})`,
  };
}

function scoreModel(
  model: ModelCatalogEntry,
  weights: ModelScoringWeights,
): number {
  const capabilities = model.capabilities ? JSON.parse(model.capabilities) as string[] : [];
  const capabilityRank = Math.min(capabilities.length / 7, 1.0);

  const contextWindow = model.context_window ?? 4096;
  const speedRank = contextWindow >= 128000 ? 0.8 : contextWindow >= 32000 ? 0.6 : 0.4;

  const inputCost = model.input_cost_per_1m ?? 0;
  const outputCost = model.output_cost_per_1m ?? 0;
  const avgCost = (inputCost + outputCost) / 2;
  const costEfficiency = avgCost > 0 ? Math.min(1.0 / avgCost, 1.0) : 1.0;

  return (
    weights.capability * capabilityRank +
    weights.speed * speedRank +
    weights.costEfficiency * costEfficiency
  );
}

function tryFallbackTier(catalog: ModelCatalog, tier: ModelTier): ModelCatalogEntry[] {
  const fallbackOrder: Record<ModelTier, ModelTier[]> = {
    nano: ['standard', 'pro', 'max'],
    standard: ['nano', 'pro', 'max'],
    pro: ['standard', 'max', 'nano'],
    max: ['pro', 'standard', 'nano'],
  };

  for (const fallback of fallbackOrder[tier]) {
    const candidates = catalog.getModelsByTier(fallback);
    if (candidates.length > 0) return candidates;
  }

  return [];
}

export { selectModel, scoreModel, DEFAULT_WEIGHTS };
export type { ModelSelection, ModelScoringWeights };
