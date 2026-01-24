/**
 * MCP System Tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSystemTools } from '../../src/mcp/tools/system-tools.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { clearAgents } from '../../src/agents/spawner.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig } from '../../src/types.js';

function createTestConfig(vectorEnabled = false): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-mcp-system-${Date.now()}.db`),
      defaultNamespace: 'default',
      vectorSearch: { enabled: vectorEnabled },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
      openai: { apiKey: 'test-openai-key' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: true, useGhCli: true },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('MCP System Tools', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let tools: ReturnType<typeof createSystemTools>;

  beforeEach(() => {
    clearAgents();
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
    tools = createSystemTools(memory, config);
  });

  afterEach(() => {
    clearAgents();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('system_status', () => {
    it('should return system status', async () => {
      const result = await tools.system_status.handler();

      expect(result.version).toBe('1.0.0');
      expect(result.agents).toBeDefined();
      expect(result.memory).toBeDefined();
      expect(result.providers).toBeDefined();
    });

    it('should include session info when session exists', async () => {
      memory.createSession();

      const result = await tools.system_status.handler();

      expect(result.session).not.toBeNull();
      expect(result.session?.id).toBeDefined();
      expect(result.session?.status).toBe('active');
    });

    it('should return null session when no session exists', async () => {
      const result = await tools.system_status.handler();

      expect(result.session).toBeNull();
    });

    it('should include provider info', async () => {
      const result = await tools.system_status.handler();

      expect(result.providers.default).toBe('anthropic');
      expect(result.providers.available).toContain('anthropic');
      expect(result.providers.available).toContain('openai');
    });
  });

  describe('system_health', () => {
    it('should return healthy status when all checks pass', async () => {
      const result = await tools.system_health.handler();

      expect(result.healthy).toBe(true);
      expect(result.status).toBe('healthy');
      expect(result.checks.memory.status).toBe('ok');
      expect(result.checks.vector_search.status).toBe('ok');
      expect(result.checks.agents.status).toBe('ok');
    });

    it('should show vector_search as disabled when not enabled', async () => {
      const result = await tools.system_health.handler();

      expect(result.checks.vector_search.status).toBe('ok');
      expect(result.checks.vector_search.message).toContain('Disabled');
    });

    it('should show memory entry count', async () => {
      await memory.store('key1', 'content1');
      await memory.store('key2', 'content2');

      const result = await tools.system_health.handler();

      expect(result.checks.memory.message).toContain('2 entries');
    });
  });

  describe('system_config', () => {
    it('should return sanitized config', async () => {
      const result = await tools.system_config.handler();

      expect(result.version).toBe('1.0.0');
      expect(result.memory.path).toBeDefined();
      expect(result.memory.defaultNamespace).toBe('default');
    });

    it('should not expose API keys', async () => {
      const result = await tools.system_config.handler();

      // Should show configured: true instead of actual keys
      expect(result.providers.anthropic).toEqual({ configured: true });
      expect(result.providers.openai).toEqual({ configured: true });
    });

    it('should include github config', async () => {
      const result = await tools.system_config.handler();

      expect(result.github.enabled).toBe(true);
      expect(result.github.useGhCli).toBe(true);
    });

    it('should include hooks config', async () => {
      const result = await tools.system_config.handler();

      expect(result.hooks.sessionStart).toBe(true);
      expect(result.hooks.postTask).toBe(true);
    });
  });
});

describe('MCP System Tools with vector search enabled', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let tools: ReturnType<typeof createSystemTools>;

  beforeEach(() => {
    clearAgents();
    resetMemoryManager();
    config = createTestConfig(true);
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
    tools = createSystemTools(memory, config);
  });

  afterEach(() => {
    clearAgents();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should show warning when vector enabled but no entries indexed', async () => {
    const result = await tools.system_health.handler();

    expect(result.checks.vector_search.status).toBe('warn');
    expect(result.checks.vector_search.message).toContain('no entries indexed');
  });
});

describe('MCP System Tools with ollama config', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let tools: ReturnType<typeof createSystemTools>;

  beforeEach(() => {
    clearAgents();
    resetMemoryManager();
    config = {
      version: '1.0.0',
      memory: {
        path: join(tmpdir(), `aistack-mcp-ollama-${Date.now()}.db`),
        defaultNamespace: 'default',
        vectorSearch: { enabled: false },
      },
      providers: {
        default: 'ollama',
        ollama: { baseUrl: 'http://localhost:11434' },
      },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: false },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    };
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
    tools = createSystemTools(memory, config);
  });

  afterEach(() => {
    clearAgents();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should show ollama baseUrl in config', async () => {
    const result = await tools.system_config.handler();

    expect(result.providers.ollama).toEqual({ baseUrl: 'http://localhost:11434' });
  });
});
