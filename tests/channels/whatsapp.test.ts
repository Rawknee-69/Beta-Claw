import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsAppChannel } from '../../src/channels/whatsapp.js';
import type { InboundMessage, OutboundMessage } from '../../src/channels/interface.js';

describe('WhatsAppChannel', () => {
  let channel: WhatsAppChannel;

  beforeEach(() => {
    channel = new WhatsAppChannel();
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  it('has correct id and name', () => {
    expect(channel.id).toBe('whatsapp');
    expect(channel.name).toBe('WhatsApp');
  });

  it('supportsFeature returns true for images, files, and reactions', () => {
    expect(channel.supportsFeature('images')).toBe(true);
    expect(channel.supportsFeature('files')).toBe(true);
    expect(channel.supportsFeature('reactions')).toBe(true);
  });

  it('supportsFeature returns false for unsupported features', () => {
    expect(channel.supportsFeature('markdown')).toBe(false);
    expect(channel.supportsFeature('threads')).toBe(false);
    expect(channel.supportsFeature('webhooks')).toBe(false);
  });

  it('connect sets connected state', async () => {
    expect(channel.isConnected()).toBe(false);
    await channel.connect();
    expect(channel.isConnected()).toBe(true);
  });

  it('connect is idempotent', async () => {
    await channel.connect();
    await channel.connect();
    expect(channel.isConnected()).toBe(true);
  });

  it('disconnect clears connected state', async () => {
    await channel.connect();
    expect(channel.isConnected()).toBe(true);
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  it('disconnect is idempotent', async () => {
    await channel.connect();
    await channel.disconnect();
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  it('connect and disconnect lifecycle emits events', async () => {
    const events: string[] = [];
    channel.on('connecting', () => events.push('connecting'));
    channel.on('connected', () => events.push('connected'));
    channel.on('disconnecting', () => events.push('disconnecting'));
    channel.on('disconnected', () => events.push('disconnected'));

    await channel.connect();
    await channel.disconnect();

    expect(events).toEqual(['connecting', 'connected', 'disconnecting', 'disconnected']);
  });

  it('send throws when not connected', async () => {
    const msg: OutboundMessage = { groupId: 'g1', content: 'hello' };
    await expect(channel.send(msg)).rejects.toThrow('WhatsApp channel is not connected');
  });

  it('send validates and emits outbound message', async () => {
    await channel.connect();

    const sent: OutboundMessage[] = [];
    channel.on('messageSent', (msg: unknown) => sent.push(msg as OutboundMessage));

    const msg: OutboundMessage = { groupId: 'g1', content: 'hello there' };
    await channel.send(msg);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).toBe('hello there');
    expect(sent[0]!.groupId).toBe('g1');
  });

  it('onMessage registers handler that receives simulated messages', () => {
    const received: InboundMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleIncomingMessage('user123@s.whatsapp.net', 'Hello!');

    expect(received).toHaveLength(1);
    expect(received[0]!.senderId).toBe('user123@s.whatsapp.net');
    expect(received[0]!.content).toBe('Hello!');
    expect(received[0]!.groupId).toBe('user123@s.whatsapp.net');
  });

  it('handleIncomingMessage uses groupId override when provided', () => {
    const received: InboundMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleIncomingMessage('user@s.whatsapp.net', 'Hi', 'group-abc');

    expect(received[0]!.groupId).toBe('group-abc');
    expect(received[0]!.senderId).toBe('user@s.whatsapp.net');
  });

  it('handleIncomingMessage validates input with Zod', () => {
    expect(() => channel.handleIncomingMessage('', 'content')).toThrow();
    expect(() => channel.handleIncomingMessage('jid', '')).toThrow();
  });

  it('supports multiple handlers', () => {
    const received1: InboundMessage[] = [];
    const received2: InboundMessage[] = [];
    channel.onMessage((msg) => received1.push(msg));
    channel.onMessage((msg) => received2.push(msg));

    channel.handleIncomingMessage('u1@wa', 'test');

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('uses default config when none provided', () => {
    const config = channel.getConfig();
    expect(config.authDir).toBe('.whatsapp-auth');
    expect(config.printQRInTerminal).toBe(true);
    expect(config.retryOnDisconnect).toBe(true);
    expect(config.maxRetries).toBe(5);
  });

  it('accepts custom config', () => {
    const custom = new WhatsAppChannel({
      authDir: '/custom/path',
      maxRetries: 3,
      printQRInTerminal: false,
    });
    const config = custom.getConfig();
    expect(config.authDir).toBe('/custom/path');
    expect(config.maxRetries).toBe(3);
    expect(config.printQRInTerminal).toBe(false);
  });

  it('InboundMessage from handleIncomingMessage has proper UUID and timestamp', () => {
    const received: InboundMessage[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.handleIncomingMessage('u@wa', 'msg');

    const msg = received[0]!;
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(msg.timestamp).toBeLessThanOrEqual(Date.now());
    expect(msg.timestamp).toBeGreaterThan(0);
  });
});
