/**
 * Embedding API client for vector search
 * Uses external APIs - no fake in-process claims
 */

import { logger } from './logger.js';
import type { AgentStackConfig } from '../types.js';

const log = logger.child('embeddings');

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

/**
 * OpenAI embedding provider
 */
class OpenAIEmbeddings implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  dimensions: number;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.model = model;
    // text-embedding-3-small has 1536 dimensions
    this.dimensions = model === 'text-embedding-3-large' ? 3072 : 1536;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    const embedding = result[0];
    if (!embedding) {
      throw new Error('Failed to generate embedding');
    }
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    interface OpenAIEmbeddingResponse {
      data: Array<{ embedding: number[] }>;
    }

    const data = await response.json() as OpenAIEmbeddingResponse;
    return data.data.map(d => d.embedding);
  }
}

/**
 * Ollama embedding provider (local)
 */
class OllamaEmbeddings implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  dimensions: number;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text') {
    this.baseUrl = baseUrl;
    this.model = model;
    // nomic-embed-text has 768 dimensions
    this.dimensions = 768;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    interface OllamaEmbeddingResponse {
      embedding: number[];
    }

    const data = await response.json() as OllamaEmbeddingResponse;
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't support batch embeddings, so we do them sequentially
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

/**
 * Create an embedding provider based on config
 */
export function createEmbeddingProvider(config: AgentStackConfig): EmbeddingProvider | null {
  const vectorConfig = config.memory.vectorSearch;

  if (!vectorConfig.enabled) {
    log.debug('Vector search disabled');
    return null;
  }

  const provider = vectorConfig.provider ?? 'openai';

  switch (provider) {
    case 'openai': {
      const apiKey = config.providers.openai?.apiKey;
      if (!apiKey) {
        log.warn('OpenAI API key not configured for embeddings');
        return null;
      }
      return new OpenAIEmbeddings(apiKey, vectorConfig.model);
    }

    case 'ollama': {
      const baseUrl = config.providers.ollama?.baseUrl ?? 'http://localhost:11434';
      return new OllamaEmbeddings(baseUrl, vectorConfig.model);
    }

    default:
      log.warn('Unknown embedding provider', { provider });
      return null;
  }
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);

  if (norm === 0) return vector;

  return vector.map(v => v / norm);
}
