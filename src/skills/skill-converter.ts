import path from 'node:path';

export interface ConvertResult {
  converted: boolean;
  content:   string;
  meta:      SkillMeta;
}

export interface SkillMeta {
  name:         string;
  command:      string;
  description:  string;
  emoji:        string;
  allowedTools: string[];
  requires:     { bins?: string[]; env?: string[] };
  version:      string;
  source:       'native' | 'openclaw' | 'clawbot';
}

const OC_TOOL_MAP: Record<string, string> = {
  'read_file':          'read',
  'write_file':         'write',
  'list_files':         'list',
  'bash':               'exec',
  'shell':              'exec',
  'computer_tool':      'exec',
  'browser_navigate':   'exec (via Playwright — see browser skill)',
  'browser_click':      'exec (via Playwright — see browser skill)',
  'browser_type':       'exec (via Playwright — see browser skill)',
  'browser_screenshot': 'exec (via Playwright — see browser skill)',
  'memory_search':      'exec: grep -i "QUERY" groups/GROUP_ID/MEMORY.md',
  'llm_task':           'exec (spawn sub-agent via microclaw chat --one-shot)',
  'agent_send':         'exec: microclaw chat --group TARGET --one-shot "MESSAGE"',
};

const OC_ONLY_FIELDS = [
  'homepage', 'user-invocable', 'disable-model-invocation',
  'command-dispatch', 'command-tool', 'command-arg-mode',
];

export async function convertSkill(raw: string, filePath: string): Promise<ConvertResult> {
  const meta = parseFrontmatter(raw, filePath);
  const isOpenClaw = detectOpenClawFormat(raw);

  if (!isOpenClaw) {
    return { converted: false, content: raw, meta };
  }

  meta.source = 'openclaw';
  const body = extractBody(raw);
  const convertedBody = rewriteBody(body);
  const newFrontmatter = buildMicroClawFrontmatter(meta);
  const banner = buildConversionBanner(filePath);
  const content = `${newFrontmatter}\n\n${banner}\n\n${convertedBody}`;

  return { converted: true, content, meta };
}

function detectOpenClawFormat(raw: string): boolean {
  if (raw.includes('"openclaw"') || raw.includes("'openclaw'")) return true;
  for (const tool of Object.keys(OC_TOOL_MAP)) {
    if (raw.includes(`\`${tool}\``) || raw.includes(`tool: ${tool}`) || raw.includes(`"${tool}"`)) return true;
  }
  for (const f of OC_ONLY_FIELDS) {
    if (raw.includes(`${f}:`)) return true;
  }
  return false;
}

function rewriteBody(body: string): string {
  let out = body;

  for (const [oc, mc] of Object.entries(OC_TOOL_MAP)) {
    out = out.replace(new RegExp(`\\b${oc}\\b`, 'g'), mc);
  }

  out = out.replace(/~\/\.openclaw\/workspace/g, 'groups/{groupId}');
  out = out.replace(/~\/\.openclaw\/skills/g, 'skills/');
  out = out.replace(/openclaw\s+hooks/g, 'microclaw hooks');
  out = out.replace(/openclaw\s+skills/g, 'microclaw skills');
  out = out.replace(/openclaw\s+sandbox/g, 'microclaw sandbox');
  out = out.replace(/openclaw\s+webhooks/g, 'microclaw webhooks');
  out = out.replace(/OPENCLAW_/g, 'MICROCLAW_');
  out = out.replace(/~\/\.openclaw/g, '.micro');

  return out;
}

function buildConversionBanner(filePath: string): string {
  return [
    '> **Auto-converted from OpenClaw format** by MicroClaw skill-watcher.',
    `> Original: \`${filePath}\``,
    '> Tool names, paths, and env vars have been rewritten for MicroClaw.',
    '> Review before use. If anything looks wrong, edit the sidecar file directly.',
  ].join('\n');
}

function buildMicroClawFrontmatter(meta: SkillMeta): string {
  return [
    '---',
    `name: ${meta.name}`,
    `command: ${meta.command || `/${meta.name}`}`,
    `description: ${meta.description}`,
    `allowed-tools: ${JSON.stringify(meta.allowedTools.length ? meta.allowedTools : ['exec', 'read', 'write'])}`,
    meta.requires.bins?.length ? `requires-bins: ${JSON.stringify(meta.requires.bins)}` : '',
    meta.requires.env?.length  ? `requires-env: ${JSON.stringify(meta.requires.env)}`   : '',
    `version: ${meta.version || '1.0.0'}`,
    `source: ${meta.source}`,
    '---',
  ].filter(Boolean).join('\n');
}

function parseFrontmatter(raw: string, filePath: string): SkillMeta {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = match?.[1] ?? '';
  const get = (k: string) => fm.split('\n').find(l => l.startsWith(`${k}:`))?.split(':').slice(1).join(':').trim() ?? '';

  const binsMatch = raw.match(/"bins":\s*\[([^\]]*)\]/);
  const envMatch  = raw.match(/"env":\s*\[([^\]]*)\]/);
  const bins = binsMatch ? binsMatch[1]!.split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) : [];
  const envs = envMatch  ? envMatch[1]!.split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) : [];

  const emoji   = raw.match(/"emoji":\s*"([^"]+)"/)?.[1] ?? '🔧';
  const name    = get('name') || path.basename(path.dirname(filePath));
  const cmd     = get('command') || `/${name}`;
  const desc    = get('description').replace(/^"|"$/g, '') || name;
  const version = get('version') || '1.0.0';

  const toolsRaw = get('allowed-tools');
  let allowedTools: string[];
  try {
    allowedTools = toolsRaw ? JSON.parse(toolsRaw) as string[] : inferTools(raw);
  } catch {
    allowedTools = inferTools(raw);
  }

  return { name, command: cmd, description: desc, emoji, allowedTools, requires: { bins, env: envs }, version, source: 'native' };
}

function inferTools(body: string): string[] {
  const tools = new Set<string>();
  if (/\bexec\b|\bbash\b|\bshell\b/.test(body))   tools.add('exec');
  if (/\bread\b|\bread_file\b/.test(body))         tools.add('read');
  if (/\bwrite\b|\bwrite_file\b/.test(body))       tools.add('write');
  if (/\blist\b|\blist_files\b/.test(body))         tools.add('list');
  if (/\bweb_search\b|\bsearch\b/.test(body))      tools.add('web_search');
  if (/\bweb_fetch\b|\bfetch\b/.test(body))         tools.add('web_fetch');
  if (/\bmemory/.test(body))                        tools.add('memory_read');
  return [...tools];
}

function extractBody(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}
