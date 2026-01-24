/**
 * Embeddings utility tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEmbeddingProvider,
  cosineSimilarity,
  normalizeVector,
} from '../../src/utils/embeddings.js';
import type { AgentStackConfig } from '../../src/types.js';

// Helper to create test config
function createConfig(options: {
  enabled: boolean;
  provider?: string;
  openaiKey?: string;
}): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './data/memory.db',
      defaultNamespace: 'default',
      vectorSearch: {
        enabled: options.enabled,
        provider: options.provider,
      },
    },
    providers: {
      default: 'anthropic',
      ...(options.openaiKey && { openai: { apiKey: options.openaiKey } }),
      ollama: { baseUrl: 'http://localhost:11434' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('Embeddings Utils', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = [1, 2, 3, 4, 5];
      const similarity = cosineSimilarity(vec, vec);

      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [-1, -2, -3];
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(-1, 5);
    });

    it('should handle different magnitudes', () => {
      const vec1 = [1, 0];
      const vec2 = [100, 0];
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for zero vectors', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBe(0);
    });

    it('should work with Float32Array', () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([1, 2, 3]);
      const similarity = cosineSimilarity(Array.from(vec1), Array.from(vec2));

      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should throw on dimension mismatch', () => {
      expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow();
    });
  });

  describe('normalizeVector', () => {
    it('should normalize to unit length', () => {
      const vec = [3, 4]; // 3-4-5 triangle
      const normalized = normalizeVector(vec);

      const magnitude = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it('should preserve direction', () => {
      const vec = [3, 4];
      const normalized = normalizeVector(vec);

      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);
    });

    it('should handle zero vector', () => {
      const vec = [0, 0, 0];
      const normalized = normalizeVector(vec);

      expect(normalized).toEqual([0, 0, 0]);
    });

    it('should handle single element', () => {
      const vec = [5];
      const normalized = normalizeVector(vec);

      expect(normalized[0]).toBeCloseTo(1, 5);
    });

    it('should handle negative values', () => {
      const vec = [-3, -4];
      const normalized = normalizeVector(vec);

      const magnitude = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });
  });

  describe('createEmbeddingProvider', () => {
    it('should return null when vector search disabled', () => {
      const provider = createEmbeddingProvider(createConfig({ enabled: false }));

      expect(provider).toBeNull();
    });

    it('should create ollama provider when enabled', () => {
      const provider = createEmbeddingProvider(
        createConfig({ enabled: true, provider: 'ollama' })
      );

      expect(provider).toBeDefined();
      expect(typeof provider?.embed).toBe('function');
    });

    it('should return null for openai without API key', () => {
      const provider = createEmbeddingProvider(
        createConfig({ enabled: true, provider: 'openai' })
      );

      expect(provider).toBeNull();
    });

    it('should create openai provider with API key', () => {
      const provider = createEmbeddingProvider(
        createConfig({ enabled: true, provider: 'openai', openaiKey: 'sk-test' })
      );

      expect(provider).toBeDefined();
      expect(provider?.dimensions).toBe(1536);
    });

    it('should return null for unknown provider', () => {
      const provider = createEmbeddingProvider(
        createConfig({ enabled: true, provider: 'unknown' })
      );

      expect(provider).toBeNull();
    });
  });
});
