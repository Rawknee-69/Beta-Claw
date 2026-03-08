export type Tier = 'nano' | 'standard' | 'pro' | 'max';

/**
 * Weighted complexity estimator — PRD v3.0.
 *
 * Score =
 *   (0.15 × normalize(token_count, 0, 500))
 * + (0.25 × verb_complexity_score)
 * + (0.30 × tool_dependency_depth)
 * + (0.20 × reasoning_keyword_density)
 * + (0.10 × historical_accuracy_needed)
 *
 * Score bands:
 *   0–20  → nano     (greetings, simple Q&A, persona replies)
 *  21–60  → standard (summaries, single-tool tasks, research)
 *  61–85  → pro      (multi-step coding, analysis, multi-tool chains)
 *  86–100 → max      (agent swarms, large codebases, novel reasoning)
 */
export function classifyTier(message: string, context?: { recentToolUse?: boolean }): Tier {
  const score = computeScore(message, context);
  if (score >= 86) return 'max';
  if (score >= 61) return 'pro';
  if (score >= 21) return 'standard';
  return 'nano';
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function computeScore(message: string, context?: { recentToolUse?: boolean }): number {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const tokenEstimate = Math.ceil(message.length / 4);

  // ─── NANO SHORT-CIRCUIT ────────────────────────────────────────
  const nanoKeywords = [
    'hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay',
    'yes', 'no', 'sure', 'great', 'good', 'cool', 'nice',
    'good morning', 'good night', 'good evening',
    'how are you', 'what time', 'what day', "what's up",
    'bye', 'goodbye', 'later', 'see you',
  ];
  if (message.length < 60 && nanoKeywords.some(k => lower.includes(k))) {
    return context?.recentToolUse ? 21 : 8;
  }

  // ─── SIGNAL 1: Token count (weight 0.15) ───────────────────────
  const tokenSignal = normalize(tokenEstimate, 0, 500);

  // ─── SIGNAL 2: Verb complexity (weight 0.25) ───────────────────
  const complexVerbs = [
    'analyse', 'analyze', 'refactor', 'optimize', 'optimise',
    'debug', 'diagnose', 'troubleshoot', 'implement', 'integrate',
    'architect', 'architecture', 'deploy', 'migrate', 'benchmark', 'compile',
    'orchestrate', 'parallelize', 'serialize',
  ];
  const maxVerbs = [
    'design and implement', 'build from scratch', 'create a complete',
    'full-stack', 'fullstack', 'production-ready', 'end-to-end',
  ];
  let verbScore = 0;
  const complexVerbHits = complexVerbs.filter(v => lower.includes(v)).length;
  verbScore += Math.min(complexVerbHits * 0.25, 0.7);
  if (maxVerbs.some(v => lower.includes(v))) verbScore = 1.0;
  verbScore = Math.min(verbScore, 1.0);

  // ─── SIGNAL 3: Tool dependency depth (weight 0.30) ─────────────
  const toolIndicators = [
    { pattern: /\b(?:create|write|save|generate)\s+(?:a\s+)?file/i, depth: 1 },
    { pattern: /\b(?:run|execute|install|npm|pip|bash|shell|git)\b/i, depth: 1 },
    { pattern: /\b(?:search|look\s*up|google|browse)\b/i, depth: 1 },
    { pattern: /\b(?:schedule|cron|recurring|heartbeat|timer)\b/i, depth: 1 },
    { pattern: /\b(?:then|after\s+that|next|and\s+also|and\s+then)\b/i, depth: 0.5 },
    { pattern: /\b(?:first|second|third|step\s+\d)\b/i, depth: 0.5 },
    { pattern: /\b(?:full\s+app|entire|all\s+features|from\s+scratch)\b/i, depth: 2 },
  ];
  let rawToolDepth = 0;
  for (const { pattern, depth } of toolIndicators) {
    if (pattern.test(message)) rawToolDepth += depth;
  }
  const toolDepthSignal = normalize(rawToolDepth, 0, 6);

  // ─── SIGNAL 4: Reasoning keyword density (weight 0.20) ─────────
  const reasoningKeywords = [
    'why', 'because', 'therefore', 'however', 'although',
    'compare', 'pros and cons', 'tradeoffs', 'trade-offs',
    'step by step', 'step-by-step', 'explain in detail',
    'comprehensive', 'thorough', 'complete guide',
    'algorithm', 'security', 'encryption', 'authentication',
    'machine learning', 'neural network', 'performance',
    'if ', 'unless', 'depending on', 'based on',
  ];
  const reasoningHits = reasoningKeywords.filter(k => lower.includes(k)).length;
  const reasoningDensity = words.length > 0
    ? normalize(reasoningHits / words.length, 0, 0.15)
    : normalize(reasoningHits, 0, 3);

  // ─── SIGNAL 5: Historical accuracy needed (weight 0.10) ─────────
  const accuracyKeywords = [
    'exact', 'precise', 'accurate', 'correct', 'verify',
    'validate', 'test', 'proof', 'prove', 'guarantee',
    'critical', 'production', 'important', 'must', 'shall',
    'database', 'schema', 'migration', 'deploy',
  ];
  const accuracyHits = accuracyKeywords.filter(k => lower.includes(k)).length;
  const accuracySignal = normalize(accuracyHits, 0, 4);

  // ─── WEIGHTED SUM ──────────────────────────────────────────────
  let score = Math.round(
    (0.15 * tokenSignal +
     0.25 * verbScore +
     0.30 * toolDepthSignal +
     0.20 * reasoningDensity +
     0.10 * accuracySignal) * 100,
  );

  // ─── CODE INDICATORS (bonus) ───────────────────────────────────
  const backtickCount = (message.match(/`/g) ?? []).length;
  if (backtickCount >= 6) score += 15;
  else if (backtickCount >= 2) score += 8;

  const multiPartIndicators = ['1.', '2.', '3.', 'a)', 'b)', 'c)'];
  const multiPartCount = multiPartIndicators.filter(k => lower.includes(k)).length;
  if (multiPartCount >= 3) score += 10;
  else if (multiPartCount >= 2) score += 5;

  // Context: prior tool use → at least standard
  if (context?.recentToolUse) score = Math.max(score, 21);

  return Math.min(score, 100);
}

export interface ComplexityBreakdown {
  tokenFactor: number;
  verbComplexity: number;
  toolDependency: number;
  reasoningDensity: number;
  accuracyNeeded: number;
}

export interface ComplexityResult {
  score: number;
  tier: Tier;
  webSearchNeeded: boolean;
  toolsNeeded: string[];
  breakdown: ComplexityBreakdown;
}

const TIER_SCORES: Record<Tier, number> = { nano: 10, standard: 40, pro: 73, max: 93 };

function computeBreakdown(message: string): ComplexityBreakdown {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const tokenEstimate = Math.ceil(message.length / 4);

  const tokenFactor = normalize(tokenEstimate, 0, 500);

  const complexVerbs = [
    'analyse', 'analyze', 'refactor', 'optimize', 'optimise',
    'debug', 'diagnose', 'troubleshoot', 'implement', 'integrate',
    'architect', 'architecture', 'deploy', 'migrate', 'benchmark', 'compile',
    'orchestrate', 'parallelize', 'serialize',
  ];
  const maxVerbs = [
    'design and implement', 'build from scratch', 'create a complete',
    'full-stack', 'fullstack', 'production-ready', 'end-to-end',
  ];
  let verbComplexity = 0;
  const complexVerbHits = complexVerbs.filter(v => lower.includes(v)).length;
  verbComplexity += Math.min(complexVerbHits * 0.25, 0.7);
  if (maxVerbs.some(v => lower.includes(v))) verbComplexity = 1.0;
  verbComplexity = Math.min(verbComplexity, 1.0);

  const toolIndicators = [
    { pattern: /\b(?:create|write|save|generate)\s+(?:a\s+)?file/i, depth: 1 },
    { pattern: /\b(?:run|execute|install|npm|pip|bash|shell|git)\b/i, depth: 1 },
    { pattern: /\b(?:search|look\s*up|google|browse)\b/i, depth: 1 },
    { pattern: /\b(?:schedule|cron|recurring|heartbeat|timer)\b/i, depth: 1 },
    { pattern: /\b(?:then|after\s+that|next|and\s+also|and\s+then)\b/i, depth: 0.5 },
    { pattern: /\b(?:first|second|third|step\s+\d)\b/i, depth: 0.5 },
    { pattern: /\b(?:full\s+app|entire|all\s+features|from\s+scratch)\b/i, depth: 2 },
  ];
  let rawToolDepth = 0;
  for (const { pattern, depth } of toolIndicators) {
    if (pattern.test(message)) rawToolDepth += depth;
  }
  const toolDependency = normalize(rawToolDepth, 0, 6);

  const reasoningKeywords = [
    'why', 'because', 'therefore', 'however', 'although',
    'compare', 'pros and cons', 'tradeoffs', 'trade-offs',
    'step by step', 'step-by-step', 'explain in detail',
    'comprehensive', 'thorough', 'complete guide',
    'algorithm', 'security', 'encryption', 'authentication',
    'machine learning', 'neural network', 'performance',
    'if ', 'unless', 'depending on', 'based on',
  ];
  const reasoningHits = reasoningKeywords.filter(k => lower.includes(k)).length;
  const reasoningDensity = words.length > 0
    ? normalize(reasoningHits / words.length, 0, 0.15)
    : normalize(reasoningHits, 0, 3);

  const accuracyKeywords = [
    'exact', 'precise', 'accurate', 'correct', 'verify',
    'validate', 'test', 'proof', 'prove', 'guarantee',
    'critical', 'production', 'important', 'must', 'shall',
    'database', 'schema', 'migration', 'deploy',
  ];
  const accuracyHits = accuracyKeywords.filter(k => lower.includes(k)).length;
  const accuracyNeeded = normalize(accuracyHits, 0, 4);

  return { tokenFactor, verbComplexity, toolDependency, reasoningDensity, accuracyNeeded };
}

export function estimateComplexity(input: string, context?: { recentToolUse?: boolean }): ComplexityResult {
  const score = computeScore(input, context);
  const tier = classifyTier(input, context);
  const lower = input.toLowerCase();
  const breakdown = computeBreakdown(input);

  const toolsNeeded: string[] = [];

  if ([
    'search', 'look up', 'google', 'latest', 'current', 'news', 'price', 'weather', 'find out',
    'today', 'right now', 'recent', 'recently', 'statistics', 'what happened', 'is there a',
    'war', 'conflict', 'election', 'stock', 'market', 'rate', 'score', 'result', 'release',
    'update on', 'status of', 'how is', 'what is the', 'who won', 'when did',
  ].some(k => lower.includes(k))) toolsNeeded.push('web_search');

  if (['create file', 'write file', 'save', 'generate', 'build a', 'create a', 'make a', 'write a']
    .some(k => lower.includes(k))) toolsNeeded.push('write_file');

  if (['run', 'execute', 'install', 'npm', 'pip', 'bash', 'shell', 'command', 'mkdir', 'git']
    .some(k => lower.includes(k))) toolsNeeded.push('run_cmd');

  if (['whatsapp', 'telegram', 'discord', 'message me', 'send me', 'notify me']
    .some(k => lower.includes(k))) toolsNeeded.push('send_whatsapp');

  if (['every', 'schedule', 'cron', 'recurring', 'remind me', 'daily', 'weekly']
    .some(k => lower.includes(k))) toolsNeeded.push('cron_add');

  const webSearchNeeded = toolsNeeded.includes('web_search');

  return {
    score: Math.max(score, TIER_SCORES[tier]),
    tier,
    webSearchNeeded,
    toolsNeeded,
    breakdown,
  };
}

/**
 * Lightweight check: should we nudge the model to consider web_search?
 * Returns a hint string to inject into the system prompt, or empty string.
 */
export function suggestWebSearch(message: string, lastAssistantMessage?: string): string {
  const result = estimateComplexity(message);
  if (result.webSearchNeeded) {
    return 'Consider using web_search for up-to-date information on this.';
  }

  // Topic-shift detection: if the new message introduces entities not in the prior reply
  if (lastAssistantMessage) {
    const prevWords = new Set(lastAssistantMessage.toLowerCase().split(/\W+/).filter(w => w.length > 4));
    const newWords = message.toLowerCase().split(/\W+/).filter(w => w.length > 4);
    const overlap = newWords.filter(w => prevWords.has(w)).length;
    const overlapRatio = newWords.length > 0 ? overlap / newWords.length : 1;
    // Low overlap AND message has a factual-question shape → topic shift
    if (overlapRatio < 0.2 && /\b(what|who|when|where|how|why|is|are|was|were|did|does)\b/i.test(message)) {
      return 'Consider using web_search — this looks like a new topic that may need current information.';
    }
  }

  return '';
}
