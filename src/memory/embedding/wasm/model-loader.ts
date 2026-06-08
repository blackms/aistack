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
 *
 * **Supply-chain integrity**: the `modelId` is user-overridable via config
 * and CLI, so a misconfiguration or compromised Hugging Face Hub mirror could
 * substitute a malicious ONNX. When `expectedSha256` is provided, every ONNX
 * file written under the cache directory is hashed and compared after the
 * download finishes; any mismatch deletes the bad bytes and throws.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
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
    // never opt into the WASM provider. The specifier is held in a variable on
    // purpose: a non-literal argument stops `tsc` from statically resolving the
    // optional module, so the build (e.g. the pruned on-prem Docker image where
    // @xenova/transformers is absent) does not fail with TS2307. Availability is
    // handled at runtime by the surrounding try/catch.
    const specifier = '@xenova/transformers';
    const mod = (await import(specifier)) as unknown as TransformersLibrary;
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

export interface PredownloadOptions {
  /**
   * Pin a SHA-256 over the concatenation (in deterministic on-disk order)
   * of every ONNX file the loader writes under the cache directory for this
   * model. Required for *any* non-default model id; recommended for the
   * default to harden against a compromised Hub mirror.
   *
   * Compute once with `aistack memory hash-model <modelId>` (or the helper
   * `hashModelOnDisk()` exported from this module) and pin in config.
   */
  expectedSha256?: string;
  /**
   * If `true`, allow downloading a model with no pinned hash. Defaults to
   * `false` for non-default models — flipping this to `true` requires the
   * operator to explicitly accept the supply-chain risk.
   */
  allowUnpinned?: boolean;
}

/**
 * Compute a deterministic SHA-256 over every `.onnx` file written under the
 * given model cache directory. Files are hashed in lexicographic relative
 * path order so the digest is stable across platforms.
 *
 * Exported so operators can pin a hash via `aistack memory hash-model`.
 */
export function hashModelOnDisk(modelDir: string): string {
  if (!existsSync(modelDir)) {
    throw new Error(`Model directory does not exist: ${modelDir}`);
  }
  const files = collectOnnxFiles(modelDir).sort();
  if (files.length === 0) {
    throw new Error(`No .onnx files found under ${modelDir}`);
  }
  const hash = createHash('sha256');
  for (const f of files) {
    // Hash the relative path so renames are detected too.
    hash.update(f.slice(modelDir.length).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(readFileSync(f));
  }
  return hash.digest('hex');
}

function collectOnnxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectOnnxFiles(full));
    } else if (entry.toLowerCase().endsWith('.onnx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Best-effort: derive the on-disk directory `@xenova/transformers` uses for a
 * given modelId inside `cacheDir`. transformers.js layouts may evolve; we fall
 * back to the cacheDir root so the hash still covers all ONNX bytes written.
 */
function modelDirFor(cacheDir: string, modelId: string): string {
  const candidate = join(cacheDir, modelId);
  return existsSync(candidate) ? candidate : cacheDir;
}

/**
 * Predownload the model so the first runtime call does not pay the network
 * cost. Used by `aistack memory download-model`.
 *
 * Returns the absolute cache directory on success or throws an Error with
 * a hint on how to install the optional dependency. When `expectedSha256` is
 * provided, the downloaded ONNX bytes are hashed and compared; on mismatch
 * the cached files are removed and the function throws.
 */
export async function predownloadModel(
  modelId: string = DEFAULT_MODEL_ID,
  options: PredownloadOptions = {},
): Promise<string> {
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

  const isDefault = modelId === DEFAULT_MODEL_ID;
  if (!options.expectedSha256 && !options.allowUnpinned && !isDefault) {
    throw new Error(
      `Refusing to download non-default model '${modelId}' without an ` +
        `'expectedSha256' pin. Compute the digest in a trusted environment ` +
        `with \`aistack memory hash-model ${modelId}\` and add it to ` +
        `memory.vectorSearch.expectedSha256, or set 'allowUnpinned: true' ` +
        `to explicitly accept the supply-chain risk.`,
    );
  }

  log.info('Pre-downloading WASM embedding model', { modelId, cacheDir });

  // Instantiating the pipeline triggers the download + caching.
  await lib.pipeline('feature-extraction', modelId, { quantized: true });

  if (options.expectedSha256) {
    const modelDir = modelDirFor(cacheDir, modelId);
    const actual = hashModelOnDisk(modelDir);
    if (actual.toLowerCase() !== options.expectedSha256.toLowerCase()) {
      // Remove the suspicious bytes so a retry cannot mask the problem.
      for (const f of collectOnnxFiles(modelDir)) {
        try {
          unlinkSync(f);
        } catch {
          /* best-effort cleanup */
        }
      }
      throw new Error(
        `Model integrity check failed for '${modelId}': expected SHA-256 ` +
          `${options.expectedSha256} but got ${actual}. Cached ONNX files ` +
          `were removed. Verify the pin or your network path.`,
      );
    }
    log.info('Model integrity verified', { modelId, sha256: actual });
  }

  return cacheDir;
}
