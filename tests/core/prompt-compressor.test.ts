import { describe, it, expect } from 'vitest';
import { PromptCompressor } from '../../src/core/prompt-compressor.js';

const SAMPLE_PROMPT = `# Persona
You are a helpful coding assistant specializing in TypeScript development.
You always follow best practices and write clean code.

## Rules
- Never use \`any\` type
- Always handle errors gracefully
- Use descriptive variable names
- Follow the project coding standards

## Context
The user is working on a Node.js project with ESM modules.
They prefer functional patterns where possible.`;

const LONG_PROMPT = `# System Instructions

You are an advanced AI agent designed for complex software engineering tasks.
Your capabilities include code generation, debugging, refactoring, and test writing.
You must always produce production-ready code with proper error handling.

## Behavioral Guidelines

Follow these rules strictly:
- Always validate input parameters before processing
- Use proper TypeScript types throughout, never resort to any
- Handle edge cases explicitly
- Log warnings for unexpected but recoverable situations
- Throw descriptive errors for unrecoverable failures
- Keep functions small and focused on a single responsibility
- Prefer composition over inheritance

## Output Format

When generating code, structure output as follows:
1. Import statements grouped by source
2. Type definitions
3. Constants
4. Helper functions
5. Main exported functions or classes

## Performance Considerations

Optimize for:
- Memory efficiency in large codebases
- Minimal unnecessary allocations
- Lazy evaluation where appropriate
- Caching of expensive computations`;

describe('PromptCompressor', () => {
  const compressor = new PromptCompressor();

  describe('compress', () => {
    it('produces a valid SHA-256 hex cacheKey', () => {
      const result = compressor.compress(SAMPLE_PROMPT, 'agent');
      expect(result.cacheKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces deterministic cacheKey for same input', () => {
      const r1 = compressor.compress(SAMPLE_PROMPT, 'agent');
      const r2 = compressor.compress(SAMPLE_PROMPT, 'agent');
      expect(r1.cacheKey).toBe(r2.cacheKey);
    });

    it('produces different cacheKey for different input', () => {
      const r1 = compressor.compress(SAMPLE_PROMPT, 'agent');
      const r2 = compressor.compress('A completely different prompt.', 'agent');
      expect(r1.cacheKey).not.toBe(r2.cacheKey);
    });

    it('generates compressedToon shorter than expandedFull', () => {
      const result = compressor.compress(LONG_PROMPT, 'system');
      expect(result.compressedToon.length).toBeLessThan(result.expandedFull.length);
    });

    it('preserves the original prompt in expandedFull', () => {
      const result = compressor.compress(SAMPLE_PROMPT, 'agent');
      expect(result.expandedFull).toBe(SAMPLE_PROMPT);
    });

    it('embeds the type in TOON output', () => {
      const result = compressor.compress(SAMPLE_PROMPT, 'persona');
      expect(result.compressedToon).toContain('@persona{');
    });

    it('throws on empty prompt', () => {
      expect(() => compressor.compress('', 'agent')).toThrow();
    });

    it('throws on empty type', () => {
      expect(() => compressor.compress('Hello', '')).toThrow();
    });
  });

  describe('getForProvider', () => {
    it('returns cache reference when provider supports caching', () => {
      const compressed = compressor.compress(SAMPLE_PROMPT, 'agent');
      const result = compressor.getForProvider(compressed, true);
      expect(result).toBe(`<mc_agent_v1:${compressed.cacheKey}>`);
    });

    it('returns compressedToon when provider lacks cache support', () => {
      const compressed = compressor.compress(SAMPLE_PROMPT, 'agent');
      const result = compressor.getForProvider(compressed, false);
      expect(result).toBe(compressed.compressedToon);
    });

    it('cache reference contains the SHA-256 hash', () => {
      const compressed = compressor.compress(SAMPLE_PROMPT, 'agent');
      const result = compressor.getForProvider(compressed, true);
      expect(result).toContain(compressed.cacheKey);
      expect(result).toMatch(/^<mc_agent_v1:[a-f0-9]{64}>$/);
    });
  });

  describe('estimateTokens', () => {
    it('estimates tokens as roughly chars / 4', () => {
      const text = 'a'.repeat(400);
      expect(compressor.estimateTokens(text)).toBe(100);
    });

    it('rounds up for non-divisible lengths', () => {
      const text = 'a'.repeat(401);
      expect(compressor.estimateTokens(text)).toBe(101);
    });

    it('returns 0 for empty string', () => {
      expect(compressor.estimateTokens('')).toBe(0);
    });

    it('produces reasonable estimate for real prompt', () => {
      const tokens = compressor.estimateTokens(SAMPLE_PROMPT);
      expect(tokens).toBeGreaterThan(50);
      expect(tokens).toBeLessThan(500);
    });
  });

  describe('token savings', () => {
    it('demonstrates measurable token savings via TOON compression', () => {
      const compressed = compressor.compress(LONG_PROMPT, 'system');
      const originalTokens = compressor.estimateTokens(compressed.expandedFull);
      const compressedTokens = compressor.estimateTokens(compressed.compressedToon);
      expect(compressedTokens).toBeLessThan(originalTokens);
      const savings = ((originalTokens - compressedTokens) / originalTokens) * 100;
      expect(savings).toBeGreaterThan(5);
    });
  });

  describe('round-trip', () => {
    it('decompress recovers semantic content from compressed TOON', () => {
      const compressed = compressor.compress(SAMPLE_PROMPT, 'agent');
      const decompressed = compressor.decompress(compressed.compressedToon);
      expect(decompressed).toContain('helpful coding assistant');
      expect(decompressed).toContain('any');
      expect(decompressed).toContain('Node.js');
    });

    it('decompress preserves all section headings', () => {
      const compressed = compressor.compress(LONG_PROMPT, 'system');
      const decompressed = compressor.decompress(compressed.compressedToon);
      expect(decompressed.toLowerCase()).toContain('behavioral guidelines');
      expect(decompressed.toLowerCase()).toContain('output format');
      expect(decompressed.toLowerCase()).toContain('performance considerations');
    });
  });

  describe('whitespace handling', () => {
    it('collapses excessive newlines', () => {
      const messy = '# Title\n\n\n\n\nContent here\n\n\n\nMore content';
      const compressed = compressor.compress(messy, 'doc');
      expect(compressed.compressedToon).not.toContain('\n\n\n');
    });

    it('strips leading/trailing whitespace from lines', () => {
      const padded = '# Title\n   padded line   \n   another   ';
      const compressed = compressor.compress(padded, 'doc');
      expect(compressed.compressedToon).not.toMatch(/   padded/);
    });
  });
});
