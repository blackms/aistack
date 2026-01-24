/**
 * MCP Agent Tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAgentTools } from '../../src/mcp/tools/agent-tools.js';
import { clearAgents, getActiveAgents } from '../../src/agents/spawner.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-mcp-agent-${Date.now()}.db`),
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
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('MCP Agent Tools', () => {
  let config: AgentStackConfig;
  let tools: ReturnType<typeof createAgentTools>;

  beforeEach(() => {
    clearAgents();
    config = createTestConfig();
    tools = createAgentTools(config);
  });

  afterEach(() => {
    clearAgents();
  });

  describe('agent_spawn', () => {
    it('should spawn an agent', async () => {
      const result = await tools.agent_spawn.handler({
        type: 'coder',
      });

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent.type).toBe('coder');
      expect(result.agent.status).toBe('idle');
    });

    it('should spawn agent with name', async () => {
      const result = await tools.agent_spawn.handler({
        type: 'tester',
        name: 'my-tester',
      });

      expect(result.success).toBe(true);
      expect(result.agent.name).toBe('my-tester');
    });

    it('should spawn agent with session ID', async () => {
      const sessionId = '00000000-0000-0000-0000-000000000001';

      const result = await tools.agent_spawn.handler({
        type: 'reviewer',
        sessionId,
      });

      expect(result.success).toBe(true);
    });

    it('should spawn agent with metadata', async () => {
      const result = await tools.agent_spawn.handler({
        type: 'architect',
        metadata: { project: 'test' },
      });

      expect(result.success).toBe(true);
    });

    it('should include prompt in response', async () => {
      const result = await tools.agent_spawn.handler({
        type: 'coder',
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBeDefined();
    });

    it('should include createdAt timestamp', async () => {
      const result = await tools.agent_spawn.handler({
        type: 'coder',
      });

      expect(result.success).toBe(true);
      expect(result.agent.createdAt).toBeDefined();
      expect(() => new Date(result.agent.createdAt)).not.toThrow();
    });

    it('should throw for missing type', async () => {
      await expect(
        tools.agent_spawn.handler({})
      ).rejects.toThrow();
    });

    it('should throw for empty type', async () => {
      await expect(
        tools.agent_spawn.handler({ type: '' })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.agent_spawn.name).toBe('agent_spawn');
      expect(tools.agent_spawn.inputSchema.required).toContain('type');
    });
  });

  describe('agent_list', () => {
    it('should list all agents', async () => {
      await tools.agent_spawn.handler({ type: 'coder' });
      await tools.agent_spawn.handler({ type: 'tester' });

      const result = await tools.agent_list.handler({});

      expect(result.count).toBe(2);
      expect(result.agents).toHaveLength(2);
    });

    it('should return empty list when no agents', async () => {
      const result = await tools.agent_list.handler({});

      expect(result.count).toBe(0);
      expect(result.agents).toHaveLength(0);
    });

    it('should filter by session ID', async () => {
      const sessionId = '00000000-0000-0000-0000-000000000001';
      await tools.agent_spawn.handler({ type: 'coder', sessionId });
      await tools.agent_spawn.handler({ type: 'tester' });

      const result = await tools.agent_list.handler({ sessionId });

      expect(result.count).toBe(1);
      expect(result.agents[0].sessionId).toBe(sessionId);
    });

    it('should include agent details', async () => {
      await tools.agent_spawn.handler({ type: 'coder', name: 'test-coder' });

      const result = await tools.agent_list.handler({});

      expect(result.agents[0].id).toBeDefined();
      expect(result.agents[0].type).toBe('coder');
      expect(result.agents[0].name).toBe('test-coder');
      expect(result.agents[0].status).toBeDefined();
      expect(result.agents[0].createdAt).toBeDefined();
    });

    it('should have correct tool definition', () => {
      expect(tools.agent_list.name).toBe('agent_list');
    });
  });

  describe('agent_stop', () => {
    it('should stop agent by ID', async () => {
      const spawn = await tools.agent_spawn.handler({ type: 'coder' });
      const agentId = spawn.agent.id;

      const result = await tools.agent_stop.handler({ id: agentId });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Agent stopped');
    });

    it('should stop agent by name', async () => {
      await tools.agent_spawn.handler({ type: 'coder', name: 'stop-by-name' });

      const result = await tools.agent_stop.handler({ name: 'stop-by-name' });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Agent stopped');
    });

    it('should return not found for non-existent agent', async () => {
      const result = await tools.agent_stop.handler({
        id: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Agent not found');
    });

    it('should throw when neither id nor name provided', async () => {
      await expect(
        tools.agent_stop.handler({})
      ).rejects.toThrow('Either id or name is required');
    });

    it('should have correct tool definition', () => {
      expect(tools.agent_stop.name).toBe('agent_stop');
    });
  });

  describe('agent_status', () => {
    it('should get agent status by ID', async () => {
      const spawn = await tools.agent_spawn.handler({ type: 'coder' });

      const result = await tools.agent_status.handler({ id: spawn.agent.id });

      expect(result.found).toBe(true);
      expect(result.agent.id).toBe(spawn.agent.id);
      expect(result.agent.type).toBe('coder');
      expect(result.agent.capabilities).toBeDefined();
    });

    it('should get agent status by name', async () => {
      await tools.agent_spawn.handler({ type: 'tester', name: 'status-by-name' });

      const result = await tools.agent_status.handler({ name: 'status-by-name' });

      expect(result.found).toBe(true);
      expect(result.agent.name).toBe('status-by-name');
    });

    it('should return not found for non-existent agent', async () => {
      const result = await tools.agent_status.handler({
        id: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Agent not found');
    });

    it('should return not found when no id or name provided', async () => {
      const result = await tools.agent_status.handler({});

      expect(result.found).toBe(false);
    });

    it('should include capabilities from definition', async () => {
      const spawn = await tools.agent_spawn.handler({ type: 'coder' });

      const result = await tools.agent_status.handler({ id: spawn.agent.id });

      expect(result.found).toBe(true);
      expect(result.agent.capabilities).toBeInstanceOf(Array);
    });

    it('should have correct tool definition', () => {
      expect(tools.agent_status.name).toBe('agent_status');
    });
  });

  describe('agent_types', () => {
    it('should list all agent types', async () => {
      const result = await tools.agent_types.handler({});

      expect(result.count).toBeGreaterThan(0);
      expect(result.types).toBeInstanceOf(Array);
    });

    it('should include type details', async () => {
      const result = await tools.agent_types.handler({});

      expect(result.types.length).toBeGreaterThan(0);
      const firstType = result.types[0];
      expect(firstType.type).toBeDefined();
      expect(firstType.name).toBeDefined();
      expect(firstType.description).toBeDefined();
      expect(firstType.capabilities).toBeInstanceOf(Array);
    });

    it('should include core agent types', async () => {
      const result = await tools.agent_types.handler({});

      const typeNames = result.types.map((t: { type: string }) => t.type);
      expect(typeNames).toContain('coder');
      expect(typeNames).toContain('tester');
      expect(typeNames).toContain('researcher');
    });

    it('should have correct tool definition', () => {
      expect(tools.agent_types.name).toBe('agent_types');
      expect(tools.agent_types.description).toBe('List all available agent types');
    });
  });

  describe('agent_update_status', () => {
    it('should update agent status', async () => {
      const spawn = await tools.agent_spawn.handler({ type: 'coder' });

      const result = await tools.agent_update_status.handler({
        id: spawn.agent.id,
        status: 'running',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Status updated');
    });

    it('should update to completed status', async () => {
      const spawn = await tools.agent_spawn.handler({ type: 'coder' });

      const result = await tools.agent_update_status.handler({
        id: spawn.agent.id,
        status: 'completed',
      });

      expect(result.success).toBe(true);
    });

    it('should update to failed status', async () => {
      const spawn = await tools.agent_spawn.handler({ type: 'coder' });

      const result = await tools.agent_update_status.handler({
        id: spawn.agent.id,
        status: 'failed',
      });

      expect(result.success).toBe(true);
    });

    it('should return error for invalid status', async () => {
      const spawn = await tools.agent_spawn.handler({ type: 'coder' });

      const result = await tools.agent_update_status.handler({
        id: spawn.agent.id,
        status: 'invalid-status',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });

    it('should return not found for non-existent agent', async () => {
      const result = await tools.agent_update_status.handler({
        id: '00000000-0000-0000-0000-000000000000',
        status: 'running',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Agent not found');
    });

    it('should have correct tool definition', () => {
      expect(tools.agent_update_status.name).toBe('agent_update_status');
      expect(tools.agent_update_status.inputSchema.required).toContain('id');
      expect(tools.agent_update_status.inputSchema.required).toContain('status');
    });
  });
});
