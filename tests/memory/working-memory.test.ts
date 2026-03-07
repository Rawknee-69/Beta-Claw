import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkingMemory,
  PROFILE_LIMITS,
  ExternalConfigSchema,
} from '../../src/memory/working-memory.js';
import type {
  ResourceProfile,
  MemoryMessage,
} from '../../src/memory/working-memory.js';

describe('WorkingMemory', () => {
  let memory: WorkingMemory;

  beforeEach(() => {
    memory = new WorkingMemory({ profile: 'standard' });
  });

  describe('addMessage and getMessages', () => {
    it('adds messages and retrieves them in order', () => {
      memory.addMessage('user', 'Hello');
      memory.addMessage('assistant', 'Hi there');
      memory.addMessage('user', 'How are you?');

      const messages = memory.getMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0]!.role).toBe('user');
      expect(messages[0]!.content).toBe('Hello');
      expect(messages[1]!.role).toBe('assistant');
      expect(messages[1]!.content).toBe('Hi there');
      expect(messages[2]!.role).toBe('user');
      expect(messages[2]!.content).toBe('How are you?');
    });

    it('assigns timestamps and token estimates to messages', () => {
      const before = Date.now();
      memory.addMessage('user', 'Test message');
      const after = Date.now();

      const messages = memory.getMessages();
      expect(messages[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(messages[0]!.timestamp).toBeLessThanOrEqual(after);
      expect(messages[0]!.tokenEstimate).toBeGreaterThan(0);
    });

    it('returns a copy of messages, not the internal array', () => {
      memory.addMessage('user', 'Hello');
      const messages1 = memory.getMessages();
      const messages2 = memory.getMessages();
      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });
  });

  describe('token estimation', () => {
    it('estimates ~4 chars per token', () => {
      const text = 'a'.repeat(100);
      const tokens = memory.estimateTokens(text);
      expect(tokens).toBe(25);
    });

    it('rounds up partial tokens', () => {
      const text = 'abc';
      const tokens = memory.estimateTokens(text);
      expect(tokens).toBe(1);
    });

    it('returns 0 for empty string', () => {
      expect(memory.estimateTokens('')).toBe(0);
    });

    it('produces reasonable estimates for natural text', () => {
      const sentence = 'The quick brown fox jumps over the lazy dog.';
      const tokens = memory.estimateTokens(sentence);
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(30);
    });
  });

  describe('context budget tracking', () => {
    it('tracks message tokens in budget', () => {
      memory.addMessage('user', 'a'.repeat(40));
      memory.addMessage('assistant', 'b'.repeat(80));

      const budget = memory.getBudget();
      expect(budget.messageTokens).toBe(10 + 20);
      expect(budget.totalTokens).toBe(30);
    });

    it('tracks system, summary, and RAG tokens', () => {
      memory.setSystemTokens(60);
      memory.setSummaryTokens(150);
      memory.setRagTokens(200);

      const budget = memory.getBudget();
      expect(budget.systemTokens).toBe(60);
      expect(budget.summaryTokens).toBe(150);
      expect(budget.ragTokens).toBe(200);
      expect(budget.totalTokens).toBe(410);
    });

    it('reports maxTokens from config', () => {
      const budget = memory.getBudget();
      expect(budget.maxTokens).toBe(PROFILE_LIMITS['standard']);
    });

    it('calculates utilization percentage correctly', () => {
      const smallMem = new WorkingMemory({ profile: 'micro' });
      smallMem.setSystemTokens(1024);

      const budget = smallMem.getBudget();
      expect(budget.maxTokens).toBe(2048);
      expect(budget.utilizationPercent).toBeCloseTo(50, 0);
    });

    it('sums all token sources for totalTokens', () => {
      memory.setSystemTokens(60);
      memory.setSummaryTokens(150);
      memory.setRagTokens(200);
      memory.addMessage('user', 'a'.repeat(400));

      const budget = memory.getBudget();
      expect(budget.totalTokens).toBe(60 + 150 + 200 + 100);
    });
  });

  describe('summarization threshold', () => {
    it('does not need summarization when under 85%', () => {
      memory.addMessage('user', 'short');
      expect(memory.needsSummarization()).toBe(false);
    });

    it('triggers summarization at 85% utilization', () => {
      const micro = new WorkingMemory({ profile: 'micro' });
      micro.setSystemTokens(Math.ceil(2048 * 0.86));
      expect(micro.needsSummarization()).toBe(true);
    });

    it('triggers summarization at exactly 85%', () => {
      const micro = new WorkingMemory({ profile: 'micro' });
      micro.setSystemTokens(Math.ceil(2048 * 0.85));
      expect(micro.needsSummarization()).toBe(true);
    });

    it('respects custom threshold', () => {
      const custom = new WorkingMemory({
        profile: 'micro',
        summarizeThreshold: 0.5,
      });
      custom.setSystemTokens(Math.ceil(2048 * 0.51));
      expect(custom.needsSummarization()).toBe(true);
    });
  });

  describe('getMessagesForSummarization', () => {
    it('returns empty when summarization not needed', () => {
      memory.addMessage('user', 'Hello');
      expect(memory.getMessagesForSummarization()).toEqual([]);
    });

    it('returns oldest half of messages when over threshold', () => {
      const micro = new WorkingMemory({ profile: 'micro' });
      micro.addMessage('user', 'a'.repeat(2000));
      micro.addMessage('assistant', 'b'.repeat(2000));
      micro.addMessage('user', 'c'.repeat(2000));
      micro.addMessage('assistant', 'd'.repeat(2000));

      const toSummarize = micro.getMessagesForSummarization();
      expect(toSummarize).toHaveLength(2);
      expect(toSummarize[0]!.content).toBe('a'.repeat(2000));
      expect(toSummarize[1]!.content).toBe('b'.repeat(2000));
    });
  });

  describe('applySummarization', () => {
    it('replaces oldest messages with summary tokens', () => {
      const micro = new WorkingMemory({ profile: 'micro' });
      micro.addMessage('user', 'first');
      micro.addMessage('assistant', 'second');
      micro.addMessage('user', 'third');

      micro.applySummarization('Summary of first two messages', 2);

      const messages = micro.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('third');

      const budget = micro.getBudget();
      expect(budget.summaryTokens).toBeGreaterThan(0);
    });

    it('does nothing when summarizedCount is 0', () => {
      memory.addMessage('user', 'Hello');
      memory.applySummarization('Summary', 0);
      expect(memory.getMessages()).toHaveLength(1);
    });

    it('does nothing when summarizedCount exceeds message count', () => {
      memory.addMessage('user', 'Hello');
      memory.applySummarization('Summary', 5);
      expect(memory.getMessages()).toHaveLength(1);
    });
  });

  describe('profile-based token limits', () => {
    it('uses micro profile limit of 2048', () => {
      const micro = new WorkingMemory({ profile: 'micro' });
      expect(micro.getBudget().maxTokens).toBe(2048);
    });

    it('uses lite profile limit of 4096', () => {
      const lite = new WorkingMemory({ profile: 'lite' });
      expect(lite.getBudget().maxTokens).toBe(4096);
    });

    it('uses standard profile limit of 8192', () => {
      const std = new WorkingMemory({ profile: 'standard' });
      expect(std.getBudget().maxTokens).toBe(8192);
    });

    it('uses full profile limit of 128000', () => {
      const full = new WorkingMemory({ profile: 'full' });
      expect(full.getBudget().maxTokens).toBe(128000);
    });

    it('allows custom maxTokens to override profile default', () => {
      const custom = new WorkingMemory({ profile: 'micro', maxTokens: 5000 });
      expect(custom.getBudget().maxTokens).toBe(5000);
    });
  });

  describe('clear', () => {
    it('removes all messages and resets all token counters', () => {
      memory.addMessage('user', 'Hello');
      memory.addMessage('assistant', 'Hi');
      memory.setSystemTokens(60);
      memory.setSummaryTokens(150);
      memory.setRagTokens(200);

      memory.clear();

      expect(memory.getMessages()).toHaveLength(0);
      const budget = memory.getBudget();
      expect(budget.systemTokens).toBe(0);
      expect(budget.summaryTokens).toBe(0);
      expect(budget.ragTokens).toBe(0);
      expect(budget.totalTokens).toBe(0);
    });
  });

  describe('default configuration', () => {
    it('defaults to standard profile when no config provided', () => {
      const defaultMem = new WorkingMemory();
      expect(defaultMem.getBudget().maxTokens).toBe(PROFILE_LIMITS['standard']);
    });

    it('defaults summarize threshold to 0.85', () => {
      const defaultMem = new WorkingMemory();
      defaultMem.setSystemTokens(Math.ceil(8192 * 0.84));
      expect(defaultMem.needsSummarization()).toBe(false);

      defaultMem.setSystemTokens(Math.ceil(8192 * 0.86));
      expect(defaultMem.needsSummarization()).toBe(true);
    });
  });

  describe('TOON serialization round-trip', () => {
    it('serializes and deserializes via TOON', () => {
      memory.addMessage('user', 'Hello world');
      memory.addMessage('assistant', 'Hi there');

      const toon = memory.toToon();
      expect(toon).toContain('@working-memory{');
      expect(toon).toContain('profile:standard');

      const restored = WorkingMemory.fromToon(toon);
      const restoredMessages = restored.getMessages();
      expect(restoredMessages).toHaveLength(2);
      expect(restoredMessages[0]!.role).toBe('user');
      expect(restoredMessages[0]!.content).toBe('Hello world');
      expect(restoredMessages[1]!.role).toBe('assistant');
      expect(restoredMessages[1]!.content).toBe('Hi there');
    });
  });

  describe('Zod validation for external data', () => {
    it('rejects invalid config with Zod', () => {
      expect(() => ExternalConfigSchema.parse({ summarizeThreshold: 2.0 })).toThrow();
    });

    it('rejects negative maxTokens', () => {
      expect(() => ExternalConfigSchema.parse({ maxTokens: -100 })).toThrow();
    });

    it('accepts valid partial config', () => {
      const result = ExternalConfigSchema.parse({ profile: 'lite' });
      expect(result.profile).toBe('lite');
    });
  });
});
