/**
 * MCP Server tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMemoryManager } from '../../src/memory/index.js';
import { clearAgents } from '../../src/agents/spawner.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig } from '../../src/types.js';

// Store registered handlers for testing
const registeredHandlers = new Map<unknown, (...args: unknown[]) => Promise<unknown>>();

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn((schema: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
      registeredHandlers.set(schema, handler);
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
}));

// Import after mocks are set up
import { MCPServer, startMCPServer } from '../../src/mcp/server.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-mcp-server-${Date.now()}.db`),
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: true, useGhCli: true },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('MCPServer', () => {
  let config: AgentStackConfig;
  let dbPath: string;
  let server: MCPServer;

  beforeEach(() => {
    clearAgents();
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    clearAgents();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('constructor', () => {
    it('should create server with config', () => {
      server = new MCPServer(config);
      expect(server).toBeDefined();
    });

    it('should register tools on creation', () => {
      server = new MCPServer(config);
      expect(server.getToolCount()).toBeGreaterThan(0);
    });
  });

  describe('getToolCount', () => {
    it('should return number of registered tools', () => {
      server = new MCPServer(config);
      const count = server.getToolCount();
      expect(count).toBeGreaterThan(0);
      expect(typeof count).toBe('number');
    });
  });

  describe('getToolNames', () => {
    it('should return array of tool names', () => {
      server = new MCPServer(config);
      const names = server.getToolNames();

      expect(names).toBeInstanceOf(Array);
      expect(names.length).toBeGreaterThan(0);
    });

    it('should include expected tools', () => {
      server = new MCPServer(config);
      const names = server.getToolNames();

      expect(names).toContain('memory_store');
      expect(names).toContain('memory_search');
      expect(names).toContain('agent_spawn');
      expect(names).toContain('session_start');
      expect(names).toContain('task_create');
      expect(names).toContain('system_status');
    });

    it('should include github tools when enabled', () => {
      server = new MCPServer(config);
      const names = server.getToolNames();

      expect(names).toContain('github_issue_create');
      expect(names).toContain('github_pr_create');
    });
  });

  describe('start', () => {
    it('should start the server', async () => {
      server = new MCPServer(config);
      await expect(server.start()).resolves.not.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop the server', async () => {
      server = new MCPServer(config);
      await server.start();
      await expect(server.stop()).resolves.not.toThrow();
    });

    it('should close memory on stop', async () => {
      server = new MCPServer(config);
      await server.start();
      await server.stop();
      // No error means success
    });
  });
});

describe('MCPServer with GitHub disabled', () => {
  let config: AgentStackConfig;
  let dbPath: string;
  let server: MCPServer;

  beforeEach(() => {
    clearAgents();
    resetMemoryManager();
    config = {
      ...createTestConfig(),
      github: { enabled: false },
    };
    dbPath = config.memory.path;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    clearAgents();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should still register github tools (they will fail on use)', () => {
    server = new MCPServer(config);
    const names = server.getToolNames();

    // GitHub tools are registered but will throw when used
    expect(names).toContain('github_issue_create');
  });
});

describe('MCPServer request handlers', () => {
  let config: AgentStackConfig;
  let dbPath: string;
  let server: MCPServer;

  beforeEach(() => {
    registeredHandlers.clear();
    clearAgents();
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    server = new MCPServer(config);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    clearAgents();
    resetMemoryManager();
    registeredHandlers.clear();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('ListToolsRequestSchema handler', () => {
    it('should return list of tools', async () => {
      const handler = registeredHandlers.get(ListToolsRequestSchema);
      expect(handler).toBeDefined();

      const result = await handler!({}) as { tools: Array<{ name: string }> };

      expect(result.tools).toBeInstanceOf(Array);
      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.tools[0]).toHaveProperty('name');
      expect(result.tools[0]).toHaveProperty('description');
      expect(result.tools[0]).toHaveProperty('inputSchema');
    });
  });

  describe('CallToolRequestSchema handler', () => {
    it('should call a valid tool', async () => {
      const handler = registeredHandlers.get(CallToolRequestSchema);
      expect(handler).toBeDefined();

      const result = await handler!({
        params: {
          name: 'system_status',
          arguments: {},
        },
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content).toBeInstanceOf(Array);
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.version).toBe('1.0.0');
    });

    it('should return error for unknown tool', async () => {
      const handler = registeredHandlers.get(CallToolRequestSchema);
      expect(handler).toBeDefined();

      const result = await handler!({
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      }) as { content: Array<{ type: string; text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Unknown tool');
    });

    it('should handle tool execution error', async () => {
      const handler = registeredHandlers.get(CallToolRequestSchema);
      expect(handler).toBeDefined();

      // Call a tool with invalid params to trigger validation error
      const result = await handler!({
        params: {
          name: 'memory_store',
          arguments: { key: '', content: '' },
        },
      }) as { content: Array<{ type: string; text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
    });

    it('should handle tool call with no arguments', async () => {
      const handler = registeredHandlers.get(CallToolRequestSchema);
      expect(handler).toBeDefined();

      const result = await handler!({
        params: {
          name: 'system_health',
        },
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content).toBeInstanceOf(Array);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('healthy');
    });
  });
});

describe('startMCPServer', () => {
  let config: AgentStackConfig;
  let dbPath: string;
  let server: MCPServer | null = null;

  beforeEach(() => {
    registeredHandlers.clear();
    clearAgents();
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    clearAgents();
    resetMemoryManager();
    registeredHandlers.clear();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should create and start server', async () => {
    server = await startMCPServer(config);

    expect(server).toBeInstanceOf(MCPServer);
    expect(server.getToolCount()).toBeGreaterThan(0);
  });

  it('should return functional server instance', async () => {
    server = await startMCPServer(config);

    const names = server.getToolNames();
    expect(names).toContain('memory_store');
    expect(names).toContain('system_status');
  });
});
