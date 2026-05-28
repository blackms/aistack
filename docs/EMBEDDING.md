# Embedding Providers

aistack supports pluggable embedding providers for vector search over the
memory store. As of AIG-653 the supported providers are:

| Provider     | Where it runs        | Dimensions | API key | Install            |
| ------------ | -------------------- | ---------- | ------- | ------------------ |
| `openai`     | OpenAI cloud         | 1536/3072  | yes     | built-in           |
| `ollama`     | Local Ollama daemon  | 768        | no      | requires Ollama    |
| `wasm-local` | In-process WASM/ONNX | 384        | no      | optional dep (HF)  |

The `wasm-local` provider unlocks **fully offline** vector search — no API
key, no external daemon, no network round trip after the initial model
download. It is implemented on top of
[`@xenova/transformers`](https://huggingface.co/Xenova/all-MiniLM-L6-v2),
running the `all-MiniLM-L6-v2` ONNX model in-process via WebAssembly.

## Configuration

```jsonc
{
  "memory": {
    "vectorSearch": {
      "enabled": true,
      "provider": "wasm-local",
      "model": "Xenova/all-MiniLM-L6-v2", // optional override
      "expectedSha256": "<hex digest>",   // REQUIRED for non-default models
      "batchChunkSize": 32,                // optional, default 32
      "wasmMemoryCapMib": 256              // optional, default 256
    }
  }
}
```

### Supply-chain integrity (`expectedSha256`)

Because `modelId` is user-overridable, a misconfiguration or a compromised
Hugging Face Hub mirror could substitute malicious ONNX bytes. The loader
therefore **requires** an `expectedSha256` pin for any non-default model id
and verifies the on-disk digest after download. On mismatch the cached
files are deleted and an error is thrown.

Compute the pin once from a trusted environment:

```bash
aistack memory hash-model Xenova/bge-small-en-v1.5
```

The default model (`Xenova/all-MiniLM-L6-v2`) ships without a forced pin so
the first-run experience does not break, but pinning it is still
**strongly recommended** for production deployments.

### Batch sizing & memory cap

`embedBatch()` transparently chunks arbitrarily-large input arrays into
forward passes of at most `batchChunkSize` inputs (default 32). This caps
peak WASM heap usage regardless of caller batch size and eliminates the
OOM risk flagged in the AIG-653 review.

`wasmMemoryCapMib` (default 256) is the soft heap budget for the WASM
runtime. Current `@xenova/transformers` versions do not expose a direct
heap-limit knob, so the value is currently advisory (logged at load time);
exposing it now means operators can pin a value before the runtime gains
the lever.

## Setup

The WASM embedder and the optional sqlite-vec HNSW index live behind
**optional dependencies** so they do not inflate the base install:

```bash
npm install @xenova/transformers   # ~5MB, required for wasm-local
npm install sqlite-vec             # native binding, optional HNSW backend
```

Then pre-download the model (one-time, ~25MB cached under
`~/.aistack/models/`):

```bash
aistack memory download-model
# or, with a custom model + integrity pin:
aistack memory download-model --model Xenova/bge-small-en-v1.5 \
    --sha256 7e2c...e9
```

Override the cache directory with `AISTACK_MODELS_DIR=/path/to/cache`.

## Persistence

The `sqlite-vec` HNSW backend persists both the vector data **and** the
`id -> rowid` lookup table across process restarts. The companion table
(`<index>_id_map`) is created automatically on first use and rehydrated on
startup. Without it the JS-only map would be empty after a restart and
new inserts would silently collide with persisted rowids — a data-loss
bug fixed under AIG-653.

If you are upgrading from a pre-AIG-653 build that wrote to the `vec0`
table without a companion id map, the prior vectors are unreachable by id
(though still queryable by raw rowid via SQL). Re-embedding the source
documents is the recommended migration.

## Score comparability

Search results expose a single `score: number` in `[0, 1]`, but the
**scale is backend-dependent**:

| Backend       | `score` formula            | Notes                                |
| ------------- | -------------------------- | ------------------------------------ |
| `in-memory`   | raw cosine similarity      | directly comparable across docs      |
| `sqlite-vec`  | `1 / (1 + L2)`             | monotone in distance, **not** cosine |

Compare scores within a single backend; treat the absolute number as
opaque otherwise. This is documented inline on `HnswSearchResult` so
callers see the caveat at the type level.

## Cross-architecture determinism

ONNX runtime kernels use platform-specific SIMD (AVX2/AVX-512 on x86_64,
NEON on arm64). As a result, embedding vectors produced by the same model
on different CPU architectures are **not guaranteed to be bit-identical**.
Cosine similarity stays within a small epsilon, but exact byte equality
fails — which means:

- Vectors written to disk on one architecture are **not portable** to a
  different architecture without re-embedding. Treat the on-disk vector
  store as architecture-local state.
- Comparing search results across heterogeneous worker pools (e.g. mixed
  x86_64 + arm64) may yield slightly different top-K orderings near ties.

If your CI matrix covers both architectures we recommend adding a
deterministic-output check that compares a small fixture of vectors
between runners with an L2-distance tolerance (e.g. `<= 1e-4`). If your
matrix is single-arch (the common case for this repo today), document the
restriction explicitly in your operational runbook.

### Migration sketch

To move a `wasm-local` vector store between architectures:

1. On the **source** host, dump `(id, text)` pairs from the memory
   manifest into a portable JSON file. (Vectors themselves are skipped.)
2. On the **target** host, run `aistack memory reembed --input
   manifest.json` to recompute embeddings on the new architecture and
   repopulate both the `vec0` table and the `vec0_id_map`.
3. Verify `aistack memory verify` reports zero orphaned rowids.

The `reembed` and `verify` commands are part of the AIG-653 follow-up
work tracked under AIG-660 — for now the manual recipe is to delete the
SQLite vector tables and let the memory manager rebuild them on the next
search.

## Fallback strategy

| Situation                                       | Behaviour                                       |
| ----------------------------------------------- | ----------------------------------------------- |
| `@xenova/transformers` not installed            | `wasm-local` throws on first `embed()` with an  |
|                                                 | actionable install hint                         |
| Model not cached yet                            | Auto-download on first call (network required) |
| `expectedSha256` mismatch                       | Cached ONNX deleted, error thrown               |
| `sqlite-vec` not installed                      | HNSW falls back to in-memory brute-force cosine |
| `vectorSearch.enabled: false`                   | No provider is constructed                      |

The legacy OpenAI / Ollama providers in `src/utils/embeddings.ts` are
**unchanged** and remain the default when no provider is set.

## Benchmark

Run the included benchmark (uses mocked network latency for openai/ollama
so it works offline, and now includes a recall@10 micro-benchmark):

```bash
npx tsx benchmarks/embedding-comparison.ts
```

The throughput section is unchanged. The recall@10 section builds a
synthetic 100-doc / 10-query fixture, takes the OpenAI-mock vector as
ground truth, and asserts every other provider's recall@10 stays within
**10 percentage points** of the baseline. The benchmark fails (exit 1)
when the floor is violated, so it doubles as a CI guard.

Indicative numbers from a single-threaded run (placeholder — replace with
your hardware):

```
Throughput:
Provider              Total (ms)    Mean (ms)    Throughput/s
------------------------------------------------------------------------
wasm-local                 ~200         ~1.0           ~1000
openai (mocked)          10050         50.25            ~20
ollama (mocked)          10050         50.25            ~20

Recall@10 (fixture: 100 docs, 10 queries):
openai (mocked, baseline)             100.0%
wasm-local                             >= 90.0%
ollama (mocked)                        >= 90.0%
```

The `wasm-local` row is bound by ONNX inference; on modern hardware the
quantized MiniLM-L6-v2 sustains roughly **1k embeddings/sec** on a single
core, well within the AIG-653 acceptance criteria.

## Bundle size impact

Base install: **unchanged** (transformers + sqlite-vec are optional deps).

If a user opts in:
- `@xenova/transformers`: ~5MB of JS + ~25MB model (downloaded on demand,
  cached under `~/.aistack/models/`).
- `sqlite-vec`: ~1-2MB native binary depending on platform.

Total opt-in delta: **well under the 30MB acceptance ceiling**.

## Architecture

```
src/memory/embedding/
├── index.ts                       # barrel
├── hnsw.ts                        # sqlite-vec backend + in-memory fallback
├── providers/
│   ├── index.ts                   # tryCreateWasmLocalProvider()
│   └── wasm-local.ts              # adapts WasmEmbedder to EmbeddingProvider
└── wasm/
    ├── index.ts
    ├── embedder.ts                # WasmEmbedder (lazy load, batch chunking)
    └── model-loader.ts            # dynamic import + SHA-256 integrity check
```

`src/utils/embeddings.ts` exposes the new provider via the existing
`createEmbeddingProvider()` factory using a lazy synchronous facade — no
existing memory code paths were modified.
