/**
 * Task MCP tools - create, assign, complete, list
 */

import { z } from 'zod';
import type { MemoryManager } from '../../memory/index.js';

// Input schemas
const CreateInputSchema = z.object({
  agentType: z.string().min(1).describe('Agent type for this task'),
  input: z.string().optional().describe('Task input/description'),
  sessionId: z.string().uuid().optional().describe('Session to associate with'),
});

const AssignInputSchema = z.object({
  taskId: z.string().uuid().describe('Task ID'),
  agentId: z.string().uuid().describe('Agent ID to assign'),
});

const CompleteInputSchema = z.object({
  taskId: z.string().uuid().describe('Task ID'),
  output: z.string().optional().describe('Task output'),
  status: z.enum(['completed', 'failed']).optional().describe('Completion status'),
});

const ListInputSchema = z.object({
  sessionId: z.string().uuid().optional().describe('Filter by session'),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional().describe('Filter by status'),
});

const GetInputSchema = z.object({
  taskId: z.string().uuid().describe('Task ID'),
});

export function createTaskTools(memory: MemoryManager) {
  return {
    task_create: {
      name: 'task_create',
      description: 'Create a new task',
      inputSchema: {
        type: 'object',
        properties: {
          agentType: { type: 'string', description: 'Agent type for this task' },
          input: { type: 'string', description: 'Task input/description' },
          sessionId: { type: 'string', description: 'Session to associate with' },
        },
        required: ['agentType'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = CreateInputSchema.parse(params);

        try {
          const task = memory.createTask(
            input.agentType,
            input.input,
            input.sessionId
          );

          return {
            success: true,
            task: {
              id: task.id,
              agentType: task.agentType,
              status: task.status,
              createdAt: task.createdAt.toISOString(),
              sessionId: task.sessionId,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    task_assign: {
      name: 'task_assign',
      description: 'Assign a task to an agent (marks as running)',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          agentId: { type: 'string', description: 'Agent ID to assign' },
        },
        required: ['taskId', 'agentId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = AssignInputSchema.parse(params);

        const task = memory.getTask(input.taskId);
        if (!task) {
          return {
            success: false,
            error: 'Task not found',
          };
        }

        const updated = memory.updateTaskStatus(input.taskId, 'running');

        return {
          success: updated,
          message: updated ? 'Task assigned and running' : 'Failed to update task',
        };
      },
    },

    task_complete: {
      name: 'task_complete',
      description: 'Mark a task as completed or failed',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          output: { type: 'string', description: 'Task output' },
          status: { type: 'string', enum: ['completed', 'failed'], description: 'Completion status' },
        },
        required: ['taskId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = CompleteInputSchema.parse(params);

        const task = memory.getTask(input.taskId);
        if (!task) {
          return {
            success: false,
            error: 'Task not found',
          };
        }

        const status = input.status ?? 'completed';
        const updated = memory.updateTaskStatus(input.taskId, status, input.output);

        return {
          success: updated,
          task: {
            id: input.taskId,
            status,
            hasOutput: !!input.output,
          },
        };
      },
    },

    task_list: {
      name: 'task_list',
      description: 'List tasks',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Filter by session' },
          status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'], description: 'Filter by status' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = ListInputSchema.parse(params);
        const tasks = memory.listTasks(input.sessionId, input.status);

        return {
          count: tasks.length,
          tasks: tasks.map(t => ({
            id: t.id,
            agentType: t.agentType,
            status: t.status,
            hasInput: !!t.input,
            hasOutput: !!t.output,
            createdAt: t.createdAt.toISOString(),
            completedAt: t.completedAt?.toISOString(),
            sessionId: t.sessionId,
          })),
        };
      },
    },

    task_get: {
      name: 'task_get',
      description: 'Get a task by ID',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
        },
        required: ['taskId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = GetInputSchema.parse(params);
        const task = memory.getTask(input.taskId);

        if (!task) {
          return {
            found: false,
            message: 'Task not found',
          };
        }

        return {
          found: true,
          task: {
            id: task.id,
            agentType: task.agentType,
            status: task.status,
            input: task.input,
            output: task.output,
            createdAt: task.createdAt.toISOString(),
            completedAt: task.completedAt?.toISOString(),
            sessionId: task.sessionId,
          },
        };
      },
    },
  };
}
