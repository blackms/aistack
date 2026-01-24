/**
 * Utility exports
 */

export { logger, createLogger } from './logger.js';
export {
  loadConfig,
  getConfig,
  getDefaultConfig,
  saveConfig,
  validateConfig,
  resetConfig,
} from './config.js';
export * from './validation.js';
export {
  createEmbeddingProvider,
  cosineSimilarity,
  normalizeVector,
  type EmbeddingProvider,
} from './embeddings.js';
