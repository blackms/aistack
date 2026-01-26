/**
 * Agents Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestEnv, cleanupTestEnv, createTestConfig } from './setup.js';
import { getMemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import {
  spawnAgent,
  getAgent,
  listAgents,
  stopAgent,
  updateAgentStatus,
  restoreAgents,
  clearAgents,
} from '../../src/agents/spawner.js';
import type { AgentStackConfig } from '../../src/types.js';

describe('Agents Integration', () => {
  let config: AgentStackConfig;

  beforeEach(() => {
    setupTestEnv();
    config = createTestConfig();
    clearAgents();
  });

  afterEach(() => {
    clearAgents();
    resetMemoryManager();
    cleanupTestEnv();
  });

  it('should spawn and retrieve agents', () => {
    const agent = spawnAgent('coder', { name: 'test-coder' }, config);

    expect(agent.id).toBeDefined();
    expect(agent.type).toBe('coder');
    expect(agent.name).toBe('test-coder');
    expect(agent.status).toBe('idle');

    // Retrieve agent
    const retrieved = getAgent(agent.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(agent.id);
  });

  it('should list agents', () => {
    spawnAgent('coder', { name: 'coder-1' }, config);
    spawnAgent('tester', { name: 'tester-1' }, config);

    const agents = listAgents();
    expect(agents.length).toBe(2);

    const types = agents.map(a => a.type);
    expect(types).toContain('coder');
    expect(types).toContain('tester');
  });

  it('should update agent status', () => {
    const agent = spawnAgent('reviewer', { name: 'reviewer-1' }, config);

    expect(agent.status).toBe('idle');

    // Update status
    const updated = updateAgentStatus(agent.id, 'running');
    expect(updated).toBe(true);

    // Verify status changed
    const retrieved = getAgent(agent.id);
    expect(retrieved?.status).toBe('running');
  });

  it('should stop agents', () => {
    const agent = spawnAgent('analyst', { name: 'analyst-1' }, config);

    // Stop agent
    const stopped = stopAgent(agent.id);
    expect(stopped).toBe(true);

    // Verify agent is gone
    const retrieved = getAgent(agent.id);
    expect(retrieved).toBeNull();
  });

  it('should persist agents to database', () => {
    // Spawn agents
    const agent1 = spawnAgent('coder', { name: 'persist-1' }, config);
    const agent2 = spawnAgent('tester', { name: 'persist-2' }, config);

    // Clear in-memory agents
    clearAgents();
    expect(listAgents().length).toBe(0);

    // Restore from database
    const restored = restoreAgents(config);
    expect(restored).toBe(2);

    // Verify agents restored
    const agents = listAgents();
    expect(agents.length).toBe(2);

    const ids = agents.map(a => a.id);
    expect(ids).toContain(agent1.id);
    expect(ids).toContain(agent2.id);
  });

  it('should handle agent metadata', () => {
    const agent = spawnAgent(
      'coordinator',
      {
        name: 'coordinator-1',
        metadata: {
          task: 'orchestrate',
          priority: 5,
        },
      },
      config
    );

    expect(agent.metadata).toEqual({
      task: 'orchestrate',
      priority: 5,
    });

    // Metadata should persist
    clearAgents();
    restoreAgents(config);

    const restored = getAgent(agent.id);
    expect(restored?.metadata).toEqual({
      task: 'orchestrate',
      priority: 5,
    });
  });

  it('should handle agent sessions', () => {
    const memory = getMemoryManager(config);
    const session = memory.createSession();

    // Spawn agent in session
    const agent = spawnAgent(
      'coder',
      {
        name: 'session-coder',
        sessionId: session.id,
      },
      config
    );

    expect(agent.sessionId).toBe(session.id);

    // Filter agents by session
    const sessionAgents = listAgents(session.id);
    expect(sessionAgents.length).toBe(1);
    expect(sessionAgents[0]?.id).toBe(agent.id);
  });

  it('should prevent duplicate agent names', () => {
    spawnAgent('coder', { name: 'unique-name' }, config);

    // Try to spawn another agent with same name
    expect(() => {
      spawnAgent('coder', { name: 'unique-name' }, config);
    }).toThrow('already exists');
  });
});
