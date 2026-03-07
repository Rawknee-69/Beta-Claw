export type Tier = 'nano' | 'standard' | 'pro' | 'max';

/**
 * Multi-signal complexity estimator.
 *
 * Scoring approach: each signal contributes points to a total score,
 * which is then mapped to a tier. This is far more accurate than the
 * previous first-match keyword approach.
 *
 * Score bands:
 *   0-15  → nano    (simple chat, greetings, yes/no)
 *  16-45  → standard (file ops, web search, code gen, scheduling)
 *  46-80  → pro     (multi-step reasoning, analysis, full implementations)
 *  81+    → max     (full app generation, complex multi-agent tasks)
 */
export function classifyTier(message: string, context?: { recentToolUse?: boolean }): Tier {
  const score = computeScore(message, context);
  if (score >= 81) return 'max';
  if (score >= 46) return 'pro';
  if (score >= 16) return 'standard';
  return 'nano';
}

function computeScore(message: string, context?: { recentToolUse?: boolean }): number {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const len = message.length;
  let score = 0;

  // ─── LENGTH SIGNAL ─────────────────────────────────────────────
  // Raw length is a weak signal — use it gently
  if (len > 800) score += 20;
  else if (len > 400) score += 12;
  else if (len > 200) score += 6;
  else if (len > 80) score += 2;

  // ─── NANO SUPPRESSORS ──────────────────────────────────────────
  // Very short messages with simple vocabulary → strong nano signal
  const nanoKeywords = [
    'hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay',
    'yes', 'no', 'sure', 'great', 'good', 'cool', 'nice',
    'good morning', 'good night', 'good evening',
    'how are you', 'what time', 'what day', 'what\'s up',
    'bye', 'goodbye', 'later', 'see you',
  ];
  if (len < 60 && nanoKeywords.some(k => lower.includes(k))) {
    // Strong nano signal — score cap
    score = Math.min(score, 8);
    return score;
  }

  // ─── PRO/MAX KEYWORDS ──────────────────────────────────────────
  // Tasks that require extended reasoning or multi-step execution
  const maxKeywords = [
    'full app', 'full application', 'complete app', 'entire app',
    'build me a', 'create a complete', 'production-ready',
    'full-stack', 'fullstack', 'entire codebase', 'from scratch',
    'end-to-end', 'e2e', 'full implementation', 'complete implementation',
    'build a website', 'build a web app', 'build a server',
    'design and implement', 'architect', 'microservice',
    'all features', 'everything you can',
  ];
  if (maxKeywords.some(k => lower.includes(k))) score += 40;

  const proKeywords = [
    'analyse', 'analyze', 'analysis', 'architecture',
    'refactor', 'optimize', 'optimise', 'performance',
    'debug', 'diagnose', 'troubleshoot',
    'step by step', 'step-by-step', 'explain in detail',
    'compare', 'pros and cons', 'tradeoffs', 'trade-offs',
    'implement', 'integrate', 'authentication', 'authorization',
    'database', 'schema', 'migration', 'deploy', 'deployment',
    'docker', 'kubernetes', 'ci/cd', 'pipeline',
    'security', 'encryption', 'algorithm',
    'machine learning', 'neural network', 'ai model',
    'comprehensive', 'thorough', 'complete guide',
  ];
  if (proKeywords.some(k => lower.includes(k))) score += 20;

  // ─── TOOL-NEED SIGNAL ──────────────────────────────────────────
  // Messages that require tool use (file ops, execution, search)
  const fileOpsKeywords = [
    'create file', 'write file', 'save file', 'create folder', 'make folder',
    'mkdir', 'create directory', 'write to', 'save to', 'generate file',
    'build a', 'create a', 'make a', 'write a', 'generate a',
  ];
  if (fileOpsKeywords.some(k => lower.includes(k))) score += 15;

  const execKeywords = [
    'run', 'execute', 'install', 'npm', 'pip', 'python', 'node',
    'bash', 'shell', 'command', 'script', 'compile', 'start server',
    'git', 'clone', 'push', 'pull',
  ];
  if (execKeywords.some(k => lower.includes(k))) score += 10;

  const searchKeywords = [
    'search', 'look up', 'look it up', 'find out', 'google',
    'latest', 'current', 'news', 'price', 'weather', 'today',
    'what is', 'who is', 'when did', 'where is',
  ];
  if (searchKeywords.some(k => lower.includes(k))) score += 8;

  const commsKeywords = [
    'send', 'message', 'whatsapp', 'telegram', 'discord',
    'email', 'notify', 'remind',
  ];
  if (commsKeywords.some(k => lower.includes(k))) score += 8;

  const scheduleKeywords = [
    'every', 'schedule', 'cron', 'recurring', 'daily', 'weekly',
    'at 9am', 'every day', 'every hour', 'every minute',
    'remind me', 'set a reminder', 'set an alarm',
  ];
  if (scheduleKeywords.some(k => lower.includes(k))) score += 8;

  // ─── CODE INDICATOR SIGNAL ─────────────────────────────────────
  const codeKeywords = [
    'function', 'class', 'api', 'endpoint', 'route',
    'typescript', 'javascript', 'python', 'rust', 'golang',
    'react', 'vue', 'angular', 'express', 'fastapi',
    'html', 'css', 'sql', 'json', 'yaml', 'config',
  ];
  const backtickCount = (message.match(/`/g) ?? []).length;
  if (backtickCount >= 2) score += 12;
  if (codeKeywords.some(k => lower.includes(k))) score += 10;

  // ─── QUESTION COMPLEXITY SIGNAL ────────────────────────────────
  const questionMarkCount = (message.match(/\?/g) ?? []).length;
  if (questionMarkCount >= 3) score += 8;
  else if (questionMarkCount >= 2) score += 4;

  // Multi-part request indicators
  const multiPartIndicators = [
    'and also', 'and then', 'additionally', 'furthermore', 'moreover',
    'first', 'second', 'third', 'finally', 'lastly',
    'then', 'after that', 'next', 'step 1', 'step 2',
    '1.', '2.', '3.', 'a)', 'b)', 'c)',
  ];
  const multiPartCount = multiPartIndicators.filter(k => lower.includes(k)).length;
  if (multiPartCount >= 3) score += 15;
  else if (multiPartCount >= 2) score += 8;
  else if (multiPartCount >= 1) score += 4;

  // Conditional/logic complexity
  const conditionalKeywords = ['if ', 'unless', 'when ', 'depending on', 'based on', 'assuming'];
  if (conditionalKeywords.some(k => lower.includes(k))) score += 5;

  // ─── WORD COUNT SIGNAL ─────────────────────────────────────────
  if (words.length > 80) score += 15;
  else if (words.length > 40) score += 8;
  else if (words.length > 20) score += 4;

  // ─── CONTEXT SIGNAL ────────────────────────────────────────────
  // If the previous turn involved tool use, maintain at least standard
  if (context?.recentToolUse) score = Math.max(score, 16);

  return score;
}

export interface ComplexityResult {
  score: number;
  tier: Tier;
  webSearchNeeded: boolean;
  toolsNeeded: string[];
}

const TIER_SCORES: Record<Tier, number> = { nano: 10, standard: 30, pro: 60, max: 90 };

export function estimateComplexity(input: string, context?: { recentToolUse?: boolean }): ComplexityResult {
  const score = computeScore(input, context);
  const tier = classifyTier(input, context);
  const lower = input.toLowerCase();

  const toolsNeeded: string[] = [];

  if (['search', 'look up', 'google', 'latest', 'current', 'news', 'price', 'weather', 'find out']
    .some(k => lower.includes(k))) toolsNeeded.push('web_search');

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
  };
}
