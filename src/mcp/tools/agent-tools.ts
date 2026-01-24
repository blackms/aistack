/**
 * Agent MCP tools - spawn, list, stop, status
 */

import { z } from 'zod';
import {
  spawnAgent,
  getAgent,
  getAgentByName,
  listAgents,
  stopAgent,
  stopAgentByName,
  updateAgentStatus,
  getAgentPrompt,
} from '../../agents/spawner.js';
import { listAgentTypes, getAgentDefinition } from '../../agents/registry.js';
import type { AgentStackConfig } from '../../types.js';

// Input schemas
const SpawnInputSchema = z.object({
  type: z.string().min(1).describe('Agent type to spawn'),
  name: z.string().min(1).max(100).optional().describe('Optional name for the agent'),
  sessionId: z.string().uuid().optional().describe('Session ID to associate with'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

const StopInputSchema = z.object({
  id: z.string().uuid().optional().describe('Agent ID to stop'),
  name: z.string().optional().describe('Agent name to stop'),
}).refine(data => data.id || data.name, {
  message: 'Either id or name is required',
});

const StatusInputSchema = z.object({
  id: z.string().uuid().optional().describe('Agent ID'),
  name: z.string().optional().describe('Agent name'),
});

const ListInputSchema = z.object({
  sessionId: z.string().uuid().optional().describe('Filter by session ID'),
});

export function createAgentTools(config: AgentStackConfig) {
  return {
    agent_spawn: {
      name: 'agent_spawn',
      description: 'Spawn a new agent of the specified type',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Agent type (coder, researcher, tester, reviewer, architect, coordinator, analyst)' },
          name: { type: 'string', description: 'Optional name for the agent' },
          sessionId: { type: 'string', description: 'Session ID to associate with' },
          metadata: { type: 'object', description: 'Additional metadata' },
        },
        required: ['type'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = SpawnInputSchema.parse(params);

        try {
          const agent = spawnAgent(input.type, {
            name: input.name,
            sessionId: input.sessionId,
            metadata: input.metadata,
          }, config);

          const prompt = getAgentPrompt(input.type);

          return {
            success: true,
            agent: {
              id: agent.id,
              type: agent.type,
              name: agent.name,
              status: agent.status,
              createdAt: agent.createdAt.toISOString(),
            },
            prompt,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    agent_list: {
      name: 'agent_list',
      description: 'List all active agents',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Filter by session ID' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = ListInputSchema.parse(params);
        const agents = listAgents(input.sessionId);

        return {
          count: agents.length,
          agents: agents.map(a => ({
            id: a.id,
            type: a.type,
            name: a.name,
            status: a.status,
            createdAt: a.createdAt.toISOString(),
            sessionId: a.sessionId,
          })),
        };
      },
    },

    agent_stop: {
      name: 'agent_stop',
      description: 'Stop an agent by ID or name',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Agent ID to stop' },
          name: { type: 'string', description: 'Agent name to stop' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = StopInputSchema.parse(params);

        let stopped = false;
        if (input.id) {
          stopped = stopAgent(input.id);
        } else if (input.name) {
          stopped = stopAgentByName(input.name);
        }

        return {
          success: stopped,
          message: stopped ? 'Agent stopped' : 'Agent not found',
        };
      },
    },

    agent_status: {
      name: 'agent_status',
      description: 'Get the status of an agent',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Agent ID' },
          name: { type: 'string', description: 'Agent name' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = StatusInputSchema.parse(params);

        let agent = null;
        if (input.id) {
          agent = getAgent(input.id);
        } else if (input.name) {
          agent = getAgentByName(input.name);
        }

        if (!agent) {
          return {
            found: false,
            message: 'Agent not found',
          };
        }

        const definition = getAgentDefinition(agent.type);

        return {
          found: true,
          agent: {
            id: agent.id,
            type: agent.type,
            name: agent.name,
            status: agent.status,
            createdAt: agent.createdAt.toISOString(),
            sessionId: agent.sessionId,
            capabilities: definition?.capabilities ?? [],
          },
        };
      },
    },

    agent_types: {
      name: 'agent_types',
      description: 'List all available agent types',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const types = listAgentTypes();
        const definitions = types.map(type => {
          const def = getAgentDefinition(type);
          return {
            type,
            name: def?.name ?? type,
            description: def?.description ?? '',
            capabilities: def?.capabilities ?? [],
          };
        });

        return {
          count: definitions.length,
          types: definitions,
        };
      },
    },

    agent_update_status: {
      name: 'agent_update_status',
      description: 'Update the status of an agent',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Agent ID' },
          status: { type: 'string', enum: ['idle', 'running', 'completed', 'failed'], description: 'New status' },
        },
        required: ['id', 'status'],
      },
      handler: async (params: Record<string, unknown>) => {
        const { id, status } = params as { id: string; status: string };
        const validStatuses = ['idle', 'running', 'completed', 'failed'];

        if (!validStatuses.includes(status)) {
          return {
            success: false,
            error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          };
        }

        const updated = updateAgentStatus(id, status as 'idle' | 'running' | 'completed' | 'failed');

        return {
          success: updated,
          message: updated ? 'Status updated' : 'Agent not found',
        };
      },
    },
  };
}
