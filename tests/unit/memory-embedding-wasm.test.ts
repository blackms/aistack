/**
 * Unit tests for the WASM-native embedding subsystem.
 *
 * These tests do NOT hit the network nor load the real ONNX model — instead
 * they mock `@xenova/transformers` so they are fast, deterministic, and
 * runnable in CI without 25MB of model downloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock `@xenova/transformers` BEFORE importing modules that touch it.
// The mock yields deterministic 384-dim Float32 vectors derived from the
// input text length so we can assert on shape and content.
vi.mock('@xenova/transformers', () => {
  const pipeline = vi.fn(async () => {
    return async (
      input: string | string[],
      _opts?: { pooling?: string; normalize?: boolean },
    ) => {
      const texts = Array.isArray(input) ? input : [input];
      const stride = 384;
      const data = new Float32Array(texts.length * stride);
      for (let i = 0; i < texts.length; i++) {
        const seed = texts[i]?.length ?? 0;
        for (let j = 0; j < stride; j++) {
          data[i * stride + j] = ((seed + j) % 17) / 17;
        }
      }
      return {
        data,
        dims: Array.isArray(input) ? [texts.length, stride] : [stride],
      };
    };
  });
  return {
    pipeline,
    env: { cacheDir: undefined, allowRemoteModels: true, allowLocalModels: true },
  };
});

describe('WasmEmbedder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes default model id and dimensions', async () => {
    const { WasmEmbedder, DEFAULT_MODEL_ID, DEFAULT_MODEL_DIMENSIONS } = await import(
      '../../src/memory/embedding/wasm/index.js'
    );
    const e = new WasmEmbedder();
    expect(e.modelId).toBe(DEFAULT_MODEL_ID);
    expect(e.dimensions).toBe(DEFAULT_MODEL_DIMENSIONS);
    expect(DEFAULT_MODEL_DIMENSIONS).toBe(384);
  });

  it('embed() returns a Float32Array of the expected dimensions', async () => {
    const { WasmEmbedder } = await import('../../src/memory/embedding/wasm/index.js');
    const e = new WasmEmbedder();
    const vec = await e.embed('hello world');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });

  it('embedBatch() returns one vector per input', async () => {
    const { WasmEmbedder } = await import('../../src/memory/embedding/wasm/index.js');
    const e = new WasmEmbedder();
    const vecs = await e.embedBatch(['a', 'bb', 'ccc']);
    expect(vecs).toHaveLength(3);
    for (const v of vecs) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(384);
    }
  });

  it('isAvailable() reports true when the optional dep is mocked', async () => {
    const { WasmEmbedder } = await import('../../src/memory/embedding/wasm/index.js');
    await expect(WasmEmbedder.isAvailable()).resolves.toBe(true);
  });
});

describe('WasmLocalEmbeddings provider adapter', () => {
  it('returns number[] (not Float32Array) to match EmbeddingProvider interface', async () => {
    const { WasmLocalEmbeddings } = await import(
      '../../src/memory/embedding/providers/wasm-local.js'
    );
    const p = new WasmLocalEmbeddings();
    const vec = await p.embed('hello');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(384);
    expect(typeof vec[0]).toBe('number');
  });

  it('batch returns one number[] per input', async () => {
    const { WasmLocalEmbeddings } = await import(
      '../../src/memory/embedding/providers/wasm-local.js'
    );
    const p = new WasmLocalEmbeddings();
    const vecs = await p.embedBatch(['x', 'yy']);
    expect(vecs).toHaveLength(2);
    expect(vecs[0]?.length).toBe(384);
  });

  it('tryCreateWasmLocalProvider yields a working provider', async () => {
    const { tryCreateWasmLocalProvider } = await import(
      '../../src/memory/embedding/providers/index.js'
    );
    const provider = await tryCreateWasmLocalProvider();
    expect(provider).not.toBeNull();
    expect(provider?.dimensions).toBe(384);
  });
});

describe('HNSW index (in-memory fallback)', () => {
  it('upsert + search returns top-k by cosine similarity', async () => {
    const { createHnswIndex } = await import('../../src/memory/embedding/hnsw.js');
    const idx = await createHnswIndex({ dimensions: 4 });
    idx.upsert('a', [1, 0, 0, 0]);
    idx.upsert('b', [0, 1, 0, 0]);
    idx.upsert('c', [0.9, 0.1, 0, 0]);

    const results = idx.search([1, 0, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('a');
    expect(results[1]?.id).toBe('c');
    expect(idx.backend).toBe('in-memory');
  });

  it('remove() drops the entry from future searches', async () => {
    const { createHnswIndex } = await import('../../src/memory/embedding/hnsw.js');
    const idx = await createHnswIndex({ dimensions: 3 });
    idx.upsert('a', [1, 0, 0]);
    idx.upsert('b', [0, 1, 0]);
    expect(idx.size()).toBe(2);
    idx.remove('a');
    expect(idx.size()).toBe(1);
    const results = idx.search([1, 0, 0], 5);
    expect(results.find(r => r.id === 'a')).toBeUndefined();
  });
});
