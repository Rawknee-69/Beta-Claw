import { z } from 'zod';

const PLATFORMS = ['linux', 'macos', 'windows'] as const;

const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  description: z.string().min(1),
  requiredEnvVars: z.array(z.string().min(1)).optional(),
  requiredTools: z.array(z.string().min(1)).optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  version: z.string().min(1),
  author: z.string().min(1),
});

interface SkillDefinition {
  name: string;
  command: string;
  description: string;
  requiredEnvVars?: string[];
  requiredTools?: string[];
  platforms?: string[];
  version: string;
  author: string;
  content: string;
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    const arrayItemMatch = trimmed.match(/^\s+-\s+(.+)$/);
    if (arrayItemMatch !== null && currentKey !== null && currentArray !== null) {
      const item = arrayItemMatch[1];
      if (item !== undefined) {
        currentArray.push(item.trim());
      }
      continue;
    }

    if (currentKey !== null && currentArray !== null) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    const kvMatch = trimmed.match(/^([a-zA-Z]\w*)\s*:\s+(.+)$/);
    if (kvMatch !== null) {
      const key = kvMatch[1];
      const value = kvMatch[2];
      if (key !== undefined && value !== undefined) {
        result[key] = value.trim();
      }
      continue;
    }

    const arrayStart = trimmed.match(/^([a-zA-Z]\w*)\s*:\s*$/);
    if (arrayStart !== null) {
      const key = arrayStart[1];
      if (key !== undefined) {
        if (currentKey !== null && currentArray !== null) {
          result[currentKey] = currentArray;
        }
        currentKey = key;
        currentArray = [];
      }
    }
  }

  if (currentKey !== null && currentArray !== null) {
    result[currentKey] = currentArray;
  }

  return result;
}

function parseSkillFile(content: string): SkillDefinition {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!fmMatch) {
    throw new Error('Invalid SKILL.md: missing YAML frontmatter delimiters');
  }

  const rawFrontmatter = fmMatch[1];
  if (rawFrontmatter === undefined) {
    throw new Error('Invalid SKILL.md: empty frontmatter');
  }

  const body = fmMatch[2] ?? '';
  const parsed = parseFrontmatter(rawFrontmatter);
  const validated = SkillFrontmatterSchema.parse(parsed);

  return { ...validated, content: body.trim() };
}

export { parseSkillFile, SkillFrontmatterSchema, PLATFORMS };
export type { SkillDefinition };
