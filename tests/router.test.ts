import { describe, it, expect, beforeEach } from 'vitest';
import { MessageRouter } from '../src/router.js';
import type { GroupConfig, RoutingResult } from '../src/router.js';
import type { InboundMessage, IChannel, OutboundMessage, ChannelFeature } from '../src/channels/interface.js';

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    groupId: 'group-1',
    senderId: 'user-1',
    content: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeChannel(id: string, features: ChannelFeature[] = []): IChannel {
  const featureSet = new Set(features);
  return {
    id,
    name: id,
    connect: async () => {},
    disconnect: async () => {},
    send: async (_msg: OutboundMessage) => {},
    onMessage: (_handler: (msg: InboundMessage) => void) => {},
    supportsFeature: (f: ChannelFeature) => featureSet.has(f),
  };
}

describe('MessageRouter', () => {
  let router: MessageRouter;
  let groups: Map<string, GroupConfig>;

  beforeEach(() => {
    router = new MessageRouter();
    groups = new Map();
    groups.set('group-1', {
      triggerWord: '@Andy',
      allowedTools: ['search', 'code'],
      executionMode: 'isolated',
    });
  });

  it('shouldRespond returns true when trigger word is present', () => {
    const msg = makeMessage({ content: 'Hey @Andy what is the weather?' });
    expect(router.shouldRespond(msg, '@Andy')).toBe(true);
  });

  it('shouldRespond is case-insensitive', () => {
    const msg = makeMessage({ content: 'hey @andy help me' });
    expect(router.shouldRespond(msg, '@Andy')).toBe(true);
  });

  it('shouldRespond returns false when trigger word is absent', () => {
    const msg = makeMessage({ content: 'just a regular message' });
    expect(router.shouldRespond(msg, '@Andy')).toBe(false);
  });

  it('route returns shouldProcess:true with direct_mention priority when trigger is at start', () => {
    const msg = makeMessage({ content: '@Andy tell me a joke' });
    const result = router.route(msg, groups);
    expect(result.shouldProcess).toBe(true);
    expect(result.priority).toBe(10);
    expect(result.reason).toBe('direct_mention');
    expect(result.groupId).toBe('group-1');
  });

  it('route returns shouldProcess:true with lower priority when trigger is mid-message', () => {
    const msg = makeMessage({ content: 'Hey @Andy how are you?' });
    const result = router.route(msg, groups);
    expect(result.shouldProcess).toBe(true);
    expect(result.priority).toBe(5);
    expect(result.reason).toBe('trigger_word_found');
  });

  it('route returns shouldProcess:false when no trigger word matches', () => {
    const msg = makeMessage({ content: 'no mention here' });
    const result = router.route(msg, groups);
    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toBe('no_trigger');
  });

  it('route returns shouldProcess:false when group is not configured', () => {
    const msg = makeMessage({ groupId: 'unknown-group', content: '@Andy hi' });
    const result = router.route(msg, groups);
    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toBe('no_group_config');
    expect(result.priority).toBe(0);
  });

  it('formatResponse preserves markdown when channel supports it', () => {
    const channel = makeChannel('cli', ['markdown']);
    const content = '**bold** and *italic*';
    const result = router.formatResponse(content, channel);
    expect(result).toBe('**bold** and *italic*');
  });

  it('formatResponse strips markdown when channel does not support it', () => {
    const channel = makeChannel('whatsapp');
    const content = '**bold** and *italic*';
    const result = router.formatResponse(content, channel);
    expect(result).toBe('bold and italic');
  });

  it('formatResponse truncates long messages for whatsapp', () => {
    const channel = makeChannel('whatsapp');
    const content = 'a'.repeat(5000);
    const result = router.formatResponse(content, channel);
    expect(result.length).toBeLessThanOrEqual(4096);
    expect(result).toMatch(/\.\.\.$/);
  });

  it('formatResponse does not truncate for cli', () => {
    const channel = makeChannel('cli', ['markdown']);
    const content = 'a'.repeat(10000);
    const result = router.formatResponse(content, channel);
    expect(result.length).toBe(10000);
  });

  it('formatResponse strips code blocks when no markdown support', () => {
    const channel = makeChannel('whatsapp');
    const content = 'Look:\n```js\nconsole.log("hi")\n```\nDone';
    const result = router.formatResponse(content, channel);
    expect(result).toContain('console.log("hi")');
    expect(result).not.toContain('```');
  });

  it('formatResponse strips headers when no markdown support', () => {
    const channel = makeChannel('whatsapp');
    const content = '## Title\nSome text';
    const result = router.formatResponse(content, channel);
    expect(result).toBe('Title\nSome text');
  });

  it('route validates message with Zod schema', () => {
    const invalidMsg = { content: 'hello' } as unknown as InboundMessage;
    expect(() => router.route(invalidMsg, groups)).toThrow();
  });
});
