/**
 * Agent spawner tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  spawnAgent,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgentStatus,
  stopAgent,
  stopAgentByName,
  stopAllAgents,
  getAgentCount,
  getAgentsByStatus,
  clearAgents,
  getAgentPrompt,
  getAgentCapabilities,
} from '../../src/agents/spawner.js';

describe('Agent Spawner', () => {
  beforeEach(() => {
    clearAgents();
  });

  afterEach(() => {
    clearAgents();
  });

  describe('spawnAgent', () => {
    it('should spawn an agent with default name', () => {
      const agent = spawnAgent('coder');

      expect(agent.id).toBeDefined();
      expect(agent.type).toBe('coder');
      expect(agent.name).toContain('coder-');
      expect(agent.status).toBe('idle');
      expect(agent.createdAt).toBeInstanceOf(Date);
    });

    it('should spawn an agent with custom name', () => {
      const agent = spawnAgent('researcher', { name: 'my-researcher' });

      expect(agent.name).toBe('my-researcher');
    });

    it('should spawn an agent with session ID', () => {
      const agent = spawnAgent('architect', { sessionId: 'session-123' });

      expect(agent.sessionId).toBe('session-123');
    });

    it('should spawn an agent with metadata', () => {
      const agent = spawnAgent('reviewer', { metadata: { priority: 'high' } });

      expect(agent.metadata).toEqual({ priority: 'high' });
    });

    it('should throw for unknown agent type', () => {
      expect(() => spawnAgent('unknown-type')).toThrow('Unknown agent type');
    });

    it('should throw for duplicate name', () => {
      spawnAgent('coder', { name: 'unique-name' });

      expect(() => spawnAgent('tester', { name: 'unique-name' })).toThrow(
        "Agent with name 'unique-name' already exists"
      );
    });
  });

  describe('getAgent', () => {
    it('should return agent by ID', () => {
      const spawned = spawnAgent('coder');
      const retrieved = getAgent(spawned.id);

      expect(retrieved).toEqual(spawned);
    });

    it('should return null for unknown ID', () => {
      const agent = getAgent('non-existent-id');
      expect(agent).toBeNull();
    });
  });

  describe('getAgentByName', () => {
    it('should return agent by name', () => {
      const spawned = spawnAgent('coder', { name: 'named-agent' });
      const retrieved = getAgentByName('named-agent');

      expect(retrieved).toEqual(spawned);
    });

    it('should return null for unknown name', () => {
      const agent = getAgentByName('unknown-name');
      expect(agent).toBeNull();
    });
  });

  describe('listAgents', () => {
    it('should return empty array when no agents', () => {
      const agents = listAgents();
      expect(agents).toEqual([]);
    });

    it('should return all agents', () => {
      spawnAgent('coder');
      spawnAgent('tester');
      spawnAgent('reviewer');

      const agents = listAgents();
      expect(agents.length).toBe(3);
    });

    it('should filter by session ID', () => {
      spawnAgent('coder', { sessionId: 'session-1' });
      spawnAgent('tester', { sessionId: 'session-1' });
      spawnAgent('reviewer', { sessionId: 'session-2' });

      const session1Agents = listAgents('session-1');
      expect(session1Agents.length).toBe(2);

      const session2Agents = listAgents('session-2');
      expect(session2Agents.length).toBe(1);
    });
  });

  describe('updateAgentStatus', () => {
    it('should update agent status', () => {
      const agent = spawnAgent('coder');

      const result = updateAgentStatus(agent.id, 'busy');
      expect(result).toBe(true);

      const updated = getAgent(agent.id);
      expect(updated?.status).toBe('busy');
    });

    it('should return false for unknown agent', () => {
      const result = updateAgentStatus('unknown-id', 'busy');
      expect(result).toBe(false);
    });
  });

  describe('stopAgent', () => {
    it('should stop an agent by ID', () => {
      const agent = spawnAgent('coder');

      const result = stopAgent(agent.id);
      expect(result).toBe(true);

      const stopped = getAgent(agent.id);
      expect(stopped).toBeNull();
    });

    it('should return false for unknown agent', () => {
      const result = stopAgent('unknown-id');
      expect(result).toBe(false);
    });
  });

  describe('stopAgentByName', () => {
    it('should stop an agent by name', () => {
      spawnAgent('coder', { name: 'to-stop' });

      const result = stopAgentByName('to-stop');
      expect(result).toBe(true);

      const stopped = getAgentByName('to-stop');
      expect(stopped).toBeNull();
    });

    it('should return false for unknown name', () => {
      const result = stopAgentByName('unknown-name');
      expect(result).toBe(false);
    });
  });

  describe('stopAllAgents', () => {
    it('should stop all agents', () => {
      spawnAgent('coder');
      spawnAgent('tester');
      spawnAgent('reviewer');

      const count = stopAllAgents();
      expect(count).toBe(3);
      expect(listAgents().length).toBe(0);
    });

    it('should stop only agents in session', () => {
      spawnAgent('coder', { sessionId: 'session-1' });
      spawnAgent('tester', { sessionId: 'session-1' });
      spawnAgent('reviewer', { sessionId: 'session-2' });

      const count = stopAllAgents('session-1');
      expect(count).toBe(2);
      expect(listAgents().length).toBe(1);
    });

    it('should return 0 when no agents', () => {
      const count = stopAllAgents();
      expect(count).toBe(0);
    });
  });

  describe('getAgentCount', () => {
    it('should return 0 when no agents', () => {
      expect(getAgentCount()).toBe(0);
    });

    it('should return total count', () => {
      spawnAgent('coder');
      spawnAgent('tester');

      expect(getAgentCount()).toBe(2);
    });

    it('should count by session ID', () => {
      spawnAgent('coder', { sessionId: 'session-1' });
      spawnAgent('tester', { sessionId: 'session-1' });
      spawnAgent('reviewer', { sessionId: 'session-2' });

      expect(getAgentCount('session-1')).toBe(2);
      expect(getAgentCount('session-2')).toBe(1);
    });
  });

  describe('getAgentsByStatus', () => {
    it('should return agents by status', () => {
      const agent1 = spawnAgent('coder');
      const agent2 = spawnAgent('tester');
      spawnAgent('reviewer');

      updateAgentStatus(agent1.id, 'busy');
      updateAgentStatus(agent2.id, 'busy');

      const busyAgents = getAgentsByStatus('busy');
      expect(busyAgents.length).toBe(2);

      const idleAgents = getAgentsByStatus('idle');
      expect(idleAgents.length).toBe(1);
    });

    it('should return empty array for no matches', () => {
      spawnAgent('coder');

      const errorAgents = getAgentsByStatus('error');
      expect(errorAgents).toEqual([]);
    });
  });

  describe('getAgentPrompt', () => {
    it('should return prompt for valid agent type', () => {
      const prompt = getAgentPrompt('coder');
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
    });

    it('should return null for unknown type', () => {
      const prompt = getAgentPrompt('unknown-type');
      expect(prompt).toBeNull();
    });
  });

  describe('getAgentCapabilities', () => {
    it('should return capabilities for valid agent type', () => {
      const capabilities = getAgentCapabilities('coder');
      expect(capabilities).toBeInstanceOf(Array);
      expect(capabilities!.length).toBeGreaterThan(0);
    });

    it('should return null for unknown type', () => {
      const capabilities = getAgentCapabilities('unknown-type');
      expect(capabilities).toBeNull();
    });
  });

  describe('clearAgents', () => {
    it('should clear all agents', () => {
      spawnAgent('coder');
      spawnAgent('tester');

      clearAgents();

      expect(listAgents()).toEqual([]);
      expect(getAgentCount()).toBe(0);
    });
  });
});
