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
  loadTransformersLibrary,
  type FeatureExtractionPipeline,
} from './model-loader.js';

const log = logger.child('wasm-embedder');

export interface WasmEmbedderOptions {
  modelId?: string;
  dimensions?: number;
  /** If true, normalize to unit length so cosine similarity == dot product. */
  normalize?: boolean;
}

export class WasmEmbedder {
  readonly modelId: string;
  readonly dimensions: number;
  private readonly normalize: boolean;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(options: WasmEmbedderOptions = {}) {
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.dimensions = options.dimensions ?? DEFAULT_MODEL_DIMENSIONS;
    this.normalize = options.normalize ?? true;
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
      });
      return lib.pipeline('feature-extraction', this.modelId, { quantized: true });
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
   * Embed multiple texts. Uses pipeline batching when supported.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipeline = await this.getPipeline();
    const output = await pipeline(texts, { pooling: 'mean', normalize: this.normalize });
    const dims = output.dims;
    const stride = dims[dims.length - 1] ?? this.dimensions;
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(output.data.slice(i * stride, (i + 1) * stride));
    }
    return results;
  }
}
