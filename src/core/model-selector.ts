import type { ModelEntry } from './model-catalog.js';
import { classifyTier, type Tier } from './complexity-estimator.js';

const tierPatterns: Record<Tier, string[]> = {
  nano: [
    'haiku',
    'flash-lite',
    'llama-3.1-8b',
    'gemma',
    'phi-',
    'mini',
  ],
  standard: [
    'sonnet',
    'gemini-2.5-flash',
    'gemini-3-flash',
    'llama-4-maverick',
    'llama-3.3-70b',
    'deepseek-chat',
    'mistral-large',
    'devstral',
    'qwen3-235b',
  ],
  pro: [
    'opus',
    'gemini-2.5-pro',
    'gemini-3.1-pro',
    'deepseek-r1',
    'gpt-5',
    'o3',
  ],
};

/**
 * Select the best available model for the given message.
 * Falls back to next tier down if no model is available.
 */
export function selectModel(
  catalog: ModelEntry[],
  message: string,
): { model: ModelEntry; tier: Tier } | null {
  if (catalog.length === 0) return null;

  const tier = classifyTier(message);

  const tierOrder: Tier[] = tier === 'pro'
    ? ['pro', 'standard', 'nano']
    : tier === 'standard'
      ? ['standard', 'nano', 'pro']
      : ['nano', 'standard', 'pro'];

  for (const t of tierOrder) {
    const patterns = tierPatterns[t];
    const match = catalog.find(m =>
      patterns.some(p => m.id.toLowerCase().includes(p)),
    );
    if (match) return { model: match, tier };
  }

  return { model: catalog[0]!, tier };
}
