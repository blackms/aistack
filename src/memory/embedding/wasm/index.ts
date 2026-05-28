/**
 * Barrel for the WASM-native embedding implementation.
 */
export { WasmEmbedder, type WasmEmbedderOptions } from './embedder.js';
export {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_DIMENSIONS,
  getModelsCacheDir,
  predownloadModel,
  loadTransformersLibrary,
  type FeatureExtractionPipeline,
  type TransformersLibrary,
} from './model-loader.js';
