import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { selectModel } from '../../src/core/model-selector.js';
import { ModelCatalog } from '../../src/core/model-catalog.js';
import { ProviderRegistry } from '../../src/core/provider-registry.js';
import { MicroClawDB } from '../../src/db.js';
import { estimateComplexity } from '../../src/core/complexity-estimator.js';
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  TokenCost,
  ModelCatalogResponse,
  ProviderFeature,
} from '../../src/providers/interface.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-selector-test-'));
  return path.join(dir, 'test.db');
}

function createProvider(
  models: Array<{
    id: string;
    name: string;
    inputCost: number;
    outputCost: number;
    capabilities?: string[];
    contextWindow?: number;
  }>,
): IProviderAdapter {
  return {
    id: 'test',
    name: 'Test',
    baseURL: 'https://test.api',
    async fetchAvailableModels(): Promise<ModelCatalogResponse> {
      return {
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow ?? 128000,
          inputCostPer1M: m.inputCost,
          outputCostPer1M: m.outputCost,
          capabilities: m.capabilities ?? ['streaming', 'function_calling'],
          deprecated: false,
        })),
        fetchedAt: Math.floor(Date.now() / 1000),
        providerID: 'test',
      };
    },
    async complete(_req: CompletionRequest): Promise<CompletionResponse> {
      return {
        content: 'mock', model: 'mock',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      };
    },
    async *stream(_req: CompletionRequest): AsyncIterable<CompletionChunk> {
      yield { content: 'mock', done: true };
    },
    estimateCost(_req: CompletionRequest): TokenCost {
      return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUSD: 0 };
    },
    supportsFeature(_f: ProviderFeature): boolean { return false; },
  };
}

describe('ModelSelector', () => {
  let db: MicroClawDB;
  let registry: ProviderRegistry;
  let catalog: ModelCatalog;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tmpDbPath();
    db = new MicroClawDB(dbPath);
    registry = new ProviderRegistry();

    const provider = createProvider([
      { id: 'nano-1', name: 'Nano Model', inputCost: 0.1, outputCost: 0.2 },
      { id: 'standard-1', name: 'Standard Model', inputCost: 1.0, outputCost: 4.0 },
      { id: 'pro-1', name: 'Pro Model', inputCost: 3.0, outputCost: 15.0 },
      { id: 'max-1', name: 'Max Model', inputCost: 15.0, outputCost: 75.0 },
    ]);
    registry.register(provider);
    catalog = new ModelCatalog(db, registry);
    await catalog.refreshAll();
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* */ }
    try { fs.rmdirSync(path.dirname(dbPath)); } catch { /* */ }
  });

  it('selects nano model for simple greetings', () => {
    const complexity = estimateComplexity('hi');
    const result = selectModel(catalog, complexity);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('nano');
    expect(result!.model.model_id).toBe('nano-1');
  });

  it('selects appropriate tier model for complex tasks', () => {
    const complexity = estimateComplexity('build a REST API with database and testing');
    const result = selectModel(catalog, complexity);
    expect(result).not.toBeNull();
    expect(['standard', 'pro', 'max']).toContain(result!.tier);
  });

  it('returns selection with reason', () => {
    const complexity = estimateComplexity('hello');
    const result = selectModel(catalog, complexity);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain(result!.model.model_name);
  });

  it('returns null when no models are available', () => {
    const emptyDb = new MicroClawDB(dbPath + '2');
    const emptyRegistry = new ProviderRegistry();
    const emptyCatalog = new ModelCatalog(emptyDb, emptyRegistry);
    const complexity = estimateComplexity('hello');
    const result = selectModel(emptyCatalog, complexity);
    expect(result).toBeNull();
    emptyDb.close();
    try { fs.unlinkSync(dbPath + '2'); } catch { /* */ }
  });

  it('falls back to another tier when target tier has no models', async () => {
    const smallRegistry = new ProviderRegistry();
    smallRegistry.register(
      createProvider([
        { id: 'only-pro', name: 'Only Pro', inputCost: 3.0, outputCost: 15.0 },
      ]),
    );
    const smallCatalog = new ModelCatalog(db, smallRegistry);
    await smallCatalog.refreshProvider(smallRegistry.list()[0]!);

    const complexity = estimateComplexity('hi');
    expect(complexity.tier).toBe('nano');

    const result = selectModel(smallCatalog, complexity);
    expect(result).not.toBeNull();
    expect(result!.model.model_id).toBe('only-pro');
  });

  it('breaks ties by cost (cheapest wins)', async () => {
    const tieRegistry = new ProviderRegistry();
    tieRegistry.register(
      createProvider([
        { id: 'cheap-nano', name: 'Cheap Nano', inputCost: 0.05, outputCost: 0.1 },
        { id: 'expensive-nano', name: 'Expensive Nano', inputCost: 0.2, outputCost: 0.3 },
      ]),
    );
    const tieCatalog = new ModelCatalog(db, tieRegistry);
    await tieCatalog.refreshProvider(tieRegistry.list()[0]!);

    const complexity = estimateComplexity('hi');
    const result = selectModel(tieCatalog, complexity);
    expect(result).not.toBeNull();
    expect(result!.model.model_id).toBe('cheap-nano');
  });

  it('prefers models with more capabilities', async () => {
    const capRegistry = new ProviderRegistry();
    capRegistry.register(
      createProvider([
        {
          id: 'basic-nano',
          name: 'Basic',
          inputCost: 0.1,
          outputCost: 0.2,
          capabilities: ['streaming'],
        },
        {
          id: 'capable-nano',
          name: 'Capable',
          inputCost: 0.1,
          outputCost: 0.2,
          capabilities: ['streaming', 'function_calling', 'vision', 'json_mode'],
        },
      ]),
    );
    const capCatalog = new ModelCatalog(db, capRegistry);
    await capCatalog.refreshProvider(capRegistry.list()[0]!);

    const complexity = estimateComplexity('hello');
    const result = selectModel(capCatalog, complexity);
    expect(result).not.toBeNull();
    expect(result!.model.model_id).toBe('capable-nano');
  });

  it('integrates with complexity estimator end-to-end', () => {
    const inputs = ['hi', 'write a function', 'build a full application with tests and deploy'];
    const tiers: string[] = [];

    for (const input of inputs) {
      const complexity = estimateComplexity(input);
      const result = selectModel(catalog, complexity);
      if (result) tiers.push(result.tier);
    }

    expect(tiers.length).toBe(3);
  });

  it('includes a numeric score in selection result', () => {
    const complexity = estimateComplexity('hello');
    const result = selectModel(catalog, complexity);
    expect(result).not.toBeNull();
    expect(result!.score).toBeTypeOf('number');
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.score).toBeLessThanOrEqual(1);
  });
});
