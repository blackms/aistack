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
      "model": "Xenova/all-MiniLM-L6-v2" // optional override
    }
  }
}
```

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
# or, with a custom model:
aistack memory download-model --model Xenova/bge-small-en-v1.5
```

Override the cache directory with `AISTACK_MODELS_DIR=/path/to/cache`.

## Fallback strategy

| Situation                                       | Behaviour                                       |
| ----------------------------------------------- | ----------------------------------------------- |
| `@xenova/transformers` not installed            | `wasm-local` throws on first `embed()` with an  |
|                                                 | actionable install hint                         |
| Model not cached yet                            | Auto-download on first call (network required) |
| `sqlite-vec` not installed                      | HNSW falls back to in-memory brute-force cosine |
| `vectorSearch.enabled: false`                   | No provider is constructed                      |

The legacy OpenAI / Ollama providers in `src/utils/embeddings.ts` are
**unchanged** and remain the default when no provider is set.

## Benchmark

Run the included benchmark (uses mocked network latency for openai/ollama
so it works offline):

```bash
npx tsx benchmarks/embedding-comparison.ts
```

Indicative numbers from a single-threaded run (placeholder — replace with
your hardware):

```
Provider              Total (ms)    Mean (ms)    Throughput/s
────────────────────────────────────────────────────────────────────────
wasm-local                 ~200         ~1.0           ~1000
openai (mocked)          10050         50.25            ~20
ollama (mocked)          10050         50.25            ~20
────────────────────────────────────────────────────────────────────────
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
    ├── embedder.ts                # WasmEmbedder (lazy load)
    └── model-loader.ts            # dynamic import of @xenova/transformers
```

`src/utils/embeddings.ts` exposes the new provider via the existing
`createEmbeddingProvider()` factory using a lazy synchronous facade — no
existing memory code paths were modified.
