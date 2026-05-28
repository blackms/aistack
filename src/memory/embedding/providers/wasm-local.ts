/**
 * `wasm-local` embedding provider adapter.
 *
 * Implements the existing `EmbeddingProvider` contract from
 * `src/utils/embeddings.ts` on top of the in-process `WasmEmbedder`. Returning
 * `number[]` (rather than `Float32Array`) keeps wire-compatibility with the
 * SQLite storage layer and the cosine-similarity helper without touching any
 * of the existing memory code paths.
 */

import type { EmbeddingProvider } from '../../../utils/embeddings.js';
import { WasmEmbedder, type WasmEmbedderOptions } from '../wasm/embedder.js';
import { DEFAULT_MODEL_DIMENSIONS, DEFAULT_MODEL_ID } from '../wasm/model-loader.js';

export interface WasmLocalProviderOptions extends WasmEmbedderOptions {}

export class WasmLocalEmbeddings implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly embedder: WasmEmbedder;

  constructor(options: WasmLocalProviderOptions = {}) {
    this.model = options.modelId ?? DEFAULT_MODEL_ID;
    this.dimensions = options.dimensions ?? DEFAULT_MODEL_DIMENSIONS;
    this.embedder = new WasmEmbedder(options);
  }

  async embed(text: string): Promise<number[]> {
    const vec = await this.embedder.embed(text);
    return Array.from(vec);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const vecs = await this.embedder.embedBatch(texts);
    return vecs.map(v => Array.from(v));
  }
}
