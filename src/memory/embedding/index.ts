/**
 * Public surface of the new modular embedding subsystem.
 *
 * Existing callers continue to use `src/utils/embeddings.ts`; this module is
 * additive and isolated so AIG-635 / AIG-640 / AIG-651 are not touched.
 */

export * from './providers/index.js';
export * from './hnsw.js';
export {
  WasmEmbedder,
  type WasmEmbedderOptions,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_DIMENSIONS,
  predownloadModel,
  getModelsCacheDir,
} from './wasm/index.js';
