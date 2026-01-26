/**
 * Agent registry tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAgentDefinition,
  listAgentTypes,
  listAgentDefinitions,
  registerAgent,
  unregisterAgent,
  hasAgentType,
  getAgentCount,
  clearCustomAgents,
} from '../../src/agents/registry.js';
import type { AgentDefinition } from '../../src/types.js';

// Helper to create a mock agent definition
function createMockDefinition(type: string): AgentDefinition {
  return {
    type,
    name: `Test ${type}`,
    description: `A test ${type} agent`,
    systemPrompt: `You are a test ${type} agent.`,
    capabilities: ['test', type],
    parameters: {},
  };
}

describe('Agent Registry', () => {
  beforeEach(() => {
    clearCustomAgents();
  });

  afterEach(() => {
    clearCustomAgents();
  });

  describe('Core Agents', () => {
    it('should have coder agent', () => {
      expect(hasAgentType('coder')).toBe(true);

      const def = getAgentDefinition('coder');
      expect(def).not.toBeNull();
      expect(def?.type).toBe('coder');
    });

    it('should have researcher agent', () => {
      expect(hasAgentType('researcher')).toBe(true);

      const def = getAgentDefinition('researcher');
      expect(def).not.toBeNull();
    });

    it('should have tester agent', () => {
      expect(hasAgentType('tester')).toBe(true);

      const def = getAgentDefinition('tester');
      expect(def).not.toBeNull();
    });

    it('should have reviewer agent', () => {
      expect(hasAgentType('reviewer')).toBe(true);

      const def = getAgentDefinition('reviewer');
      expect(def).not.toBeNull();
    });

    it('should have architect agent', () => {
      expect(hasAgentType('architect')).toBe(true);

      const def = getAgentDefinition('architect');
      expect(def).not.toBeNull();
    });

    it('should have coordinator agent', () => {
      expect(hasAgentType('coordinator')).toBe(true);

      const def = getAgentDefinition('coordinator');
      expect(def).not.toBeNull();
    });

    it('should have analyst agent', () => {
      expect(hasAgentType('analyst')).toBe(true);

      const def = getAgentDefinition('analyst');
      expect(def).not.toBeNull();
    });
  });

  describe('listAgentTypes', () => {
    it('should list all core agent types', () => {
      const types = listAgentTypes();

      expect(types).toContain('coder');
      expect(types).toContain('researcher');
      expect(types).toContain('tester');
      expect(types).toContain('reviewer');
      expect(types).toContain('architect');
      expect(types).toContain('coordinator');
      expect(types).toContain('analyst');
    });

    it('should include custom agents', () => {
      registerAgent(createMockDefinition('custom-agent'));

      const types = listAgentTypes();
      expect(types).toContain('custom-agent');
    });
  });

  describe('listAgentDefinitions', () => {
    it('should return all agent definitions', () => {
      const definitions = listAgentDefinitions();

      expect(definitions.length).toBeGreaterThanOrEqual(11);
      expect(definitions.some((d) => d.type === 'coder')).toBe(true);
    });

    it('should include custom agent definitions', () => {
      registerAgent(createMockDefinition('my-custom'));

      const definitions = listAgentDefinitions();
      expect(definitions.some((d) => d.type === 'my-custom')).toBe(true);
    });
  });

  describe('registerAgent', () => {
    it('should register a custom agent', () => {
      registerAgent(createMockDefinition('new-agent'));

      expect(hasAgentType('new-agent')).toBe(true);
    });

    it('should not override core agents', () => {
      const originalDef = getAgentDefinition('coder');
      registerAgent(createMockDefinition('coder'));

      const def = getAgentDefinition('coder');
      expect(def?.systemPrompt).toBe(originalDef?.systemPrompt);
    });

    it('should overwrite existing custom agents', () => {
      registerAgent({
        ...createMockDefinition('overwrite'),
        description: 'Original',
      });
      registerAgent({
        ...createMockDefinition('overwrite'),
        description: 'Updated',
      });

      const def = getAgentDefinition('overwrite');
      expect(def?.description).toBe('Updated');
    });
  });

  describe('unregisterAgent', () => {
    it('should unregister a custom agent', () => {
      registerAgent(createMockDefinition('to-remove'));
      expect(hasAgentType('to-remove')).toBe(true);

      const result = unregisterAgent('to-remove');
      expect(result).toBe(true);
      expect(hasAgentType('to-remove')).toBe(false);
    });

    it('should not unregister core agents', () => {
      const result = unregisterAgent('coder');
      expect(result).toBe(false);
      expect(hasAgentType('coder')).toBe(true);
    });

    it('should return false for non-existent agent', () => {
      const result = unregisterAgent('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('hasAgentType', () => {
    it('should return true for core agents', () => {
      expect(hasAgentType('coder')).toBe(true);
      expect(hasAgentType('tester')).toBe(true);
    });

    it('should return true for registered custom agents', () => {
      registerAgent(createMockDefinition('custom'));
      expect(hasAgentType('custom')).toBe(true);
    });

    it('should return false for unknown agents', () => {
      expect(hasAgentType('unknown')).toBe(false);
    });
  });

  describe('getAgentCount', () => {
    it('should count core agents', () => {
      const count = getAgentCount();

      expect(count.core).toBe(11);
      expect(count.custom).toBe(0);
      expect(count.total).toBe(11);
    });

    it('should count custom agents', () => {
      registerAgent(createMockDefinition('custom-1'));
      registerAgent(createMockDefinition('custom-2'));

      const count = getAgentCount();

      expect(count.core).toBe(11);
      expect(count.custom).toBe(2);
      expect(count.total).toBe(13);
    });
  });

  describe('getAgentDefinition', () => {
    it('should return null for unknown type', () => {
      const def = getAgentDefinition('unknown');
      expect(def).toBeNull();
    });

    it('should return complete definition', () => {
      const def = getAgentDefinition('coder');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('coder');
      expect(def?.name).toBeDefined();
      expect(def?.description).toBeDefined();
      expect(def?.systemPrompt).toBeDefined();
      expect(def?.capabilities).toBeInstanceOf(Array);
    });
  });

  describe('clearCustomAgents', () => {
    it('should clear all custom agents', () => {
      registerAgent(createMockDefinition('custom-1'));
      registerAgent(createMockDefinition('custom-2'));

      clearCustomAgents();

      expect(hasAgentType('custom-1')).toBe(false);
      expect(hasAgentType('custom-2')).toBe(false);

      const count = getAgentCount();
      expect(count.custom).toBe(0);
    });

    it('should not affect core agents', () => {
      clearCustomAgents();

      expect(hasAgentType('coder')).toBe(true);
      expect(hasAgentType('tester')).toBe(true);
    });
  });
});
