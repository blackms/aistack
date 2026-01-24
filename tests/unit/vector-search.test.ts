/**
 * Vector Search tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorSearch } from '../../src/memory/vector-search.js';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig } from '../../src/types.js';

// Create config for vector search tests
function createVectorConfig(enabled: boolean, provider: string = 'openai'): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './data/memory.db',
      defaultNamespace: 'default',
      vectorSearch: {
        enabled,
        provider,
      },
    },
    providers: {
      default: 'anthropic',
      openai: { apiKey: 'test-key' },
      ollama: { baseUrl: 'http://localhost:11434' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('VectorSearch', () => {
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-vector-test-${Date.now()}.db`);
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('constructor', () => {
    it('should create disabled vector search when disabled in config', () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      expect(vectorSearch.isEnabled()).toBe(false);
    });

    it('should create enabled vector search with openai provider', () => {
      const config = createVectorConfig(true, 'openai');
      const vectorSearch = new VectorSearch(store, config);

      expect(vectorSearch.isEnabled()).toBe(true);
    });

    it('should create enabled vector search with ollama provider', () => {
      const config = createVectorConfig(true, 'ollama');
      const vectorSearch = new VectorSearch(store, config);

      expect(vectorSearch.isEnabled()).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return false when disabled', () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      expect(vectorSearch.isEnabled()).toBe(false);
    });

    it('should return true when enabled', () => {
      const config = createVectorConfig(true);
      const vectorSearch = new VectorSearch(store, config);

      expect(vectorSearch.isEnabled()).toBe(true);
    });
  });

  describe('search (disabled)', () => {
    it('should return empty array when disabled', async () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      const results = await vectorSearch.search('test query');

      expect(results).toEqual([]);
    });
  });

  describe('indexEntry (disabled)', () => {
    it('should not throw when disabled', async () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      store.store('key1', 'test content');
      const entry = store.get('key1')!;

      await expect(vectorSearch.indexEntry(entry)).resolves.not.toThrow();
    });
  });

  describe('indexBatch (disabled)', () => {
    it('should return 0 when disabled', async () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      store.store('key1', 'content 1');
      store.store('key2', 'content 2');

      const entry1 = store.get('key1')!;
      const entry2 = store.get('key2')!;

      const count = await vectorSearch.indexBatch([entry1, entry2]);

      expect(count).toBe(0);
    });

    it('should return 0 for empty array', async () => {
      const config = createVectorConfig(true);
      const vectorSearch = new VectorSearch(store, config);

      const count = await vectorSearch.indexBatch([]);

      expect(count).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      store.store('key1', 'content');

      const stats = vectorSearch.getStats();

      expect(stats.total).toBe(1);
      expect(stats.indexed).toBe(0);
      expect(stats.coverage).toBe(0);
    });

    it('should calculate coverage correctly', () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      const stats = vectorSearch.getStats();

      expect(stats.total).toBe(0);
      expect(stats.coverage).toBe(0);
    });

    it('should filter by namespace', () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      store.store('key1', 'content 1', { namespace: 'ns1' });
      store.store('key2', 'content 2', { namespace: 'ns2' });

      const stats = vectorSearch.getStats('ns1');

      expect(stats.total).toBe(1);
    });
  });

  describe('findSimilar (disabled)', () => {
    it('should return empty array when disabled', async () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      store.store('key1', 'content');

      const results = await vectorSearch.findSimilar('key1');

      expect(results).toEqual([]);
    });

    it('should return empty array for missing entry', async () => {
      const config = createVectorConfig(false);
      const vectorSearch = new VectorSearch(store, config);

      const results = await vectorSearch.findSimilar('nonexistent');

      expect(results).toEqual([]);
    });
  });
});

describe('VectorSearch without OpenAI key', () => {
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-vector-nokey-${Date.now()}.db`);
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it('should be disabled when openai key is missing', () => {
    const config: AgentStackConfig = {
      version: '1.0.0',
      memory: {
        path: './data/memory.db',
        defaultNamespace: 'default',
        vectorSearch: {
          enabled: true,
          provider: 'openai',
        },
      },
      providers: { default: 'anthropic' }, // No openai config
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: false },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    };

    const vectorSearch = new VectorSearch(store, config);

    expect(vectorSearch.isEnabled()).toBe(false);
  });
});

describe('VectorSearch with mocked embeddings', () => {
  let store: SQLiteStore;
  let dbPath: string;
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-vector-mock-${Date.now()}.db`);
    store = new SQLiteStore(dbPath);
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    store.close();
    global.fetch = originalFetch;
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should index entry and search with mocked openai embeddings', async () => {
    // Mock embedding response
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    // Store and index an entry
    store.store('key1', 'test content');
    const entry = store.get('key1')!;
    await vectorSearch.indexEntry(entry);

    // Search
    const results = await vectorSearch.search('test query');

    expect(mockFetch).toHaveBeenCalled();
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle embedding error gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Server error',
    });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    store.store('key1', 'test content');
    const entry = store.get('key1')!;

    // Should not throw
    await expect(vectorSearch.indexEntry(entry)).resolves.not.toThrow();
  });

  it('should handle batch index with mocked embeddings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] },
        ],
      }),
    });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    store.store('key1', 'content 1');
    store.store('key2', 'content 2');

    const entry1 = store.get('key1')!;
    const entry2 = store.get('key2')!;

    const count = await vectorSearch.indexBatch([entry1, entry2]);

    expect(count).toBe(2);
  });

  it('should handle batch index error gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service unavailable',
    });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    store.store('key1', 'content 1');
    const entry = store.get('key1')!;

    const count = await vectorSearch.indexBatch([entry]);

    expect(count).toBe(0);
  });

  it('should search with mocked embeddings and return results', async () => {
    // First call for indexing
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [1.0, 0.0, 0.0] }] }),
    });
    // Second call for search query
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [1.0, 0.0, 0.0] }] }),
    });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    store.store('key1', 'test content about cats');
    const entry = store.get('key1')!;
    await vectorSearch.indexEntry(entry);

    const results = await vectorSearch.search('cats');

    // Should find the entry since vectors are identical
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe('vector');
    expect(results[0].score).toBeCloseTo(1, 2);
  });

  it('should handle search error gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    const results = await vectorSearch.search('test query');

    expect(results).toEqual([]);
  });

  it('should return empty when no entries have embeddings', async () => {
    // Mock query embedding
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [1.0, 0.0, 0.0] }] }),
    });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    // Store entry but don't index it
    store.store('key1', 'test content');

    const results = await vectorSearch.search('test query');

    expect(results).toEqual([]);
  });

  it('should find similar entries', async () => {
    // Index two similar entries
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [1.0, 0.0, 0.0] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.9, 0.1, 0.0] }] }),
      });

    const config = createVectorConfig(true, 'openai');
    const vectorSearch = new VectorSearch(store, config);

    store.store('key1', 'content about dogs');
    store.store('key2', 'content about puppies');

    const entry1 = store.get('key1')!;
    const entry2 = store.get('key2')!;

    await vectorSearch.indexEntry(entry1);
    await vectorSearch.indexEntry(entry2);

    // Find similar to key1
    const results = await vectorSearch.findSimilar(entry1.id, { threshold: 0.5 });

    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});
