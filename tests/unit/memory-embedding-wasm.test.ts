/**
 * Unit tests for the WASM-native embedding subsystem.
 *
 * These tests do NOT hit the network nor load the real ONNX model — instead
 * they mock `@xenova/transformers` so they are fast, deterministic, and
 * runnable in CI without 25MB of model downloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Track each pipeline invocation so chunking tests can assert call counts.
const pipelineCalls: Array<{ inputCount: number }> = [];

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
      pipelineCalls.push({ inputCount: texts.length });
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
    pipelineCalls.length = 0;
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

  it('embedBatch() chunks arbitrarily large batches to bounded forward passes', async () => {
    const { WasmEmbedder } = await import('../../src/memory/embedding/wasm/index.js');
    // Custom chunk size so the assertion is independent of the default.
    const e = new WasmEmbedder({ batchChunkSize: 8 });
    const inputs = Array.from({ length: 100 }, (_, i) => `t-${i}`);
    const out = await e.embedBatch(inputs);
    expect(out).toHaveLength(100);
    // 100 / 8 = 13 chunks (12 full + 1 of 4).
    expect(pipelineCalls).toHaveLength(13);
    for (const c of pipelineCalls) expect(c.inputCount).toBeLessThanOrEqual(8);
    const last = pipelineCalls[pipelineCalls.length - 1]!;
    expect(last.inputCount).toBe(100 - 12 * 8);
    // Per-input vectors should match what the single-call path would yield
    // (chunking must not corrupt slicing).
    expect(out[0]!.length).toBe(384);
    expect(out[99]!.length).toBe(384);
  });

  it('exposes wasmMemoryCapMib with a sane default', async () => {
    const { WasmEmbedder, DEFAULT_WASM_MEMORY_CAP_MIB } = await import(
      '../../src/memory/embedding/wasm/index.js'
    );
    const e = new WasmEmbedder();
    expect(e.wasmMemoryCapMib).toBe(DEFAULT_WASM_MEMORY_CAP_MIB);
    expect(DEFAULT_WASM_MEMORY_CAP_MIB).toBeGreaterThanOrEqual(64);
    const tuned = new WasmEmbedder({ wasmMemoryCapMib: 512 });
    expect(tuned.wasmMemoryCapMib).toBe(512);
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

  it('search returns scores in [0, 1] (in-memory backend)', async () => {
    const { createHnswIndex } = await import('../../src/memory/embedding/hnsw.js');
    const idx = await createHnswIndex({ dimensions: 3 });
    idx.upsert('a', [1, 0, 0]);
    const results = idx.search([1, 0, 0], 1);
    expect(results[0]?.score).toBeGreaterThanOrEqual(0);
    expect(results[0]?.score).toBeLessThanOrEqual(1);
  });
});

describe('SqliteVecHnsw persistent id map', () => {
  /**
   * Fake `better-sqlite3`-shaped DB that persists state in JS maps so we can
   * destroy and re-create the wrapper to simulate a process restart. This
   * mirrors the contract used by the real wrapper without requiring native
   * bindings in CI.
   */
  function makeFakeDb() {
    const tables = new Map<string, Map<number, { rowid: number; embedding: Buffer }>>();
    const idMaps = new Map<string, Map<string, number>>();

    function ensureTable(t: string) {
      if (!tables.has(t)) tables.set(t, new Map());
    }
    function ensureMap(t: string) {
      if (!idMaps.has(t)) idMaps.set(t, new Map());
    }

    return {
      exec(sql: string) {
        const vec = /CREATE VIRTUAL TABLE IF NOT EXISTS (\w+)/.exec(sql);
        if (vec) ensureTable(vec[1]!);
        const map = /CREATE TABLE IF NOT EXISTS (\w+_id_map)/.exec(sql);
        if (map) ensureMap(map[1]!);
      },
      prepare(sql: string) {
        return {
          run: (...args: unknown[]) => {
            let m = /^INSERT INTO (\w+)\(rowid, embedding\) VALUES/.exec(sql);
            if (m) {
              ensureTable(m[1]!);
              const [rowid, buf] = args as [number, ArrayBuffer | Buffer];
              tables.get(m[1]!)!.set(rowid, {
                rowid,
                embedding: Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer),
              });
              return;
            }
            m = /^INSERT INTO (\w+_id_map)\(id, rowid\) VALUES/.exec(sql);
            if (m) {
              ensureMap(m[1]!);
              const [id, rowid] = args as [string, number];
              idMaps.get(m[1]!)!.set(id, rowid);
              return;
            }
            m = /^DELETE FROM (\w+_id_map) WHERE id = \?$/.exec(sql);
            if (m) {
              ensureMap(m[1]!);
              idMaps.get(m[1]!)!.delete(args[0] as string);
              return;
            }
            m = /^DELETE FROM (\w+) WHERE rowid = \?$/.exec(sql);
            if (m) {
              ensureTable(m[1]!);
              tables.get(m[1]!)!.delete(args[0] as number);
              return;
            }
          },
          all: (...args: unknown[]) => {
            let m = /^SELECT id, rowid FROM (\w+_id_map)$/.exec(sql);
            if (m) {
              ensureMap(m[1]!);
              return Array.from(idMaps.get(m[1]!)!.entries()).map(([id, rowid]) => ({
                id,
                rowid,
              }));
            }
            m = /^SELECT rowid, distance FROM (\w+) WHERE embedding MATCH/.exec(sql);
            if (m) {
              ensureTable(m[1]!);
              const k = (args[1] as number) ?? 10;
              return Array.from(tables.get(m[1]!)!.values())
                .map(r => ({ rowid: r.rowid, distance: 0 }))
                .slice(0, k);
            }
            return [];
          },
          get: (..._args: unknown[]) => {
            const m = /^SELECT COALESCE\(MAX\(rowid\), 0\) AS maxRow FROM (\w+_id_map)$/.exec(
              sql,
            );
            if (m) {
              ensureMap(m[1]!);
              const rows = Array.from(idMaps.get(m[1]!)!.values());
              const maxRow = rows.length === 0 ? 0 : Math.max(...rows);
              return { maxRow };
            }
            return undefined;
          },
        };
      },
      _tables: tables,
      _idMaps: idMaps,
    };
  }

  it('round-trips id<->rowid across a simulated restart and does not collide', async () => {
    const { SqliteVecHnsw } = await import('../../src/memory/embedding/hnsw.js');
    const db = makeFakeDb();
    const idx1 = new SqliteVecHnsw(db as never, 'vidx', 4);
    idx1.upsert('alpha', [1, 0, 0, 0]);
    idx1.upsert('beta', [0, 1, 0, 0]);
    idx1.upsert('gamma', [0, 0, 1, 0]);
    expect(idx1.size()).toBe(3);

    // Simulate process restart: drop the wrapper, keep DB state.
    const idx2 = new SqliteVecHnsw(db as never, 'vidx', 4);
    expect(idx2.size()).toBe(3);

    // New inserts must NOT collide with rowids 1..3.
    idx2.upsert('delta', [0, 0, 0, 1]);
    expect(idx2.size()).toBe(4);
    const rowids = Array.from(db._tables.get('vidx')!.keys()).sort((a, b) => a - b);
    expect(new Set(rowids).size).toBe(rowids.length); // no duplicates
    expect(rowids).toEqual([1, 2, 3, 4]);

    // Existing ids are still searchable.
    const results = idx2.search([1, 0, 0, 0], 10);
    const ids = new Set(results.map(r => r.id));
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
    expect(ids).toContain('gamma');
    expect(ids).toContain('delta');
  });

  it('upsert of an existing id reuses the same rowid (idempotent)', async () => {
    const { SqliteVecHnsw } = await import('../../src/memory/embedding/hnsw.js');
    const db = makeFakeDb();
    const idx = new SqliteVecHnsw(db as never, 'vidx', 4);
    idx.upsert('alpha', [1, 0, 0, 0]);
    const before = db._idMaps.get('vidx_id_map')!.get('alpha');
    idx.upsert('alpha', [0, 1, 0, 0]);
    const after = db._idMaps.get('vidx_id_map')!.get('alpha');
    expect(after).toBe(before);
    expect(idx.size()).toBe(1);
  });
});

describe('Model integrity verification', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aistack-model-'));
  });

  function writeFakeOnnx(dir: string, content: Buffer): string {
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'model.onnx');
    writeFileSync(f, content);
    return f;
  }

  it('hashModelOnDisk produces a stable, content-sensitive digest', async () => {
    const { hashModelOnDisk } = await import('../../src/memory/embedding/wasm/index.js');
    writeFakeOnnx(tmp, Buffer.from('hello-onnx'));
    const h1 = hashModelOnDisk(tmp);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // Same content -> same hash.
    expect(hashModelOnDisk(tmp)).toBe(h1);
    // Different content -> different hash.
    writeFakeOnnx(tmp, Buffer.from('different-onnx'));
    expect(hashModelOnDisk(tmp)).not.toBe(h1);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('predownloadModel rejects non-default modelId without expectedSha256', async () => {
    process.env['AISTACK_MODELS_DIR'] = tmp;
    const { predownloadModel } = await import('../../src/memory/embedding/wasm/index.js');
    await expect(predownloadModel('Xenova/some-other-model')).rejects.toThrow(
      /expectedSha256/,
    );
    delete process.env['AISTACK_MODELS_DIR'];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('predownloadModel rejects on SHA-256 mismatch and removes bad bytes', async () => {
    process.env['AISTACK_MODELS_DIR'] = tmp;
    // The mocked pipeline does NOT write any files itself, so plant an ONNX
    // first to simulate what `@xenova/transformers` would have cached, then
    // pin a SHA that doesn't match.
    const modelDir = join(tmp, 'Xenova/all-MiniLM-L6-v2');
    const onnxPath = writeFakeOnnx(modelDir, Buffer.from('real-bytes'));
    const wrongSha = createHash('sha256').update('different').digest('hex');
    const { predownloadModel } = await import('../../src/memory/embedding/wasm/index.js');
    await expect(
      predownloadModel('Xenova/all-MiniLM-L6-v2', { expectedSha256: wrongSha }),
    ).rejects.toThrow(/integrity check failed/);
    // Bad bytes should have been deleted.
    expect(existsSync(onnxPath)).toBe(false);
    delete process.env['AISTACK_MODELS_DIR'];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('predownloadModel accepts a matching SHA-256 pin', async () => {
    process.env['AISTACK_MODELS_DIR'] = tmp;
    const modelDir = join(tmp, 'Xenova/all-MiniLM-L6-v2');
    writeFakeOnnx(modelDir, Buffer.from('real-bytes'));
    const { predownloadModel, hashModelOnDisk } = await import(
      '../../src/memory/embedding/wasm/index.js'
    );
    const sha = hashModelOnDisk(modelDir);
    await expect(
      predownloadModel('Xenova/all-MiniLM-L6-v2', { expectedSha256: sha }),
    ).resolves.toBe(tmp);
    delete process.env['AISTACK_MODELS_DIR'];
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('Recall@10 floor (fixture corpus)', () => {
  /**
   * Builds two providers that map deterministically from text -> vector and
   * asserts the recall@10 of a "candidate" provider against a "baseline"
   * provider on a tiny fixture. The two providers here share semantics
   * (token-bag projection) so recall should be perfect, validating the test
   * harness itself. The benchmark file applies the same harness against the
   * real wasm-local provider.
   */
  function tokenBagProvider(name: string, dims: number, salt: number) {
    return {
      model: name,
      dimensions: dims,
      async embed(text: string): Promise<number[]> {
        const vec = new Array<number>(dims).fill(0);
        for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
          let h = 2166136261 ^ salt;
          for (let i = 0; i < tok.length; i++) {
            h ^= tok.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          vec[Math.abs(h) % dims]! += 1;
        }
        let norm = 0;
        for (const v of vec) norm += v * v;
        norm = Math.sqrt(norm) || 1;
        return vec.map(v => v / norm);
      },
      async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
      },
    };
  }

  it('candidate provider clears baseline recall - 10pp on synthetic corpus', async () => {
    const { cosineSimilarity } = await import('../../src/utils/embeddings.js');
    const topics = ['vector', 'agent', 'memory', 'index', 'cosine', 'storage'];
    const docs: string[] = [];
    for (let i = 0; i < 60; i++) {
      docs.push(
        `doc ${i} about ${topics[i % topics.length]} and ${topics[(i * 3) % topics.length]}`,
      );
    }
    const queries = topics.map((t, i) => `query ${i} about ${t}`);
    const baseline = tokenBagProvider('baseline', 256, 0);
    const candidate = tokenBagProvider('candidate', 256, 0); // same salt -> identical
    const baseDocs = await baseline.embedBatch(docs);
    const candDocs = await candidate.embedBatch(docs);
    let hits = 0;
    let total = 0;
    for (const q of queries) {
      const bq = await baseline.embed(q);
      const cq = await candidate.embed(q);
      const truth = new Set(
        baseDocs
          .map((v, i) => ({ i, s: cosineSimilarity(bq, v) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, 10)
          .map(x => x.i),
      );
      const pred = candDocs
        .map((v, i) => ({ i, s: cosineSimilarity(cq, v) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 10)
        .map(x => x.i);
      for (const id of pred) if (truth.has(id)) hits++;
      total += truth.size;
    }
    const recall = hits / total;
    expect(recall).toBeGreaterThanOrEqual(0.9); // identical providers -> ~1.0
  });
});
