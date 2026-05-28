/**
 * Provider registry for the new modular embedding subsystem.
 *
 * For now exposes the `wasm-local` provider only. The existing OpenAI and
 * Ollama providers live in `src/utils/embeddings.ts` and remain the
 * authoritative entry points — this registry exists so future providers
 * (e.g. fastembed, llama.cpp) can be added without churning the legacy file.
 */

import type { EmbeddingProvider } from '../../../utils/embeddings.js';
import { WasmEmbedder } from '../wasm/embedder.js';
import { WasmLocalEmbeddings, type WasmLocalProviderOptions } from './wasm-local.js';
import { logger } from '../../../utils/logger.js';

const log = logger.child('embedding-providers');

export { WasmLocalEmbeddings } from './wasm-local.js';

/**
 * Attempt to construct the `wasm-local` provider, returning `null` and logging
 * a hint when the optional dependency is missing. Callers should fall back to
 * the configured external provider (OpenAI / Ollama) in that case.
 */
export async function tryCreateWasmLocalProvider(
  options: WasmLocalProviderOptions = {},
): Promise<EmbeddingProvider | null> {
  const available = await WasmEmbedder.isAvailable();
  if (!available) {
    log.warn(
      'wasm-local embedding provider requested but @xenova/transformers is not installed; ' +
        'run `npm install @xenova/transformers` and `aistack memory download-model` to enable.',
    );
    return null;
  }
  return new WasmLocalEmbeddings(options);
}
