import { createHash } from 'node:crypto';
import { z } from 'zod';
import { encode, decode } from './toon-serializer.js';

const FullPromptSchema = z.string().min(1);
const PromptTypeSchema = z.string().min(1);

interface CompressedPrompt {
  cacheKey: string;
  compressedToon: string;
  cachedTokenId?: string;
  expandedFull: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

const TRIM_LINES_RE = /^[ \t]+|[ \t]+$/gm;
const LIST_MARKER_RE = /^[-*]\s+|^\d+\.\s+/;
const COLLAPSE_SPACES_RE = /  +/g;
const FILLER_WORDS_RE = /\b(the|a|an|is|are|always|must|should|that|very|really|just|also|when|where|as|be|your|you|its|their|these|those|this)\b ?/gi;

function compressLine(line: string): string {
  return line.replace(LIST_MARKER_RE, '').trim();
}

function stripFillerWords(text: string): string {
  return text.replace(FILLER_WORDS_RE, '').replace(COLLAPSE_SPACES_RE, ' ').trim();
}

function compressSection(lines: string[]): string {
  const joined = lines
    .map(compressLine)
    .filter((l) => l.length > 0)
    .join('; ')
    .replace(COLLAPSE_SPACES_RE, ' ');
  return stripFillerWords(joined);
}

function extractSections(text: string): Record<string, string> {
  const cleaned = text.replace(TRIM_LINES_RE, '').trim();
  const sections: Record<string, string> = {};
  const lines = cleaned.split('\n');
  let currentKey = 'content';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = /^#{1,3}\s+(.+)$/.exec(line) ?? /^\[(.+)\]$/.exec(line);
    if (headerMatch) {
      if (currentLines.length > 0) {
        const compressed = compressSection(currentLines);
        if (compressed.length > 0) {
          sections[currentKey] = compressed;
        }
      }
      currentKey = headerMatch[1]!
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_-]/g, '');
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const compressed = compressSection(currentLines);
    if (compressed.length > 0) {
      sections[currentKey] = compressed;
    }
  }

  return sections;
}

export class PromptCompressor {
  compress(fullPrompt: string, type: string): CompressedPrompt {
    const validatedPrompt = FullPromptSchema.parse(fullPrompt);
    const validatedType = PromptTypeSchema.parse(type);

    const cacheKey = sha256(validatedPrompt);
    const sections = extractSections(validatedPrompt);
    const toonData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(sections)) {
      toonData[key] = value;
    }

    const compressedToon = encode(validatedType, toonData);

    return {
      cacheKey,
      compressedToon,
      expandedFull: validatedPrompt,
    };
  }

  getForProvider(
    compressed: CompressedPrompt,
    providerSupportsCache: boolean,
  ): string {
    if (providerSupportsCache) {
      return `<mc_agent_v1:${compressed.cacheKey}>`;
    }
    return compressed.compressedToon;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  decompress(toon: string): string {
    const parsed = decode(toon);
    const lines: string[] = [];

    for (const [key, value] of Object.entries(parsed.data)) {
      const text = String(value).replace(/; /g, '\n');
      if (key === 'content') {
        lines.push(text);
      } else {
        const heading = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`## ${heading}`);
        lines.push(text);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
