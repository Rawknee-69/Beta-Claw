import { z } from 'zod';

const INTENT_CATEGORIES = [
  'web_search', 'code_exec', 'file_ops', 'email', 'calendar',
  'memory_read', 'memory_write', 'system_cmd', 'media',
  'communication', 'math', 'general',
] as const;

type IntentCategory = (typeof INTENT_CATEGORIES)[number];

const IntentCategorySchema = z.enum(INTENT_CATEGORIES);
const ClassifyInputSchema = z.string().min(1);

interface IntentResult {
  category: IntentCategory;
  confidence: number;
  tools: string[];
}

const AMBIGUITY_THRESHOLD = 0.6;

const TOOL_MAP: Record<IntentCategory, readonly string[]> = {
  web_search: ['brave_search', 'fetch_url', 'summarize_page'],
  code_exec: ['run_code', 'read_file', 'write_file', 'install_pkg'],
  file_ops: ['read_file', 'write_file', 'list_dir', 'delete_file'],
  email: ['send_email', 'read_email', 'search_email'],
  calendar: ['create_event', 'list_events', 'delete_event'],
  memory_read: ['search_memory', 'read_file'],
  memory_write: ['write_memory', 'write_file'],
  system_cmd: ['run_code', 'install_pkg', 'list_dir'],
  media: ['generate_image', 'fetch_url'],
  communication: ['send_message', 'fetch_url'],
  math: ['run_code'],
  general: ['read_file', 'write_file', 'run_code', 'brave_search', 'fetch_url'],
};

interface KeywordRule {
  readonly pattern: RegExp;
  readonly weight: number;
}

const SCORED_CATEGORIES = INTENT_CATEGORIES.filter(
  (c): c is Exclude<IntentCategory, 'general'> => c !== 'general',
);

const INTENT_RULES: Record<Exclude<IntentCategory, 'general'>, readonly KeywordRule[]> = {
  web_search: [
    { pattern: /\bsearch\b/, weight: 0.35 },
    { pattern: /\bgoogle\b/, weight: 0.6 },
    { pattern: /\blook\s*up\b/, weight: 0.4 },
    { pattern: /\bbrowse\b/, weight: 0.4 },
    { pattern: /\bweb\b/, weight: 0.25 },
    { pattern: /\binternet\b/, weight: 0.3 },
    { pattern: /\bnews\b/, weight: 0.25 },
    { pattern: /\bwebsite\b/, weight: 0.3 },
    { pattern: /\bonline\b/, weight: 0.2 },
  ],
  code_exec: [
    { pattern: /\b(?:python|javascript|typescript|rust|java|ruby|golang|php|perl|swift|kotlin)\b/, weight: 0.35 },
    { pattern: /\bscript\b/, weight: 0.35 },
    { pattern: /\bcode\b/, weight: 0.3 },
    { pattern: /\bprogram\b/, weight: 0.3 },
    { pattern: /\bexecute\b/, weight: 0.35 },
    { pattern: /\bcompile\b/, weight: 0.4 },
    { pattern: /\bdebug\b/, weight: 0.3 },
    { pattern: /\brun\b/, weight: 0.2 },
    { pattern: /\bfunction\b/, weight: 0.2 },
  ],
  file_ops: [
    { pattern: /\bfile\b/, weight: 0.35 },
    { pattern: /\bread\b/, weight: 0.25 },
    { pattern: /\bsave\b/, weight: 0.3 },
    { pattern: /\bdelete\b/, weight: 0.3 },
    { pattern: /\bdirectory\b/, weight: 0.4 },
    { pattern: /\bfolder\b/, weight: 0.4 },
    { pattern: /\brename\b/, weight: 0.35 },
    { pattern: /\bcopy\b/, weight: 0.3 },
    { pattern: /\blist\s+(?:files|dir(?:ector(?:y|ies))?)\b/, weight: 0.5 },
    { pattern: /\b\w+\.[a-z]{2,5}\b/, weight: 0.35 },
  ],
  email: [
    { pattern: /\bemail\b/, weight: 0.6 },
    { pattern: /\bmail\b/, weight: 0.4 },
    { pattern: /\binbox\b/, weight: 0.6 },
    { pattern: /\bsend\b/, weight: 0.1 },
    { pattern: /\breply\b/, weight: 0.25 },
    { pattern: /\bforward\b/, weight: 0.2 },
    { pattern: /\bsubject\b/, weight: 0.2 },
  ],
  calendar: [
    { pattern: /\bcalendar\b/, weight: 0.6 },
    { pattern: /\bevent\b/, weight: 0.35 },
    { pattern: /\bschedule\b/, weight: 0.4 },
    { pattern: /\bmeeting\b/, weight: 0.4 },
    { pattern: /\bappointment\b/, weight: 0.5 },
    { pattern: /\bremind(?:er)?\b/, weight: 0.3 },
  ],
  memory_read: [
    { pattern: /\brecall\b/, weight: 0.5 },
    { pattern: /\bmemory\b/, weight: 0.35 },
    { pattern: /\bwhat\s+did\s+(?:i|we|you)\b/, weight: 0.4 },
    { pattern: /\bprevious(?:ly)?\b/, weight: 0.25 },
    { pattern: /\bhistory\b/, weight: 0.3 },
    { pattern: /\blast\s+(?:time|conversation|session)\b/, weight: 0.4 },
    { pattern: /\bremember\b/, weight: 0.2 },
  ],
  memory_write: [
    { pattern: /\bremember\s+this\b/, weight: 0.6 },
    { pattern: /\bsave\s+this\b/, weight: 0.5 },
    { pattern: /\bstore\b/, weight: 0.35 },
    { pattern: /\bmemorize\b/, weight: 0.6 },
    { pattern: /\bnote\s+(?:this|that|down)\b/, weight: 0.5 },
    { pattern: /\bkeep\s+track\b/, weight: 0.5 },
    { pattern: /\bdon'?t\s+forget\b/, weight: 0.5 },
  ],
  system_cmd: [
    { pattern: /\binstall\b/, weight: 0.35 },
    { pattern: /\bpackage\b/, weight: 0.25 },
    { pattern: /\bsystem\b/, weight: 0.25 },
    { pattern: /\bcommand\b/, weight: 0.3 },
    { pattern: /\bterminal\b/, weight: 0.4 },
    { pattern: /\bshell\b/, weight: 0.4 },
    { pattern: /\bsudo\b/, weight: 0.6 },
    { pattern: /\bapt(?:-get)?\b/, weight: 0.5 },
    { pattern: /\bnpm\b/, weight: 0.35 },
    { pattern: /\bpip\b/, weight: 0.35 },
  ],
  media: [
    { pattern: /\bimage\b/, weight: 0.4 },
    { pattern: /\bpicture\b/, weight: 0.5 },
    { pattern: /\bphoto\b/, weight: 0.5 },
    { pattern: /\bdraw\b/, weight: 0.4 },
    { pattern: /\bgenerate\s+(?:an?\s+)?image\b/, weight: 0.3 },
    { pattern: /\bvideo\b/, weight: 0.4 },
    { pattern: /\baudio\b/, weight: 0.4 },
    { pattern: /\billustrat(?:e|ion)\b/, weight: 0.5 },
    { pattern: /\bdiagram\b/, weight: 0.35 },
  ],
  communication: [
    { pattern: /\bmessage\b/, weight: 0.35 },
    { pattern: /\bsend\s+(?:a\s+)?message\b/, weight: 0.25 },
    { pattern: /\bchat\b/, weight: 0.3 },
    { pattern: /\bnotify\b/, weight: 0.4 },
    { pattern: /\bslack\b/, weight: 0.5 },
    { pattern: /\bdiscord\b/, weight: 0.5 },
    { pattern: /\btext\s+(?:me|him|her|them)\b/, weight: 0.5 },
  ],
  math: [
    { pattern: /\bcalculat(?:e|ion)\b/, weight: 0.6 },
    { pattern: /\bmath\b/, weight: 0.5 },
    { pattern: /\bcomput(?:e|ation)\b/, weight: 0.4 },
    { pattern: /\bequation\b/, weight: 0.4 },
    { pattern: /\bformula\b/, weight: 0.35 },
    { pattern: /\bsolve\b/, weight: 0.35 },
    { pattern: /\b(?:sum|average|multiply|divide|subtract)\b/, weight: 0.3 },
    { pattern: /\bpercentage\b/, weight: 0.35 },
    { pattern: /\d+\s*[+\-*/^]\s*\d+/, weight: 0.3 },
    { pattern: /\balgebra\b/, weight: 0.5 },
  ],
};

function scoreIntent(input: string, rules: readonly KeywordRule[]): number {
  let score = 0;
  for (const { pattern, weight } of rules) {
    if (pattern.test(input)) {
      score += weight;
    }
  }
  return Math.min(score, 1.0);
}

function classifyIntent(input: string): IntentResult {
  const validated = ClassifyInputSchema.parse(input);
  const lower = validated.toLowerCase();

  let bestCategory: IntentCategory = 'general';
  let bestScore = 0;

  for (const category of SCORED_CATEGORIES) {
    const rules = INTENT_RULES[category];
    const score = scoreIntent(lower, rules);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (bestScore < AMBIGUITY_THRESHOLD) {
    return {
      category: 'general',
      confidence: Math.round(bestScore * 100) / 100,
      tools: [...TOOL_MAP.general],
    };
  }

  return {
    category: bestCategory,
    confidence: Math.round(bestScore * 100) / 100,
    tools: [...TOOL_MAP[bestCategory]],
  };
}

function getToolsForIntent(category: IntentCategory): string[] {
  const validated = IntentCategorySchema.parse(category);
  return [...TOOL_MAP[validated]];
}

export {
  classifyIntent,
  getToolsForIntent,
  TOOL_MAP,
  AMBIGUITY_THRESHOLD,
  INTENT_CATEGORIES,
};
export type { IntentCategory, IntentResult };
