import { describe, it, expect } from 'vitest';
import {
  classifyIntent,
  getToolsForIntent,
  TOOL_MAP,
  AMBIGUITY_THRESHOLD,
  INTENT_CATEGORIES,
} from '../../src/core/dynamic-tool-loader.js';
import type { IntentCategory } from '../../src/core/dynamic-tool-loader.js';

describe('DynamicToolLoader', () => {
  describe('classifyIntent — required classifications', () => {
    it('classifies "search for AI news" as web_search', () => {
      const result = classifyIntent('search for AI news');
      expect(result.category).toBe('web_search');
    });

    it('classifies "write a python script" as code_exec', () => {
      const result = classifyIntent('write a python script');
      expect(result.category).toBe('code_exec');
    });

    it('classifies "read config.json" as file_ops', () => {
      const result = classifyIntent('read config.json');
      expect(result.category).toBe('file_ops');
    });

    it('classifies "send an email to John" as email', () => {
      const result = classifyIntent('send an email to John');
      expect(result.category).toBe('email');
    });

    it('classifies "calculate 2+2" as math', () => {
      const result = classifyIntent('calculate 2+2');
      expect(result.category).toBe('math');
    });

    it('classifies ambiguous "hello" as general', () => {
      const result = classifyIntent('hello');
      expect(result.category).toBe('general');
    });
  });

  describe('classifyIntent — additional intent categories', () => {
    it('classifies "google the latest trends" as web_search', () => {
      const result = classifyIntent('google the latest trends');
      expect(result.category).toBe('web_search');
    });

    it('classifies "run the javascript code" as code_exec', () => {
      const result = classifyIntent('run the javascript code');
      expect(result.category).toBe('code_exec');
    });

    it('classifies "delete the log file" as file_ops', () => {
      const result = classifyIntent('delete the log file');
      expect(result.category).toBe('file_ops');
    });

    it('classifies "check my inbox" as email', () => {
      const result = classifyIntent('check my inbox');
      expect(result.category).toBe('email');
    });

    it('classifies "schedule a meeting tomorrow" as calendar', () => {
      const result = classifyIntent('schedule a meeting tomorrow');
      expect(result.category).toBe('calendar');
    });

    it('classifies "solve this equation" as math', () => {
      const result = classifyIntent('solve this equation');
      expect(result.category).toBe('math');
    });

    it('classifies "generate an image of a cat" as media', () => {
      const result = classifyIntent('generate an image of a cat');
      expect(result.category).toBe('media');
    });

    it('classifies "install npm package" as system_cmd', () => {
      const result = classifyIntent('install npm package');
      expect(result.category).toBe('system_cmd');
    });

    it('classifies "send a message on slack" as communication', () => {
      const result = classifyIntent('send a message on slack');
      expect(result.category).toBe('communication');
    });

    it('classifies "what did we discuss last time" as memory_read', () => {
      const result = classifyIntent('what did we discuss last time');
      expect(result.category).toBe('memory_read');
    });

    it('classifies "remember this for later" as memory_write', () => {
      const result = classifyIntent('remember this for later');
      expect(result.category).toBe('memory_write');
    });
  });

  describe('ambiguity threshold', () => {
    it('falls back to general when no category scores above threshold', () => {
      const result = classifyIntent('hello there, how are you?');
      expect(result.category).toBe('general');
      expect(result.confidence).toBeLessThan(AMBIGUITY_THRESHOLD);
    });

    it('falls back to general for vague input like "ok"', () => {
      const result = classifyIntent('ok');
      expect(result.category).toBe('general');
    });

    it('returns confidence >= threshold for clear intents', () => {
      const result = classifyIntent('search for AI news');
      expect(result.confidence).toBeGreaterThanOrEqual(AMBIGUITY_THRESHOLD);
    });
  });

  describe('tools returned match TOOL_MAP', () => {
    for (const category of INTENT_CATEGORIES) {
      it(`getToolsForIntent('${category}') matches TOOL_MAP`, () => {
        const tools = getToolsForIntent(category);
        expect(tools).toEqual([...TOOL_MAP[category]]);
      });
    }

    it('classifyIntent tools match TOOL_MAP for the returned category', () => {
      const result = classifyIntent('write a python script');
      expect(result.tools).toEqual([...TOOL_MAP[result.category]]);
    });
  });

  describe('IntentResult structure', () => {
    it('returns confidence between 0 and 1', () => {
      const inputs = [
        'hello', 'search the web', 'write python code',
        'send email', 'calculate 42 * 7',
      ];
      for (const input of inputs) {
        const result = classifyIntent(input);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('returns a valid IntentCategory', () => {
      const result = classifyIntent('browse the internet for news');
      const validCategories: readonly string[] = INTENT_CATEGORIES;
      expect(validCategories).toContain(result.category);
    });

    it('returns a non-empty tools array', () => {
      const result = classifyIntent('anything at all');
      expect(result.tools.length).toBeGreaterThan(0);
    });
  });

  describe('input validation', () => {
    it('throws on empty string input', () => {
      expect(() => classifyIntent('')).toThrow();
    });

    it('throws on invalid category in getToolsForIntent', () => {
      expect(() => getToolsForIntent('nonexistent' as IntentCategory)).toThrow();
    });
  });

  describe('performance', () => {
    it('classifies in under 1ms per call', () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        classifyIntent('search for the latest AI news and summarize it');
      }
      const elapsed = performance.now() - start;
      expect(elapsed / 100).toBeLessThan(1);
    });
  });
});
