/**
 * Barrel for the WASM-native embedding implementation.
 */
export {
  WasmEmbedder,
  type WasmEmbedderOptions,
  DEFAULT_BATCH_CHUNK_SIZE,
  DEFAULT_WASM_MEMORY_CAP_MIB,
} from './embedder.js';
export {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_DIMENSIONS,
  getModelsCacheDir,
  predownloadModel,
  hashModelOnDisk,
  loadTransformersLibrary,
  type FeatureExtractionPipeline,
  type TransformersLibrary,
  type PredownloadOptions,
} from './model-loader.js';
