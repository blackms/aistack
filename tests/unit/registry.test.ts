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

describe('Agent Registry', () => {
  beforeEach(() => {
    clearCustomAgents();
  });

  afterEach(() => {
    clearCustomAgents();
  });

  describe('getAgentDefinition', () => {
    it('should return coder agent definition', () => {
      const def = getAgentDefinition('coder');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('coder');
      expect(def?.name).toBeDefined();
      expect(def?.description).toBeDefined();
      expect(def?.systemPrompt).toBeDefined();
      expect(def?.capabilities).toBeInstanceOf(Array);
    });

    it('should return tester agent definition', () => {
      const def = getAgentDefinition('tester');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('tester');
    });

    it('should return researcher agent definition', () => {
      const def = getAgentDefinition('researcher');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('researcher');
    });

    it('should return reviewer agent definition', () => {
      const def = getAgentDefinition('reviewer');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('reviewer');
    });

    it('should return architect agent definition', () => {
      const def = getAgentDefinition('architect');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('architect');
    });

    it('should return coordinator agent definition', () => {
      const def = getAgentDefinition('coordinator');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('coordinator');
    });

    it('should return analyst agent definition', () => {
      const def = getAgentDefinition('analyst');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('analyst');
    });

    it('should return null for unknown type', () => {
      const def = getAgentDefinition('unknown');

      expect(def).toBeNull();
    });

    it('should return custom agent definition', () => {
      const customAgent: AgentDefinition = {
        type: 'custom-type',
        name: 'Custom Agent',
        description: 'A custom agent',
        systemPrompt: 'You are a custom agent.',
        capabilities: ['custom-capability'],
      };

      registerAgent(customAgent);
      const def = getAgentDefinition('custom-type');

      expect(def).not.toBeNull();
      expect(def?.type).toBe('custom-type');
      expect(def?.name).toBe('Custom Agent');
    });
  });

  describe('listAgentTypes', () => {
    it('should list all core agent types', () => {
      const types = listAgentTypes();

      expect(types).toContain('coder');
      expect(types).toContain('tester');
      expect(types).toContain('researcher');
      expect(types).toContain('reviewer');
      expect(types).toContain('architect');
      expect(types).toContain('coordinator');
      expect(types).toContain('analyst');
    });

    it('should include custom agent types', () => {
      registerAgent({
        type: 'custom-type',
        name: 'Custom',
        description: 'Custom agent',
        systemPrompt: 'You are custom.',
        capabilities: [],
      });

      const types = listAgentTypes();

      expect(types).toContain('custom-type');
    });
  });

  describe('listAgentDefinitions', () => {
    it('should return all agent definitions', () => {
      const definitions = listAgentDefinitions();

      expect(definitions.length).toBeGreaterThanOrEqual(7);
      expect(definitions.some(d => d.type === 'coder')).toBe(true);
      expect(definitions.some(d => d.type === 'tester')).toBe(true);
    });

    it('should include custom agent definitions', () => {
      const customAgent: AgentDefinition = {
        type: 'custom',
        name: 'Custom',
        description: 'Custom agent',
        systemPrompt: 'You are custom.',
        capabilities: ['cap1'],
      };

      registerAgent(customAgent);
      const definitions = listAgentDefinitions();

      expect(definitions.some(d => d.type === 'custom')).toBe(true);
    });
  });

  describe('registerAgent', () => {
    it('should register a custom agent', () => {
      const customAgent: AgentDefinition = {
        type: 'new-agent',
        name: 'New Agent',
        description: 'A new agent type',
        systemPrompt: 'You are a new agent.',
        capabilities: ['new-capability'],
      };

      registerAgent(customAgent);

      expect(hasAgentType('new-agent')).toBe(true);
      expect(getAgentDefinition('new-agent')).not.toBeNull();
    });

    it('should not override core agent types', () => {
      const fakeCore: AgentDefinition = {
        type: 'coder',
        name: 'Fake Coder',
        description: 'Trying to override coder',
        systemPrompt: 'Fake prompt',
        capabilities: [],
      };

      registerAgent(fakeCore);

      // Original coder should still exist
      const def = getAgentDefinition('coder');
      expect(def?.name).not.toBe('Fake Coder');
    });

    it('should overwrite existing custom agent', () => {
      const agent1: AgentDefinition = {
        type: 'my-agent',
        name: 'Version 1',
        description: 'First version',
        systemPrompt: 'v1',
        capabilities: [],
      };

      const agent2: AgentDefinition = {
        type: 'my-agent',
        name: 'Version 2',
        description: 'Second version',
        systemPrompt: 'v2',
        capabilities: [],
      };

      registerAgent(agent1);
      registerAgent(agent2);

      const def = getAgentDefinition('my-agent');
      expect(def?.name).toBe('Version 2');
    });
  });

  describe('unregisterAgent', () => {
    it('should unregister a custom agent', () => {
      registerAgent({
        type: 'temp-agent',
        name: 'Temp',
        description: 'Temporary agent',
        systemPrompt: 'Temp',
        capabilities: [],
      });

      expect(hasAgentType('temp-agent')).toBe(true);

      const result = unregisterAgent('temp-agent');

      expect(result).toBe(true);
      expect(hasAgentType('temp-agent')).toBe(false);
    });

    it('should not unregister core agent types', () => {
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
    it('should return true for core types', () => {
      expect(hasAgentType('coder')).toBe(true);
      expect(hasAgentType('tester')).toBe(true);
      expect(hasAgentType('researcher')).toBe(true);
    });

    it('should return true for custom types', () => {
      registerAgent({
        type: 'custom',
        name: 'Custom',
        description: 'Custom',
        systemPrompt: 'Custom',
        capabilities: [],
      });

      expect(hasAgentType('custom')).toBe(true);
    });

    it('should return false for unknown types', () => {
      expect(hasAgentType('unknown')).toBe(false);
      expect(hasAgentType('')).toBe(false);
    });
  });

  describe('getAgentCount', () => {
    it('should return correct counts', () => {
      const counts = getAgentCount();

      expect(counts.core).toBe(7);
      expect(counts.custom).toBe(0);
      expect(counts.total).toBe(7);
    });

    it('should include custom agents in count', () => {
      registerAgent({
        type: 'custom1',
        name: 'Custom 1',
        description: 'Custom 1',
        systemPrompt: 'Custom 1',
        capabilities: [],
      });

      registerAgent({
        type: 'custom2',
        name: 'Custom 2',
        description: 'Custom 2',
        systemPrompt: 'Custom 2',
        capabilities: [],
      });

      const counts = getAgentCount();

      expect(counts.core).toBe(7);
      expect(counts.custom).toBe(2);
      expect(counts.total).toBe(9);
    });
  });

  describe('clearCustomAgents', () => {
    it('should clear all custom agents', () => {
      registerAgent({
        type: 'custom1',
        name: 'Custom 1',
        description: 'Custom 1',
        systemPrompt: 'Custom 1',
        capabilities: [],
      });

      registerAgent({
        type: 'custom2',
        name: 'Custom 2',
        description: 'Custom 2',
        systemPrompt: 'Custom 2',
        capabilities: [],
      });

      clearCustomAgents();

      expect(hasAgentType('custom1')).toBe(false);
      expect(hasAgentType('custom2')).toBe(false);
      expect(getAgentCount().custom).toBe(0);
    });

    it('should not affect core agents', () => {
      clearCustomAgents();

      expect(hasAgentType('coder')).toBe(true);
      expect(hasAgentType('tester')).toBe(true);
      expect(getAgentCount().core).toBe(7);
    });
  });
});
