import type { ModelEntry } from './model-catalog.js';
import { classifyTier, type HistoryMessage, type Tier } from './complexity-estimator.js';

/**
 * Model ID patterns for each tier.
 * The selector tries each tier's patterns in order of preference,
 * falling back to adjacent tiers if no match is found.
 */
const tierPatterns: Record<Tier, string[]> = {
  nano: [
    'haiku', 'flash-lite', 'llama-3.1-8b', 'gemma', 'phi-', 'mini',
  ],
  standard: [
    'sonnet', 'gemini-2.5-flash', 'gemini-3-flash', 'llama-4-maverick',
    'llama-3.3-70b', 'deepseek-chat', 'mistral-large', 'devstral', 'qwen3-235b',
  ],
  pro: [
    'opus', 'gemini-2.5-pro', 'deepseek-r1', 'mistral-medium',
  ],
  max: [
    'gemini-3.1-pro', 'gpt-5', 'o3', 'o4',
  ],
};

/**
 * Fallback order for each tier when no model is found.
 * We always have at least one tier to fall back to.
 */
const tierFallbackOrder: Record<Tier, Tier[]> = {
  nano:     ['nano', 'standard', 'pro', 'max'],
  standard: ['standard', 'nano', 'pro', 'max'],
  pro:      ['pro', 'standard', 'max', 'nano'],
  max:      ['max', 'pro', 'standard', 'nano'],
};

/**
 * Select the best available model for the given message.
 *
 * 1. Classify the message into a tier (nano/standard/pro/max)
 * 2. Try to find a model matching the tier's patterns in the catalog
 * 3. Fall back through adjacent tiers if no match
 * 4. Return the first model in the catalog as a last resort
 */
export function selectModel(
  catalog: ModelEntry[],
  message: string,
  context?: { recentToolUse?: boolean; history?: HistoryMessage[] },
): { model: ModelEntry; tier: Tier } | null {
  if (catalog.length === 0) return null;

  const tier = classifyTier(message, context);
  const fallbackOrder = tierFallbackOrder[tier];

  for (const t of fallbackOrder) {
    const patterns = tierPatterns[t];
    const match = catalog.find(m =>
      patterns.some(p => m.id.toLowerCase().includes(p)),
    );
    if (match) return { model: match, tier };
  }

  return { model: catalog[0]!, tier };
}
