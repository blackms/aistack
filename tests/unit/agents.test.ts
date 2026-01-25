/**
 * Agent tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  spawnAgent,
  getAgent,
  getAgentByName,
  listAgents,
  stopAgent,
  clearAgents,
} from '../../src/agents/spawner.js';
import {
  listAgentTypes,
  getAgentDefinition,
  hasAgentType,
} from '../../src/agents/registry.js';

describe('Agent Registry', () => {
  it('should list all core agent types', () => {
    const types = listAgentTypes();
    expect(types).toContain('coder');
    expect(types).toContain('researcher');
    expect(types).toContain('tester');
    expect(types).toContain('reviewer');
    expect(types).toContain('adversarial');
    expect(types).toContain('architect');
    expect(types).toContain('coordinator');
    expect(types).toContain('analyst');
    expect(types.length).toBe(8);
  });

  it('should get agent definition by type', () => {
    const coder = getAgentDefinition('coder');
    expect(coder).not.toBeNull();
    expect(coder?.type).toBe('coder');
    expect(coder?.name).toBe('Coder');
    expect(coder?.systemPrompt).toBeDefined();
    expect(coder?.capabilities).toContain('write-code');
  });

  it('should check if agent type exists', () => {
    expect(hasAgentType('coder')).toBe(true);
    expect(hasAgentType('researcher')).toBe(true);
    expect(hasAgentType('nonexistent')).toBe(false);
  });
});

describe('Agent Spawner', () => {
  beforeEach(() => {
    clearAgents();
  });

  afterEach(() => {
    clearAgents();
  });

  it('should spawn an agent', () => {
    const agent = spawnAgent('coder');
    expect(agent).toBeDefined();
    expect(agent.id).toBeDefined();
    expect(agent.type).toBe('coder');
    expect(agent.status).toBe('idle');
    expect(agent.name).toMatch(/^coder-/);
  });

  it('should spawn an agent with custom name', () => {
    const agent = spawnAgent('tester', { name: 'my-tester' });
    expect(agent.name).toBe('my-tester');
  });

  it('should get agent by ID', () => {
    const spawned = spawnAgent('reviewer');
    const found = getAgent(spawned.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(spawned.id);
  });

  it('should get agent by name', () => {
    spawnAgent('architect', { name: 'arch-1' });
    const found = getAgentByName('arch-1');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('arch-1');
  });

  it('should list all agents', () => {
    spawnAgent('coder');
    spawnAgent('tester');
    spawnAgent('reviewer');

    const agents = listAgents();
    expect(agents.length).toBe(3);
  });

  it('should stop an agent', () => {
    const agent = spawnAgent('analyst');
    expect(listAgents().length).toBe(1);

    const stopped = stopAgent(agent.id);
    expect(stopped).toBe(true);
    expect(listAgents().length).toBe(0);
  });

  it('should throw for unknown agent type', () => {
    expect(() => spawnAgent('unknown-type')).toThrow('Unknown agent type');
  });

  it('should throw for duplicate name', () => {
    spawnAgent('coder', { name: 'unique-name' });
    expect(() => spawnAgent('coder', { name: 'unique-name' })).toThrow('already exists');
  });
});
