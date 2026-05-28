/**
 * Model loader for WASM-native embeddings.
 *
 * Lazy-downloads ONNX models from the Hugging Face Hub on first use and
 * caches them under `~/.aistack/models/`. The actual download is delegated to
 * `@xenova/transformers` (which is an optional dependency) so we do not ship
 * any binary model files inside the repo.
 *
 * If the optional dependency is not installed, this loader fails fast with a
 * clear, actionable error so the caller can fall back to another provider.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../../utils/logger.js';

const log = logger.child('wasm-model-loader');

export const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const DEFAULT_MODEL_DIMENSIONS = 384;

/**
 * Resolve and ensure the directory used to cache downloaded ONNX models.
 *
 * Defaults to `~/.aistack/models/`. Can be overridden via `AISTACK_MODELS_DIR`.
 */
export function getModelsCacheDir(): string {
  const override = process.env['AISTACK_MODELS_DIR'];
  const dir = override && override.length > 0 ? override : join(homedir(), '.aistack', 'models');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Try to import the optional `@xenova/transformers` dependency.
 *
 * Returns `null` if it is not installed; callers should treat this as an
 * actionable failure and surface a hint to run `aistack memory download-model`.
 */
export async function loadTransformersLibrary(): Promise<TransformersLibrary | null> {
  try {
    // Dynamic import so the optional dep does not break consumers that
    // never opt into the WASM provider.
    const mod = (await import('@xenova/transformers')) as unknown as TransformersLibrary;
    return mod;
  } catch (err) {
    log.debug('Optional dependency @xenova/transformers not installed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Minimal structural type for the subset of `@xenova/transformers` we use.
 *
 * Defined locally so this file compiles even when the optional dependency
 * is absent from `node_modules`.
 */
export interface TransformersLibrary {
  env: {
    cacheDir?: string;
    allowRemoteModels?: boolean;
    allowLocalModels?: boolean;
  };
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<FeatureExtractionPipeline>;
}

export interface FeatureExtractionPipeline {
  (
    text: string | string[],
    options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
  ): Promise<{ data: Float32Array; dims: number[] }>;
}

/**
 * Predownload the model so the first runtime call does not pay the network
 * cost. Used by `aistack memory download-model`.
 *
 * Returns the absolute cache directory on success or throws an Error with
 * a hint on how to install the optional dependency.
 */
export async function predownloadModel(modelId: string = DEFAULT_MODEL_ID): Promise<string> {
  const lib = await loadTransformersLibrary();
  if (!lib) {
    throw new Error(
      'WASM embedding requires the optional dependency `@xenova/transformers`. ' +
        'Install it with `npm install @xenova/transformers` and retry.',
    );
  }

  const cacheDir = getModelsCacheDir();
  lib.env.cacheDir = cacheDir;
  lib.env.allowRemoteModels = true;
  log.info('Pre-downloading WASM embedding model', { modelId, cacheDir });

  // Instantiating the pipeline triggers the download + caching.
  await lib.pipeline('feature-extraction', modelId, { quantized: true });
  return cacheDir;
}
