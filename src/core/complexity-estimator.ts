export type Tier = 'nano' | 'standard' | 'pro';

/**
 * Classify a message into a model tier.
 *
 * nano:     simple chat, questions, greetings (<60 chars, no code, no files)
 * standard: file ops, web search, code gen, scheduling (default)
 * pro:      multi-step reasoning, analysis, complex code, >500 chars
 */
export function classifyTier(message: string): Tier {
  const len = message.length;
  const lower = message.toLowerCase();

  const proKeywords = [
    'analyse', 'analyze', 'architecture', 'refactor', 'debug complex',
    'write a full', 'complete implementation', 'step by step explain', 'compare',
  ];
  if (len > 500 || proKeywords.some(k => lower.includes(k))) return 'pro';

  const nanoKeywords = [
    'hi', 'hello', 'hey', 'thanks', 'ok', 'yes', 'no', 'good morning',
    'good night', 'how are you', 'what time', 'what day',
  ];
  if (len < 80 && nanoKeywords.some(k => lower.includes(k))) return 'nano';

  return 'standard';
}

/** Backward-compatible wrapper around classifyTier */
export interface ComplexityResult {
  score: number;
  tier: Tier;
  webSearchNeeded: boolean;
}

const TIER_SCORES: Record<Tier, number> = { nano: 10, standard: 40, pro: 80 };

export function estimateComplexity(input: string): ComplexityResult {
  const tier = classifyTier(input);
  const lower = input.toLowerCase();
  const webSearchNeeded = ['search', 'google', 'look up', 'latest', 'current', 'news', 'price', 'weather']
    .some(k => lower.includes(k));
  return { score: TIER_SCORES[tier], tier, webSearchNeeded };
}
