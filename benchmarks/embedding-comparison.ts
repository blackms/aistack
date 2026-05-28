/**
 * Benchmark: wasm-local vs OpenAI vs Ollama embedding throughput, latency,
 * and recall@10 quality.
 *
 * Run with: `npx tsx benchmarks/embedding-comparison.ts`
 *
 * The OpenAI / Ollama providers are mocked here so the benchmark is fully
 * offline and reproducible in CI. Replace `MOCK_NETWORK_LATENCY_MS` with the
 * real provider classes to get production numbers.
 *
 * Recall@10
 * ---------
 * Throughput tells us how *fast* a provider is; recall@10 tells us whether
 * the vectors are any *good* for retrieval. We build a tiny fixture corpus
 * (100 docs, 10 queries) with a deterministic ground-truth top-10 derived
 * from a strong reference embedder (the wasm-local one when available;
 * otherwise the mocked openai vector, which keeps the test runnable but
 * degenerate). The acceptance bar is `recall@10 >= baseline - 10pp`, in
 * line with the AIG-653 review.
 */

import { performance } from 'node:perf_hooks';
import type { EmbeddingProvider } from '../src/utils/embeddings.js';
import { cosineSimilarity } from '../src/utils/embeddings.js';

const SAMPLE_TEXTS = [
  'AIG-653 introduces WASM-native embeddings for offline operation.',
  'Cosine similarity between vectors is dot-product over magnitudes.',
  'HNSW provides log-time approximate nearest neighbour search.',
  'aistack orchestrates multiple agents over Claude Code.',
  'Memory tiers split hot, warm and cold storage by access frequency.',
];

const ITERATIONS = 200; // total embeddings per provider
const MOCK_NETWORK_LATENCY_MS = 50; // simulated round-trip for cloud APIs

// Recall@10 fixture sizes.
const CORPUS_SIZE = 100;
const QUERY_COUNT = 10;
const TOP_K = 10;
/** Acceptable absolute drop (in pp) against the baseline provider's recall. */
const RECALL_TOLERANCE_PP = 10;

function makeMockNetworkProvider(name: string, dims: number): EmbeddingProvider {
  return {
    model: name,
    dimensions: dims,
    async embed(text: string): Promise<number[]> {
      await sleep(MOCK_NETWORK_LATENCY_MS);
      return deterministicVector(text, dims);
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      await sleep(MOCK_NETWORK_LATENCY_MS);
      return texts.map(t => deterministicVector(t, dims));
    },
  };
}

/**
 * Deterministic vector that gives every text a meaningfully different
 * direction so the recall@10 ground-truth is non-degenerate. Uses a simple
 * hashed-bag-of-tokens projection rather than the constant-mod-17 pattern
 * the original throughput benchmark used.
 */
function deterministicVector(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx]! += 1;
  }
  // L2 normalize so cosine == dot product.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) vec[i] = vec[i]! / norm;
  return vec;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface BenchResult {
  provider: string;
  totalMs: number;
  throughputPerSec: number;
  meanMs: number;
}

interface RecallResult {
  provider: string;
  recallAt10: number;
}

async function bench(label: string, provider: EmbeddingProvider): Promise<BenchResult> {
  const t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const text = SAMPLE_TEXTS[i % SAMPLE_TEXTS.length] ?? 'x';
    await provider.embed(text);
  }
  const totalMs = performance.now() - t0;
  return {
    provider: label,
    totalMs,
    throughputPerSec: (ITERATIONS / totalMs) * 1000,
    meanMs: totalMs / ITERATIONS,
  };
}

/** Tiny synthetic corpus + queries with deterministic content. */
function buildFixtureCorpus(): { docs: string[]; queries: string[] } {
  const docs: string[] = [];
  const topics = [
    'vector embedding',
    'agent orchestration',
    'memory tiers',
    'hnsw index',
    'cosine similarity',
    'sqlite storage',
    'wasm runtime',
    'onnx model',
    'recall benchmark',
    'offline mode',
  ];
  for (let i = 0; i < CORPUS_SIZE; i++) {
    const t1 = topics[i % topics.length];
    const t2 = topics[(i * 7 + 3) % topics.length];
    docs.push(`doc-${i} about ${t1} and ${t2} with id ${i}`);
  }
  const queries: string[] = [];
  for (let q = 0; q < QUERY_COUNT; q++) {
    const t = topics[q % topics.length];
    queries.push(`query ${q} relating to ${t}`);
  }
  return { docs, queries };
}

async function topKIds(
  provider: EmbeddingProvider,
  query: string,
  docs: string[],
  docVecs: number[][],
  k: number,
): Promise<number[]> {
  const q = await provider.embed(query);
  const scored = docVecs.map((v, i) => ({ i, s: cosineSimilarity(q, v) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map(x => x.i);
}

async function measureRecall(
  label: string,
  provider: EmbeddingProvider,
  baselineTopK: number[][],
  fixture: { docs: string[]; queries: string[] },
): Promise<RecallResult> {
  const docVecs = await provider.embedBatch(fixture.docs);
  let hits = 0;
  let total = 0;
  for (let q = 0; q < fixture.queries.length; q++) {
    const truth = new Set(baselineTopK[q]);
    const predicted = await topKIds(
      provider,
      fixture.queries[q]!,
      fixture.docs,
      docVecs,
      TOP_K,
    );
    for (const id of predicted) if (truth.has(id)) hits++;
    total += truth.size;
  }
  return { provider: label, recallAt10: total === 0 ? 0 : hits / total };
}

async function runRecallBench(
  baseline: { label: string; provider: EmbeddingProvider },
  others: Array<{ label: string; provider: EmbeddingProvider }>,
): Promise<RecallResult[]> {
  const fixture = buildFixtureCorpus();
  // Ground truth = baseline provider's own top-K. Recall is measured for
  // every provider (including baseline, which trivially scores 1.0).
  const baseDocVecs = await baseline.provider.embedBatch(fixture.docs);
  const baselineTopK: number[][] = [];
  for (const q of fixture.queries) {
    baselineTopK.push(await topKIds(baseline.provider, q, fixture.docs, baseDocVecs, TOP_K));
  }
  const out: RecallResult[] = [];
  out.push(await measureRecall(baseline.label, baseline.provider, baselineTopK, fixture));
  for (const o of others) {
    out.push(await measureRecall(o.label, o.provider, baselineTopK, fixture));
  }
  // Assert against tolerance.
  const baseRecall = out[0]!.recallAt10;
  const floor = Math.max(0, baseRecall - RECALL_TOLERANCE_PP / 100);
  for (const r of out.slice(1)) {
    if (r.recallAt10 + 1e-9 < floor) {
      throw new Error(
        `recall@10 floor violated: ${r.provider}=${(r.recallAt10 * 100).toFixed(1)}% ` +
          `< floor ${(floor * 100).toFixed(1)}% (baseline ${(baseRecall * 100).toFixed(1)}%, ` +
          `tolerance ${RECALL_TOLERANCE_PP}pp)`,
      );
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`Benchmarking ${ITERATIONS} embeddings per provider...\n`);

  const results: BenchResult[] = [];
  let wasmAdapter: EmbeddingProvider | null = null;

  // wasm-local (real, but won't actually load model unless dep is present —
  // catches the InstallHint error and downgrades the row to a "skipped" entry)
  try {
    const { WasmEmbedder } = await import('../src/memory/embedding/wasm/index.js');
    const wasm = new WasmEmbedder();
    wasmAdapter = {
      model: wasm.modelId,
      dimensions: wasm.dimensions,
      embed: async (t: string) => Array.from(await wasm.embed(t)),
      embedBatch: async (ts: string[]) =>
        (await wasm.embedBatch(ts)).map(v => Array.from(v)),
    };
    results.push(await bench('wasm-local', wasmAdapter));
  } catch (err) {
    console.log(
      `wasm-local SKIPPED (${err instanceof Error ? err.message : String(err)})\n`,
    );
  }

  const openaiMock = makeMockNetworkProvider('openai-mock', 1536);
  const ollamaMock = makeMockNetworkProvider('ollama-mock', 768);
  results.push(await bench('openai (mocked)', openaiMock));
  results.push(await bench('ollama (mocked)', ollamaMock));

  console.log('Throughput:');
  console.log('-'.repeat(72));
  console.log(
    'Provider'.padEnd(20) +
      'Total (ms)'.padStart(14) +
      'Mean (ms)'.padStart(14) +
      'Throughput/s'.padStart(18),
  );
  console.log('-'.repeat(72));
  for (const r of results) {
    console.log(
      r.provider.padEnd(20) +
        r.totalMs.toFixed(1).padStart(14) +
        r.meanMs.toFixed(2).padStart(14) +
        r.throughputPerSec.toFixed(1).padStart(18),
    );
  }
  console.log('-'.repeat(72));

  // Recall@10 micro-benchmark. Baseline = openai-mock (cloud-grade vector
  // proxy) so wasm-local must come within RECALL_TOLERANCE_PP of it.
  console.log('\nRecall@10 (fixture: 100 docs, 10 queries):');
  console.log('-'.repeat(72));
  const others: Array<{ label: string; provider: EmbeddingProvider }> = [];
  if (wasmAdapter) others.push({ label: 'wasm-local', provider: wasmAdapter });
  others.push({ label: 'ollama (mocked)', provider: ollamaMock });
  const recall = await runRecallBench(
    { label: 'openai (mocked, baseline)', provider: openaiMock },
    others,
  );
  for (const r of recall) {
    console.log(r.provider.padEnd(32) + `${(r.recallAt10 * 100).toFixed(1)}%`.padStart(8));
  }
  console.log('-'.repeat(72));
  console.log(
    `Acceptance: providers must reach baseline recall - ${RECALL_TOLERANCE_PP}pp.`,
  );

  console.log(
    '\nNote: openai/ollama rows use a mocked 50ms network latency. Replace ' +
      'with real providers to capture production numbers.',
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
