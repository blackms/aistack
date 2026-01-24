/**
 * Validation tests
 */

import { describe, it, expect } from 'vitest';
import {
  validate,
  MemoryStoreInputSchema,
  MemorySearchInputSchema,
  AgentSpawnInputSchema,
  AgentStopInputSchema,
  VALID_AGENT_TYPES,
  isValidAgentType,
} from '../../src/utils/validation.js';

describe('Validation', () => {
  describe('MemoryStoreInputSchema', () => {
    it('should validate correct input', () => {
      const result = validate(MemoryStoreInputSchema, {
        key: 'test-key',
        content: 'test content',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.key).toBe('test-key');
        expect(result.data.content).toBe('test content');
      }
    });

    it('should accept optional fields', () => {
      const result = validate(MemoryStoreInputSchema, {
        key: 'test-key',
        content: 'test content',
        namespace: 'my-namespace',
        metadata: { foo: 'bar' },
        generateEmbedding: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.namespace).toBe('my-namespace');
        expect(result.data.metadata).toEqual({ foo: 'bar' });
        expect(result.data.generateEmbedding).toBe(true);
      }
    });

    it('should reject missing key', () => {
      const result = validate(MemoryStoreInputSchema, {
        content: 'test content',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty content', () => {
      const result = validate(MemoryStoreInputSchema, {
        key: 'test-key',
        content: '',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('MemorySearchInputSchema', () => {
    it('should validate correct input', () => {
      const result = validate(MemorySearchInputSchema, {
        query: 'search term',
      });

      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const result = validate(MemorySearchInputSchema, {
        query: 'search term',
        namespace: 'test',
        limit: 20,
        threshold: 0.8,
        useVector: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.threshold).toBe(0.8);
      }
    });

    it('should reject limit out of range', () => {
      const result = validate(MemorySearchInputSchema, {
        query: 'search term',
        limit: 200, // Max is 100
      });

      expect(result.success).toBe(false);
    });
  });

  describe('AgentSpawnInputSchema', () => {
    it('should validate correct input', () => {
      const result = validate(AgentSpawnInputSchema, {
        type: 'coder',
      });

      expect(result.success).toBe(true);
    });

    it('should accept custom agent type', () => {
      const result = validate(AgentSpawnInputSchema, {
        type: 'custom-agent',
        name: 'my-agent',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('AgentStopInputSchema', () => {
    it('should validate with id', () => {
      const result = validate(AgentStopInputSchema, {
        id: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(true);
    });

    it('should validate with name', () => {
      const result = validate(AgentStopInputSchema, {
        name: 'my-agent',
      });

      expect(result.success).toBe(true);
    });

    it('should validate with both id and name', () => {
      const result = validate(AgentStopInputSchema, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'my-agent',
      });

      expect(result.success).toBe(true);
    });

    it('should reject when neither id nor name provided', () => {
      const result = validate(AgentStopInputSchema, {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e => e.includes('Either id or name must be provided'))).toBe(true);
      }
    });
  });

  describe('Agent type validation', () => {
    it('should have correct core types', () => {
      expect(VALID_AGENT_TYPES).toContain('coder');
      expect(VALID_AGENT_TYPES).toContain('researcher');
      expect(VALID_AGENT_TYPES).toContain('tester');
      expect(VALID_AGENT_TYPES).toContain('reviewer');
      expect(VALID_AGENT_TYPES).toContain('architect');
      expect(VALID_AGENT_TYPES).toContain('coordinator');
      expect(VALID_AGENT_TYPES).toContain('analyst');
    });

    it('should validate agent types correctly', () => {
      expect(isValidAgentType('coder')).toBe(true);
      expect(isValidAgentType('unknown')).toBe(false);
    });
  });
});
