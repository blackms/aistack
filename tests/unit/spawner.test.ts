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
    it('should spawn a coder agent', () => {
      const agent = spawnAgent('coder');

      expect(agent.id).toBeDefined();
      expect(agent.type).toBe('coder');
      expect(agent.status).toBe('idle');
      expect(agent.createdAt).toBeInstanceOf(Date);
    });

    it('should spawn agent with custom name', () => {
      const agent = spawnAgent('tester', { name: 'my-tester' });

      expect(agent.name).toBe('my-tester');
    });

    it('should spawn agent with session ID', () => {
      const sessionId = '00000000-0000-0000-0000-000000000001';
      const agent = spawnAgent('reviewer', { sessionId });

      expect(agent.sessionId).toBe(sessionId);
    });

    it('should spawn agent with metadata', () => {
      const metadata = { project: 'test-project', priority: 'high' };
      const agent = spawnAgent('architect', { metadata });

      expect(agent.metadata).toEqual(metadata);
    });

    it('should generate unique ID for each agent', () => {
      const agent1 = spawnAgent('coder');
      const agent2 = spawnAgent('coder');

      expect(agent1.id).not.toBe(agent2.id);
    });

    it('should generate default name if not provided', () => {
      const agent = spawnAgent('coder');

      expect(agent.name).toContain('coder-');
    });

    it('should throw for unknown agent type', () => {
      expect(() => spawnAgent('unknown-type')).toThrow('Unknown agent type: unknown-type');
    });

    it('should throw for duplicate agent name', () => {
      spawnAgent('coder', { name: 'unique-name' });

      expect(() => spawnAgent('tester', { name: 'unique-name' })).toThrow(
        "Agent with name 'unique-name' already exists"
      );
    });
  });

  describe('getAgent', () => {
    it('should get agent by ID', () => {
      const spawned = spawnAgent('coder');
      const retrieved = getAgent(spawned.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(spawned.id);
      expect(retrieved?.type).toBe('coder');
    });

    it('should return null for non-existent agent', () => {
      const result = getAgent('00000000-0000-0000-0000-000000000000');

      expect(result).toBeNull();
    });
  });

  describe('getAgentByName', () => {
    it('should get agent by name', () => {
      spawnAgent('coder', { name: 'named-agent' });
      const retrieved = getAgentByName('named-agent');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('named-agent');
    });

    it('should return null for non-existent name', () => {
      const result = getAgentByName('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('listAgents', () => {
    it('should list all agents', () => {
      spawnAgent('coder');
      spawnAgent('tester');
      spawnAgent('reviewer');

      const agents = listAgents();

      expect(agents).toHaveLength(3);
    });

    it('should return empty array when no agents', () => {
      const agents = listAgents();

      expect(agents).toHaveLength(0);
    });

    it('should filter by session ID', () => {
      const session1 = '00000000-0000-0000-0000-000000000001';
      const session2 = '00000000-0000-0000-0000-000000000002';

      spawnAgent('coder', { sessionId: session1 });
      spawnAgent('tester', { sessionId: session1 });
      spawnAgent('reviewer', { sessionId: session2 });

      const agents = listAgents(session1);

      expect(agents).toHaveLength(2);
      agents.forEach(agent => {
        expect(agent.sessionId).toBe(session1);
      });
    });
  });

  describe('updateAgentStatus', () => {
    it('should update agent status to running', () => {
      const agent = spawnAgent('coder');
      const result = updateAgentStatus(agent.id, 'running');

      expect(result).toBe(true);
      expect(getAgent(agent.id)?.status).toBe('running');
    });

    it('should update agent status to completed', () => {
      const agent = spawnAgent('coder');
      updateAgentStatus(agent.id, 'completed');

      expect(getAgent(agent.id)?.status).toBe('completed');
    });

    it('should update agent status to failed', () => {
      const agent = spawnAgent('coder');
      updateAgentStatus(agent.id, 'failed');

      expect(getAgent(agent.id)?.status).toBe('failed');
    });

    it('should return false for non-existent agent', () => {
      const result = updateAgentStatus('00000000-0000-0000-0000-000000000000', 'running');

      expect(result).toBe(false);
    });
  });

  describe('stopAgent', () => {
    it('should stop agent by ID', () => {
      const agent = spawnAgent('coder');
      const result = stopAgent(agent.id);

      expect(result).toBe(true);
      expect(getAgent(agent.id)).toBeNull();
    });

    it('should return false for non-existent agent', () => {
      const result = stopAgent('00000000-0000-0000-0000-000000000000');

      expect(result).toBe(false);
    });

    it('should remove agent from name index', () => {
      const agent = spawnAgent('coder', { name: 'to-stop' });
      stopAgent(agent.id);

      expect(getAgentByName('to-stop')).toBeNull();
    });
  });

  describe('stopAgentByName', () => {
    it('should stop agent by name', () => {
      spawnAgent('coder', { name: 'stop-by-name' });
      const result = stopAgentByName('stop-by-name');

      expect(result).toBe(true);
      expect(getAgentByName('stop-by-name')).toBeNull();
    });

    it('should return false for non-existent name', () => {
      const result = stopAgentByName('non-existent');

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
      expect(listAgents()).toHaveLength(0);
    });

    it('should stop only agents in specific session', () => {
      const session1 = '00000000-0000-0000-0000-000000000001';
      const session2 = '00000000-0000-0000-0000-000000000002';

      spawnAgent('coder', { sessionId: session1 });
      spawnAgent('tester', { sessionId: session1 });
      spawnAgent('reviewer', { sessionId: session2 });

      const count = stopAllAgents(session1);

      expect(count).toBe(2);
      expect(listAgents()).toHaveLength(1);
      expect(listAgents()[0].sessionId).toBe(session2);
    });

    it('should return 0 when no agents', () => {
      const count = stopAllAgents();

      expect(count).toBe(0);
    });
  });

  describe('getAgentCount', () => {
    it('should return total agent count', () => {
      spawnAgent('coder');
      spawnAgent('tester');

      expect(getAgentCount()).toBe(2);
    });

    it('should return 0 when no agents', () => {
      expect(getAgentCount()).toBe(0);
    });

    it('should return count for specific session', () => {
      const session1 = '00000000-0000-0000-0000-000000000001';
      const session2 = '00000000-0000-0000-0000-000000000002';

      spawnAgent('coder', { sessionId: session1 });
      spawnAgent('tester', { sessionId: session1 });
      spawnAgent('reviewer', { sessionId: session2 });

      expect(getAgentCount(session1)).toBe(2);
      expect(getAgentCount(session2)).toBe(1);
    });
  });

  describe('getAgentsByStatus', () => {
    it('should return agents with matching status', () => {
      const agent1 = spawnAgent('coder');
      const agent2 = spawnAgent('tester');
      spawnAgent('reviewer');

      updateAgentStatus(agent1.id, 'running');
      updateAgentStatus(agent2.id, 'running');

      const runningAgents = getAgentsByStatus('running');

      expect(runningAgents).toHaveLength(2);
      runningAgents.forEach(agent => {
        expect(agent.status).toBe('running');
      });
    });

    it('should return idle agents by default', () => {
      spawnAgent('coder');
      spawnAgent('tester');

      const idleAgents = getAgentsByStatus('idle');

      expect(idleAgents).toHaveLength(2);
    });

    it('should return empty array if no agents match status', () => {
      spawnAgent('coder');

      const failedAgents = getAgentsByStatus('failed');

      expect(failedAgents).toHaveLength(0);
    });
  });

  describe('getAgentPrompt', () => {
    it('should return prompt for valid agent type', () => {
      const prompt = getAgentPrompt('coder');

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt!.length).toBeGreaterThan(0);
    });

    it('should return null for unknown agent type', () => {
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

    it('should return null for unknown agent type', () => {
      const capabilities = getAgentCapabilities('unknown-type');

      expect(capabilities).toBeNull();
    });
  });

  describe('clearAgents', () => {
    it('should clear all agents', () => {
      spawnAgent('coder');
      spawnAgent('tester');

      clearAgents();

      expect(listAgents()).toHaveLength(0);
      expect(getAgentCount()).toBe(0);
    });

    it('should clear name index', () => {
      spawnAgent('coder', { name: 'test-agent' });

      clearAgents();

      // Should be able to use the same name now
      const agent = spawnAgent('tester', { name: 'test-agent' });
      expect(agent.name).toBe('test-agent');
    });
  });
});
