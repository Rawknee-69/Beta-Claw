// src/core/complexity-estimator.ts

export type Tier = 'nano' | 'standard' | 'pro' | 'max';

export interface ComplexityResult {
  score:   number;
  tier:    Tier;
  source:  'explicit_override' | 'context_floor' | 'estimator';
  floor:   Tier;
  signals: SignalHit[];
}

export interface SignalHit {
  group:        string;
  matches:      string[];
  contribution: number;
}

export interface HistoryMessage {
  role:    'user' | 'assistant' | 'system';
  content: string;
}

interface SignalGroup {
  id:       string;
  patterns: RegExp[];
  perMatch: number;
  cap:      number;
  tier:     'nano' | 'standard' | 'pro' | 'max' | 'structural';
}

const TIER_RANK: Record<Tier, number> = { nano: 0, standard: 1, pro: 2, max: 3 };

function higherTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

const TIER_THRESHOLDS: [Tier, number][] = [
  ['max',      81],
  ['pro',      51],
  ['standard', 16],
  ['nano',      0],
];

function scoreToTier(score: number): Tier {
  return TIER_THRESHOLDS.find(([, t]) => score >= t)?.[0] ?? 'nano';
}

const GLOBAL_PRO_CAP = 60;

// Layer A — explicit tier override
const EXPLICIT: [Tier, RegExp][] = [
  ['max',      /\b(use|switch to|go with|give me|try)\s+(max|gemini[- ]3|the\s+(biggest|best|most\s+powerful)\s+model)\b/i],
  ['pro',      /\b(use|switch to|go with|try)\s+(pro|gemini[- ]2\.5[- ]pro|claude[- ]opus|the\s+pro\s+models?)\b/i],
  ['standard', /\b(use|switch to)\s+(standard|flash|sonnet|mid|middle|a\s+regular)\b/i],
  ['nano',     /\b(use|switch to)\s+(nano|lite|haiku|flash[- ]lite|cheapest|smallest|the\s+fast\s+one)\b/i],
];

// Layer B — continuation detection
const CONTINUATION_RE = /^(yes|no|ok(ay)?|sure|yep|nah|go|do it|go for it|go ahead|try again|try it|just do it|proceed|continue|keep going|carry on|let('?s| us)?\s+go|sounds good|perfect|great|cool|nice|alright|roger|got it|makes sense|understood|agreed|fine|do that|run it|send it|make it|build it|do this|do that|fix it|now do it|make it happen|get it done|yes please|yes do it|do the (same|rest)|finish (it|this)|what about now|and now|now what|what else|anything else|more|next|after that|then what|move on|skip|continue from|pick up where)[\s!?.]*$/i;

// Context floor patterns — scan recent history
const CONTEXT_MAX_RE = [
  /\b(entire\s+(codebase|repo|system)|all\s+(files|services)|multi[\s-]?agent|refactor\s+everything)\b/i,
];
const CONTEXT_PRO_RE = [
  /\b(build|create|make|write)\b.{0,80}\b(website|app|api|system|platform|component)\b/i,
  /\b(debug|fix|refactor|migrate|deploy|review|optimize|audit)\b/i,
  /\b(authentication|docker|kubernetes|database|security|pipeline)\b/i,
  /```[\s\S]{10,}/,
];
const CONTEXT_STANDARD_RE = [
  /\b(search|find|summarize|list|compare|explain|translate)\b/i,
  /\b(csv|json|yaml|sql|html|css|script)\b/i,
];

export function inferContextFloor(history: HistoryMessage[], windowSize = 3): Tier {
  // Only scan user messages — assistant replies and tool results contain code/filenames
  // that would falsely inflate the floor tier.
  const userMessages = history.filter(m => m.role === 'user');
  const recent = userMessages.slice(-windowSize);
  const text   = recent.map(m => m.content).join('\n');
  for (const p of CONTEXT_MAX_RE)      if (p.test(text)) return 'max';
  for (const p of CONTEXT_PRO_RE)      if (p.test(text)) return 'pro';
  for (const p of CONTEXT_STANDARD_RE) if (p.test(text)) return 'standard';
  return 'nano';
}

const SIGNAL_GROUPS: SignalGroup[] = [
  {
    id: 'nano-trivial',
    patterns: [
      /\b(hi|hey|hello|howdy|yo)\b/i,
      /\b(thanks|thank you|thx|ty)\b/i,
      /\b(ok|okay|sure|yep|nope|yup|nah|lol|lmao|haha)\b/i,
      /\b(good morning|good night|good evening|gm|gn)\b/i,
    ],
    perMatch: -3, cap: -10, tier: 'nano',
  },
  {
    id: 'nano-simple-q',
    patterns: [
      /\b(what is|what's|who is|who's|where is|when (is|did|was|were))\b/i,
      /\b(tell me a joke|how are you|what's up|what do you think)\b/i,
    ],
    perMatch: -4, cap: -8, tier: 'nano',
  },
  {
    id: 'standard-action',
    patterns: [
      /\b(build|create|make|generate|design|scaffold)\b/i,
      /\b(write|draft|compose)\b/i,
      /\b(search|find|look\s*up|fetch|retrieve)\b/i,
      /\b(summarize|explain|describe|document)\b/i,
      /\b(list|enumerate|show me)\b/i,
      /\b(install|configure|setup|bootstrap|initialise|initialize)\b/i,
      /\b(convert|transform|parse|format|encode|decode)\b/i,
      /\b(read|load|extract|import)\b/i,
      /\b(update|edit|modify|change|delete|remove)\b/i,
      /\b(add|append|insert|commit|push|pull)\b/i,
      /\b(run|execute|start|stop|restart|test|check|try)\b/i,
      /\b(send|post|get|put|patch|call|invoke)\b/i,
      /\b(code|implement|program)\b/i,
      /\b(deploy|release|publish|ship)\b/i,
      /\b(download|upload|sync|backup)\b/i,
      /\b(open|close|toggle|enable|disable)\b/i,
    ],
    perMatch: 12, cap: 30, tier: 'standard',
  },
  {
    id: 'standard-tech',
    patterns: [
      /\b(script|function|class|component|module|endpoint|route|schema|model)\b/i,
      /\b(website|app|application|ui|dashboard|frontend|backend)\b/i,
      /\b(api|rest|graphql|webhook|socket|http|grpc)\b/i,
      /\b(csv|json|xml|yaml|toml|sql|database|db|sqlite|postgres|mysql|mongo)\b/i,
      /\b(docker|container|image|compose|pod|k8s|kubernetes)\b/i,
      /\b(git|commit|branch|merge|rebase|pull\s+request|pr)\b/i,
      /\b(css|html|div|span|flex|grid|layout|style|tailwind)\b/i,
      /\b(array|object|string|number|boolean|type|interface|enum|generic)\b/i,
      /\b(npm|yarn|pnpm|pip|cargo|go\s+get)\b/i,
      /\b(env|dotenv|config|settings|variable)\b/i,
    ],
    perMatch: 10, cap: 25, tier: 'standard',
  },
  {
    id: 'pro-intent',
    patterns: [
      /\b(find|locate|spot|identify|pinpoint)\s+(?:the\s+|an?\s+|this\s+)?(error|bug|issue|problem|crash|failure|cause)\b/i,
      /\bwhy\s+(is\s+it|does\s+it|won'?t\s+it|doesn'?t\s+it|is\s+this|are\s+they|is\s+[a-z])\b/i,
      /\bwhat\s*('s|is)\s+(wrong|broken|failing|crashing|causing)\b/i,
      /\b(where|how)\s+(?:is\s+it|does\s+it|did\s+it).{0,20}(fail|crash|break|error)\b/i,
      /\b(can'?t|cannot|unable\s+to|fails?\s+to)\s+\w+/i,
    ],
    perMatch: 45, cap: 45, tier: 'pro',
  },
  {
    id: 'pro-debug',
    patterns: [
      /\b(debug|fix|repair|resolve|troubleshoot|diagnose)\b/i,
      /\b(error|bug|issue|problem|failure|crash|broken|failing|breaks)\b/i,
      /\b(exception|stack\s*trace|traceback|panic)\b/i,
      /\b(not working|doesn'?t work|fails\s+to|won'?t work)\b/i,
      /\b[45]\d\d\b/,
      /\b(ECONNREFUSED|ENOENT|ETIMEDOUT|EACCES|EPERM|EADDRINUSE|MODULE_NOT_FOUND)\b/,
      /exit\s*code\s*[1-9]/i,
      /\b(undefined|null|NaN|TypeError|SyntaxError|ReferenceError|NameError|AttributeError)\b/i,
    ],
    perMatch: 18, cap: 38, tier: 'pro',
  },
  {
    id: 'pro-security',
    patterns: [
      /\b(auth(entication|orization)?|oauth|jwt|token|session|cookie)\b/i,
      /\b(security|permission|access\s*control|acl|rbac|cors|csrf|xss)\b/i,
      /\b(encrypt|decrypt|hash|salt|cipher|tls|ssl|cert(ificate)?)\b/i,
      /\b(login|sign[\s-]?(in|up)|password|credential|secret|api[\s-]?key)\b/i,
    ],
    perMatch: 18, cap: 38, tier: 'pro',
  },
  {
    id: 'pro-architecture',
    patterns: [
      /\b(architect(ure)?|design\s*pattern|microservice|event[\s-]driven|domain[\s-]driven)\b/i,
      /\b(refactor|restructure|decouple|abstract|modular(ise|ize)?)\b/i,
      /\b(optimi[sz]e|performance|latency|throughput|memory\s*leak|bottleneck|profil(e|ing))\b/i,
      /\b(review|audit|assess|evaluate|analy[sz]e)\b/i,
      /\b(migrate|migration|upgrade|rollout|rollback)\b/i,
      /\b(ci[\s/]?cd|pipeline|workflow|action|github\s+actions)\b/i,
      /\bproduction\b/i,
    ],
    perMatch: 16, cap: 35, tier: 'pro',
  },
  {
    id: 'max-scope',
    patterns: [
      /\b(entire\s+(codebase|project|repo(sitory)?|system|application))\b/i,
      /\ball\s+(files|endpoints|services|modules|components|tests)\b/i,
      /\b(multi[\s-]?agent|agent\s+swarm|orchestrat(e|or|ion))\b/i,
      /\b(large[\s-]?scale|enterprise[\s-]?grade|production[\s-]?ready)\b/i,
      /\b(refactor\s+everything|rewrite\s+everything|redesign\s+the\s+whole)\b/i,
    ],
    perMatch: 65, cap: 75, tier: 'max',
  },
  {
    id: 'structural-code',
    patterns: [
      /\b\w+\.(py|ts|js|tsx|jsx|sh|bash|rs|go|rb|java|kt|sql|md)\b/i,
      /```/,
      /`[^`]{3,}`/,
      /\w+\.\w+\(/,
    ],
    perMatch: 10, cap: 20, tier: 'structural',
  },
  {
    id: 'structural-compound',
    patterns: [
      /\b(and\s+then|additionally|and\s+also|as\s+well\s+as)\b/i,
      /\b(first[,.]?\s.{3,}(second|then)|step\s+[1-9])\b/i,
      /;\s*\w/,
    ],
    perMatch: 8, cap: 16, tier: 'structural',
  },
];

function wordCountContrib(n: number): number {
  if (n <= 3)  return -5;
  if (n <= 6)  return  0;
  if (n <= 15) return  5;
  if (n <= 30) return 10;
  if (n <= 60) return 15;
  return 20;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function _estimateFromText(message: string): { score: number; tier: Tier; signals: SignalHit[] } {
  const text      = message.toLowerCase();
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const hits:     SignalHit[] = [];

  let nanoC = 0, standardC = 0, proC = 0, maxC = 0, structuralC = 0;

  for (const group of SIGNAL_GROUPS) {
    const matched: string[] = [];
    for (const pattern of group.patterns) {
      const found = text.match(new RegExp(pattern.source, 'gi'));
      if (found) matched.push(...found);
    }
    if (matched.length === 0) continue;

    let raw = 0;
    for (let i = 0; i < matched.length; i++) {
      raw += group.perMatch * (i === 0 ? 1.0 : 0.6);
    }

    const contribution = group.cap < 0
      ? clamp(raw, group.cap, 0)
      : clamp(raw, 0, group.cap);

    switch (group.tier) {
      case 'nano':       nanoC       += contribution; break;
      case 'standard':   standardC   += contribution; break;
      case 'pro':        proC        += contribution; break;
      case 'max':        maxC        += contribution; break;
      case 'structural': structuralC += contribution; break;
    }

    hits.push({ group: group.id, matches: [...new Set(matched)], contribution });
  }

  proC = clamp(proC, 0, GLOBAL_PRO_CAP);

  if (proC > 0) {
    nanoC     = 0;
    standardC *= 0.3;
  }

  const lengthContrib = wordCountContrib(wordCount);
  structuralC += lengthContrib;
  hits.push({
    group: 'structural-length',
    matches: [`${wordCount} words`],
    contribution: lengthContrib,
  });

  let raw = nanoC + standardC + proC + maxC + structuralC;
  if (standardC > 0 && raw < 16) raw = 16;

  const score = clamp(Math.round(raw), 0, 100);
  return { score, tier: scoreToTier(score), signals: hits.filter(h => h.contribution !== 0) };
}

export function estimateComplexity(
  message:  string,
  history:  HistoryMessage[] = [],
): ComplexityResult {
  const msg   = message.trim();
  const lower = msg.toLowerCase();

  // Layer A: explicit override
  for (const [tier, re] of EXPLICIT) {
    if (re.test(msg)) {
      return {
        score:   TIER_RANK[tier] * 25 + 10,
        tier,
        source:  'explicit_override',
        floor:   tier,
        signals: [{ group: 'explicit_override', matches: [msg.slice(0, 60)], contribution: 0 }],
      };
    }
  }

  // Layer B: context floor
  const floor     = inferContextFloor(history);
  const wordCount = msg.split(/\s+/).filter(Boolean).length;

  if (wordCount <= 8 && CONTINUATION_RE.test(lower) && floor !== 'nano') {
    return {
      score:   TIER_RANK[floor] * 25 + 10,
      tier:    floor,
      source:  'context_floor',
      floor,
      signals: [{ group: 'continuation', matches: [msg], contribution: 0 }],
    };
  }

  // Layer C: signal accumulator
  const { score: rawScore, tier: estimated, signals } = _estimateFromText(msg);
  const winner = higherTier(floor, estimated);
  const finalScore = winner !== estimated
    ? clamp(TIER_RANK[winner] * 25 + 10, 0, 100)
    : rawScore;

  return {
    score:   finalScore,
    tier:    winner,
    source:  winner === floor && TIER_RANK[floor] > TIER_RANK[estimated]
               ? 'context_floor'
               : 'estimator',
    floor,
    signals,
  };
}

export function classifyTier(
  message: string,
  context?: { recentToolUse?: boolean; history?: HistoryMessage[] },
): Tier {
  const result = estimateComplexity(message, context?.history ?? []);
  if (context?.recentToolUse && result.tier === 'nano') return 'standard';
  return result.tier;
}

const WEB_TRIGGERS = [
  /\b(latest|newest|recent|current|today|now|2025|2026)\b/i,
  /\b(news|price|stock|weather|score|standings|release)\b/i,
  /\b(what happened|who won|is .+ still|has .+ been|did .+ (happen|win|lose|release))\b/i,
];

export function suggestWebSearch(message: string, _lastAssistant?: string): string | null {
  return WEB_TRIGGERS.some(r => r.test(message)) ? 'web_search' : null;
}

export function explainComplexity(message: string, history: HistoryMessage[] = []): string {
  const { score, tier, source, floor, signals } = estimateComplexity(message, history);
  return [
    `Score: ${score}/100  →  ${tier.toUpperCase()}  (source: ${source}, floor: ${floor})`,
    `Input: "${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`,
    `History: ${history.length} message(s)`,
    'Signals:',
    ...signals.map(s => {
      const sign = s.contribution >= 0 ? '+' : '';
      return `  ${(sign + Math.round(s.contribution)).padStart(4)}  [${s.group}]  → ${s.matches.slice(0, 4).join(', ')}`;
    }),
  ].join('\n');
}
