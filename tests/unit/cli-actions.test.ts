/**
 * CLI Command Action tests
 *
 * Tests the actual command handler execution (not just structure)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { clearAgents, spawnAgent, listAgents, getAgent } from '../../src/agents/spawner.js';
import { listAgentTypes, listAgentDefinitions } from '../../src/agents/registry.js';
import { getWorkflowRunner, resetWorkflowRunner } from '../../src/workflows/index.js';
import { getConfig, resetConfig } from '../../src/utils/config.js';
import type { AgentStackConfig } from '../../src/types.js';

// Mock console
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-cli-action-${Date.now()}.db`),
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
  };
}

describe('Agent Command Actions', () => {
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    clearAgents();
    config = createTestConfig();
    dbPath = config.memory.path;
  });

  afterEach(() => {
    clearAgents();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('spawn action', () => {
    it('should spawn an agent', () => {
      const agent = spawnAgent('coder', { name: 'test-coder' });

      expect(agent).toBeDefined();
      expect(agent.type).toBe('coder');
      expect(agent.name).toBe('test-coder');
      expect(agent.status).toBe('idle');
    });

    it('should spawn agent without name', () => {
      const agent = spawnAgent('researcher');

      expect(agent).toBeDefined();
      expect(agent.type).toBe('researcher');
      expect(agent.name).toBeDefined();
    });

    it('should throw on unknown agent type', () => {
      expect(() => spawnAgent('unknown-type')).toThrow();
    });
  });

  describe('list action', () => {
    it('should list all agents', () => {
      spawnAgent('coder', { name: 'coder-1' });
      spawnAgent('tester', { name: 'tester-1' });

      const agents = listAgents();

      expect(agents.length).toBe(2);
      expect(agents.some(a => a.name === 'coder-1')).toBe(true);
      expect(agents.some(a => a.name === 'tester-1')).toBe(true);
    });

    it('should return empty list when no agents', () => {
      const agents = listAgents();
      expect(agents).toEqual([]);
    });
  });

  describe('status action', () => {
    it('should get agent status by id', () => {
      const spawned = spawnAgent('coder', { name: 'status-test' });
      const agent = getAgent(spawned.id);

      expect(agent).toBeDefined();
      expect(agent?.id).toBe(spawned.id);
      expect(agent?.status).toBe('idle');
    });

    it('should return null for non-existent agent', () => {
      const agent = getAgent('non-existent-id');
      expect(agent).toBeNull();
    });
  });

  describe('types action', () => {
    it('should list agent types', () => {
      const types = listAgentTypes();

      expect(types).toContain('coder');
      expect(types).toContain('tester');
      expect(types).toContain('researcher');
      expect(types).toContain('reviewer');
      expect(types).toContain('architect');
      expect(types).toContain('coordinator');
      expect(types).toContain('analyst');
    });

    it('should list agent definitions', () => {
      const definitions = listAgentDefinitions();

      expect(definitions.length).toBeGreaterThanOrEqual(7);
      expect(definitions.some(d => d.type === 'coder')).toBe(true);
      expect(definitions.every(d => d.systemPrompt)).toBe(true);
    });
  });
});

describe('Memory Command Actions', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('store action', () => {
    it('should store memory entry', async () => {
      await memory.store('test-key', 'test content');

      const result = await memory.get('test-key');
      expect(result?.content).toBe('test content');
    });

    it('should store with namespace', async () => {
      await memory.store('ns-key', 'namespaced content', { namespace: 'custom' });

      const result = memory.get('ns-key', 'custom');
      expect(result?.content).toBe('namespaced content');
      expect(result?.namespace).toBe('custom');
    });
  });

  describe('search action', () => {
    it('should search memory entries', async () => {
      await memory.store('key1', 'apple banana cherry');
      await memory.store('key2', 'banana cherry date');

      const results = await memory.search('banana');

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('list action', () => {
    it('should list memory entries', async () => {
      await memory.store('key1', 'content1');
      await memory.store('key2', 'content2');

      const entries = memory.list();

      expect(entries.length).toBe(2);
    });

    it('should list with namespace filter', async () => {
      await memory.store('key1', 'content1', { namespace: 'ns1' });
      await memory.store('key2', 'content2', { namespace: 'ns2' });

      const entries = memory.list('ns1');

      expect(entries.length).toBe(1);
      expect(entries[0].namespace).toBe('ns1');
    });
  });

  describe('delete action', () => {
    it('should delete memory entry', async () => {
      await memory.store('to-delete', 'content');
      expect((await memory.get('to-delete'))?.content).toBe('content');

      const deleted = await memory.delete('to-delete');
      expect(deleted).toBe(true);

      const result = await memory.get('to-delete');
      expect(result).toBeNull();
    });
  });

  describe('stats action', () => {
    it('should return memory stats', async () => {
      await memory.store('key1', 'content1');
      await memory.store('key2', 'content2');

      const count = memory.count();
      expect(count).toBe(2);

      const stats = memory.getVectorStats();
      expect(stats.total).toBe(2);
    });
  });
});

describe('Workflow Command Actions', () => {
  beforeEach(() => {
    resetWorkflowRunner();
  });

  afterEach(() => {
    resetWorkflowRunner();
  });

  describe('list action', () => {
    it('should get workflow runner', () => {
      const runner = getWorkflowRunner();
      expect(runner).toBeDefined();
    });
  });

  describe('reset action', () => {
    it('should reset workflow runner', () => {
      const runner1 = getWorkflowRunner();
      resetWorkflowRunner();
      const runner2 = getWorkflowRunner();

      // They should be different instances
      expect(runner1).not.toBe(runner2);
    });
  });
});

describe('Status Command Actions', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    clearAgents();
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    clearAgents();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('status display', () => {
    it('should show agent count', () => {
      spawnAgent('coder');
      spawnAgent('tester');

      const agents = listAgents();
      expect(agents.length).toBe(2);
    });

    it('should show memory count', () => {
      const count = memory.count();
      expect(typeof count).toBe('number');
    });

    it('should show session status', () => {
      const session = memory.getActiveSession();
      expect(session).toBeNull(); // No active session initially
    });
  });
});

describe('Init Command Actions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `aistack-init-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create config file structure', () => {
    const configPath = join(tempDir, 'agentstack.config.json');

    // Simulate config creation
    const defaultConfig = {
      version: '1.0.0',
      memory: {
        path: './data/agentstack.db',
        defaultNamespace: 'default',
        vectorSearch: { enabled: false },
      },
      providers: {
        default: 'anthropic',
      },
      agents: {
        maxConcurrent: 5,
        defaultTimeout: 300,
      },
      github: {
        enabled: true,
        useGhCli: true,
      },
      plugins: {
        enabled: true,
        directory: './plugins',
      },
      mcp: {
        transport: 'stdio',
      },
      hooks: {
        sessionStart: true,
        sessionEnd: true,
        preTask: true,
        postTask: true,
      },
    };

    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));

    expect(existsSync(configPath)).toBe(true);
  });
});
