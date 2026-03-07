import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../../src/providers/anthropic.js';

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter(() => 'test-key');

  it('has correct id and name', () => {
    expect(adapter.id).toBe('anthropic');
    expect(adapter.name).toBe('Anthropic');
  });

  it('has correct base URL', () => {
    expect(adapter.baseURL).toBe('https://api.anthropic.com/v1');
  });

  it('supports streaming', () => {
    expect(adapter.supportsFeature('streaming')).toBe(true);
  });

  it('supports function calling', () => {
    expect(adapter.supportsFeature('function_calling')).toBe(true);
  });

  it('supports prompt caching', () => {
    expect(adapter.supportsFeature('prompt_caching')).toBe(true);
  });

  it('supports vision', () => {
    expect(adapter.supportsFeature('vision')).toBe(true);
  });

  it('does not support json_mode', () => {
    expect(adapter.supportsFeature('json_mode')).toBe(false);
  });

  it('returns model catalog without network call', async () => {
    const catalog = await adapter.fetchAvailableModels();
    expect(catalog.providerID).toBe('anthropic');
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.every((m) => !m.deprecated)).toBe(true);
    expect(catalog.models.some((m) => m.name.includes('Sonnet'))).toBe(true);
    expect(catalog.models.some((m) => m.name.includes('Opus'))).toBe(true);
  });

  it('estimates cost for a request', () => {
    const cost = adapter.estimateCost({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Explain quantum computing in simple terms' }],
    });
    expect(cost.estimatedInputTokens).toBeGreaterThan(0);
    expect(cost.estimatedOutputTokens).toBeGreaterThan(0);
    expect(cost.estimatedCostUSD).toBeGreaterThan(0);
  });

  it('all models have capabilities listed', async () => {
    const catalog = await adapter.fetchAvailableModels();
    for (const model of catalog.models) {
      expect(model.capabilities.length).toBeGreaterThan(0);
      expect(model.capabilities).toContain('streaming');
    }
  });

  it('implements IProviderAdapter interface', () => {
    expect(typeof adapter.fetchAvailableModels).toBe('function');
    expect(typeof adapter.complete).toBe('function');
    expect(typeof adapter.stream).toBe('function');
    expect(typeof adapter.estimateCost).toBe('function');
    expect(typeof adapter.supportsFeature).toBe('function');
  });
});
