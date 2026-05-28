/**
 * In-process WASM embedder built on top of `@xenova/transformers`.
 *
 * Loads the ONNX model lazily on the first `embed()` call to avoid paying the
 * model-load cost (typically 25-30MB + initialization) when the WASM provider
 * is configured but never actually used (e.g., during CLI commands that do not
 * touch memory search).
 *
 * The class is intentionally minimal and provider-agnostic — it returns
 * `Float32Array` so callers can convert to `number[]` only when required by
 * the existing `EmbeddingProvider` interface.
 */

import { logger } from '../../../utils/logger.js';
import {
  DEFAULT_MODEL_DIMENSIONS,
  DEFAULT_MODEL_ID,
  getModelsCacheDir,
  hashModelOnDisk,
  loadTransformersLibrary,
  type FeatureExtractionPipeline,
} from './model-loader.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const log = logger.child('wasm-embedder');

/** Default internal chunk size for batch embedding. Keeps a single forward
 *  pass well within the default WASM memory cap on 384-dim MiniLM. */
export const DEFAULT_BATCH_CHUNK_SIZE = 32;

/** Default WASM heap cap exposed via config. Sized for the quantized
 *  MiniLM-L6-v2 model plus reasonable batch headroom. */
export const DEFAULT_WASM_MEMORY_CAP_MIB = 256;

export interface WasmEmbedderOptions {
  modelId?: string;
  dimensions?: number;
  /** If true, normalize to unit length so cosine similarity == dot product. */
  normalize?: boolean;
  /**
   * Maximum inputs forwarded to the ONNX pipeline in a single call. Larger
   * batches amortize tokenization overhead but increase peak WASM heap; the
   * default of 32 keeps a single forward pass well under the 256 MiB heap
   * cap for 384-dim MiniLM. Callers passing arbitrarily-large arrays to
   * `embedBatch()` get transparent chunking, eliminating the OOM risk
   * flagged by the AIG-653 review.
   */
  batchChunkSize?: number;
  /**
   * Soft cap on the WASM heap in MiB. Recorded for telemetry / future
   * runtime enforcement — current `@xenova/transformers` versions do not
   * expose a direct heap-limit knob, but exposing the config now means
   * operators can pin a value before the runtime gains the lever.
   */
  wasmMemoryCapMib?: number;
  /**
   * SHA-256 pin over the on-disk ONNX bytes for `modelId`. When set, the
   * loader verifies the digest after the (cached) model is materialised and
   * refuses to serve embeddings on mismatch. Required for any non-default
   * `modelId` unless explicitly waived at the `predownloadModel` site.
   */
  expectedSha256?: string;
}

export class WasmEmbedder {
  readonly modelId: string;
  readonly dimensions: number;
  readonly batchChunkSize: number;
  readonly wasmMemoryCapMib: number;
  private readonly normalize: boolean;
  private readonly expectedSha256?: string;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(options: WasmEmbedderOptions = {}) {
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.dimensions = options.dimensions ?? DEFAULT_MODEL_DIMENSIONS;
    this.normalize = options.normalize ?? true;
    const chunk = options.batchChunkSize ?? DEFAULT_BATCH_CHUNK_SIZE;
    this.batchChunkSize = chunk > 0 ? Math.floor(chunk) : DEFAULT_BATCH_CHUNK_SIZE;
    this.wasmMemoryCapMib = options.wasmMemoryCapMib ?? DEFAULT_WASM_MEMORY_CAP_MIB;
    if (options.expectedSha256) this.expectedSha256 = options.expectedSha256;
  }

  /**
   * Whether the optional `@xenova/transformers` dependency is available.
   *
   * Lightweight probe used by the provider factory to decide whether to
   * register the WASM provider at all.
   */
  static async isAvailable(): Promise<boolean> {
    const lib = await loadTransformersLibrary();
    return lib !== null;
  }

  /**
   * Lazily initialize the pipeline. Concurrent callers share the same Promise.
   */
  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (this.pipelinePromise) return this.pipelinePromise;
    this.pipelinePromise = (async () => {
      const lib = await loadTransformersLibrary();
      if (!lib) {
        throw new Error(
          'WASM embedder unavailable: optional dependency `@xenova/transformers` not installed. ' +
            'Run `npm install @xenova/transformers` and `aistack memory download-model` to enable.',
        );
      }
      lib.env.cacheDir = getModelsCacheDir();
      log.info('Loading WASM embedding pipeline', {
        modelId: this.modelId,
        cacheDir: lib.env.cacheDir,
        wasmMemoryCapMib: this.wasmMemoryCapMib,
      });
      const pipeline = await lib.pipeline('feature-extraction', this.modelId, {
        quantized: true,
      });
      // Verify integrity AFTER the pipeline materialises the ONNX files so
      // the digest covers what is actually on disk. Skipped (with a warn)
      // when no files exist yet — the loader path may have streamed without
      // persisting in some `@xenova/transformers` configurations.
      if (this.expectedSha256) {
        const dir = join(lib.env.cacheDir ?? getModelsCacheDir(), this.modelId);
        const target = existsSync(dir) ? dir : (lib.env.cacheDir ?? getModelsCacheDir());
        try {
          const actual = hashModelOnDisk(target);
          if (actual.toLowerCase() !== this.expectedSha256.toLowerCase()) {
            throw new Error(
              `WASM model integrity check failed for '${this.modelId}': ` +
                `expected SHA-256 ${this.expectedSha256} but got ${actual}. ` +
                `Refusing to serve embeddings from un-pinned bytes.`,
            );
          }
          log.info('WASM model integrity verified at load', {
            modelId: this.modelId,
          });
        } catch (err) {
          // Reset so a subsequent call can retry once the cache is rebuilt.
          this.pipelinePromise = null;
          throw err;
        }
      }
      return pipeline;
    })();
    return this.pipelinePromise;
  }

  /**
   * Embed a single text and return a Float32Array of size `dimensions`.
   */
  async embed(text: string): Promise<Float32Array> {
    const pipeline = await this.getPipeline();
    const output = await pipeline(text, { pooling: 'mean', normalize: this.normalize });
    return output.data;
  }

  /**
   * Embed multiple texts. Internally chunks the request into batches of at
   * most `batchChunkSize` inputs so peak WASM heap stays bounded regardless
   * of caller batch size.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipeline = await this.getPipeline();
    const out: Float32Array[] = new Array(texts.length);
    const chunk = this.batchChunkSize;
    for (let start = 0; start < texts.length; start += chunk) {
      const slice = texts.slice(start, start + chunk);
      const output = await pipeline(slice, { pooling: 'mean', normalize: this.normalize });
      const dims = output.dims;
      const stride = dims[dims.length - 1] ?? this.dimensions;
      for (let i = 0; i < slice.length; i++) {
        out[start + i] = output.data.slice(i * stride, (i + 1) * stride);
      }
    }
    return out;
  }
}
