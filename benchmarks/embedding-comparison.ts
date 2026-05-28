/**
 * Benchmark: wasm-local vs OpenAI vs Ollama embedding throughput & latency.
 *
 * Run with: `npx tsx benchmarks/embedding-comparison.ts`
 *
 * The OpenAI / Ollama providers are mocked here so the benchmark is fully
 * offline and reproducible in CI. Replace `MOCK_NETWORK_LATENCY_MS` with the
 * real provider classes to get production numbers.
 */

import { performance } from 'node:perf_hooks';
import type { EmbeddingProvider } from '../src/utils/embeddings.js';

const SAMPLE_TEXTS = [
  'AIG-653 introduces WASM-native embeddings for offline operation.',
  'Cosine similarity between vectors is dot-product over magnitudes.',
  'HNSW provides log-time approximate nearest neighbour search.',
  'aistack orchestrates multiple agents over Claude Code.',
  'Memory tiers split hot, warm and cold storage by access frequency.',
];

const ITERATIONS = 200; // total embeddings per provider
const MOCK_NETWORK_LATENCY_MS = 50; // simulated round-trip for cloud APIs

function makeMockNetworkProvider(name: string, dims: number): EmbeddingProvider {
  return {
    model: name,
    dimensions: dims,
    async embed(text: string): Promise<number[]> {
      await sleep(MOCK_NETWORK_LATENCY_MS);
      const vec = new Array<number>(dims);
      for (let i = 0; i < dims; i++) vec[i] = ((text.length + i) % 17) / 17;
      return vec;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      await sleep(MOCK_NETWORK_LATENCY_MS);
      return texts.map(t => {
        const vec = new Array<number>(dims);
        for (let i = 0; i < dims; i++) vec[i] = ((t.length + i) % 17) / 17;
        return vec;
      });
    },
  };
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

async function main(): Promise<void> {
  console.log(`Benchmarking ${ITERATIONS} embeddings per provider...\n`);

  const results: BenchResult[] = [];

  // wasm-local (real, but won't actually load model unless dep is present —
  // catches the InstallHint error and downgrades the row to a "skipped" entry)
  try {
    const { WasmEmbedder } = await import('../src/memory/embedding/wasm/index.js');
    const wasm = new WasmEmbedder();
    const adapter: EmbeddingProvider = {
      model: wasm.modelId,
      dimensions: wasm.dimensions,
      embed: async (t: string) => Array.from(await wasm.embed(t)),
      embedBatch: async (ts: string[]) =>
        (await wasm.embedBatch(ts)).map(v => Array.from(v)),
    };
    results.push(await bench('wasm-local', adapter));
  } catch (err) {
    console.log(
      `wasm-local SKIPPED (${err instanceof Error ? err.message : String(err)})\n`,
    );
  }

  results.push(await bench('openai (mocked)', makeMockNetworkProvider('openai-mock', 1536)));
  results.push(await bench('ollama (mocked)', makeMockNetworkProvider('ollama-mock', 768)));

  console.log('Results:');
  console.log('─'.repeat(72));
  console.log(
    'Provider'.padEnd(20) +
      'Total (ms)'.padStart(14) +
      'Mean (ms)'.padStart(14) +
      'Throughput/s'.padStart(18),
  );
  console.log('─'.repeat(72));
  for (const r of results) {
    console.log(
      r.provider.padEnd(20) +
        r.totalMs.toFixed(1).padStart(14) +
        r.meanMs.toFixed(2).padStart(14) +
        r.throughputPerSec.toFixed(1).padStart(18),
    );
  }
  console.log('─'.repeat(72));
  console.log(
    '\nNote: openai/ollama rows use a mocked 50ms network latency. Replace ' +
      'with real providers to capture production numbers.',
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
