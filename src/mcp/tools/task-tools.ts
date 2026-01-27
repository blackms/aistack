/**
 * Task MCP tools - create, assign, complete, list
 */

import { z } from 'zod';
import type { MemoryManager } from '../../memory/index.js';
import type { DriftDetectionService } from '../../tasks/drift-detection-service.js';

// Input schemas
const CreateInputSchema = z.object({
  agentType: z.string().min(1).describe('Agent type for this task'),
  input: z.string().optional().describe('Task input/description'),
  sessionId: z.string().uuid().optional().describe('Session to associate with'),
  parentTaskId: z.string().uuid().optional().describe('Parent task ID for drift detection'),
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

const CheckDriftInputSchema = z.object({
  taskInput: z.string().min(1).describe('Task input/description to check'),
  taskType: z.string().min(1).describe('Agent type for this task'),
  parentTaskId: z.string().uuid().optional().describe('Parent task ID to check against'),
});

const GetRelationshipsInputSchema = z.object({
  taskId: z.string().uuid().describe('Task ID'),
  direction: z.enum(['outgoing', 'incoming', 'both']).optional().describe('Relationship direction'),
});

export function createTaskTools(memory: MemoryManager, driftService?: DriftDetectionService) {
  return {
    task_create: {
      name: 'task_create',
      description: 'Create a new task with optional drift detection',
      inputSchema: {
        type: 'object',
        properties: {
          agentType: { type: 'string', description: 'Agent type for this task' },
          input: { type: 'string', description: 'Task input/description' },
          sessionId: { type: 'string', description: 'Session to associate with' },
          parentTaskId: { type: 'string', description: 'Parent task ID for drift detection' },
        },
        required: ['agentType'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = CreateInputSchema.parse(params);

        try {
          // Check for drift if service is available and input is provided
          let driftResult = null;
          if (driftService && input.input && input.parentTaskId) {
            driftResult = await driftService.checkDrift(
              input.input,
              input.agentType,
              input.parentTaskId
            );

            // If drift prevention is enabled and drift was detected, block creation
            if (driftResult.action === 'prevented') {
              return {
                success: false,
                error: 'Task creation prevented due to semantic drift',
                drift: {
                  isDrift: true,
                  highestSimilarity: driftResult.highestSimilarity,
                  mostSimilarTaskId: driftResult.mostSimilarTaskId,
                  mostSimilarTaskInput: driftResult.mostSimilarTaskInput,
                  action: driftResult.action,
                },
              };
            }
          }

          const task = memory.createTask(
            input.agentType,
            input.input,
            input.sessionId
          );

          // Index the task for future drift detection
          if (driftService && input.input) {
            await driftService.indexTask(task.id, input.input);
          }

          // Create relationship with parent if provided
          if (driftService && input.parentTaskId) {
            driftService.createTaskRelationship(
              input.parentTaskId,
              task.id,
              'parent_of'
            );
          }

          return {
            success: true,
            task: {
              id: task.id,
              agentType: task.agentType,
              status: task.status,
              createdAt: task.createdAt.toISOString(),
              sessionId: task.sessionId,
              parentTaskId: input.parentTaskId,
            },
            drift: driftResult ? {
              isDrift: driftResult.isDrift,
              highestSimilarity: driftResult.highestSimilarity,
              mostSimilarTaskId: driftResult.mostSimilarTaskId,
              action: driftResult.action,
            } : undefined,
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

    task_check_drift: {
      name: 'task_check_drift',
      description: 'Check if a task description would trigger drift detection against ancestors',
      inputSchema: {
        type: 'object',
        properties: {
          taskInput: { type: 'string', description: 'Task input/description to check' },
          taskType: { type: 'string', description: 'Agent type for this task' },
          parentTaskId: { type: 'string', description: 'Parent task ID to check against' },
        },
        required: ['taskInput', 'taskType'],
      },
      handler: async (params: Record<string, unknown>) => {
        if (!driftService) {
          return {
            success: false,
            error: 'Drift detection service not available',
          };
        }

        const input = CheckDriftInputSchema.parse(params);

        try {
          const result = await driftService.checkDrift(
            input.taskInput,
            input.taskType,
            input.parentTaskId
          );

          return {
            success: true,
            result: {
              isDrift: result.isDrift,
              highestSimilarity: result.highestSimilarity,
              mostSimilarTaskId: result.mostSimilarTaskId,
              mostSimilarTaskInput: result.mostSimilarTaskInput,
              action: result.action,
              checkedAncestors: result.checkedAncestors,
            },
            config: {
              enabled: driftService.isEnabled(),
              threshold: driftService.getConfig().threshold,
              warningThreshold: driftService.getConfig().warningThreshold,
              behavior: driftService.getConfig().behavior,
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

    task_get_relationships: {
      name: 'task_get_relationships',
      description: 'Get relationships for a task (parent/child, dependencies)',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], description: 'Relationship direction' },
        },
        required: ['taskId'],
      },
      handler: async (params: Record<string, unknown>) => {
        if (!driftService) {
          return {
            success: false,
            error: 'Drift detection service not available',
          };
        }

        const input = GetRelationshipsInputSchema.parse(params);

        try {
          const relationships = driftService.getTaskRelationships(
            input.taskId,
            input.direction ?? 'both'
          );

          return {
            success: true,
            count: relationships.length,
            relationships: relationships.map(r => ({
              id: r.id,
              fromTaskId: r.fromTaskId,
              toTaskId: r.toTaskId,
              relationshipType: r.relationshipType,
              metadata: r.metadata,
              createdAt: r.createdAt.toISOString(),
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    task_drift_metrics: {
      name: 'task_drift_metrics',
      description: 'Get drift detection metrics and statistics',
      inputSchema: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO date string to filter metrics since' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        if (!driftService) {
          return {
            success: false,
            error: 'Drift detection service not available',
          };
        }

        try {
          const since = params.since ? new Date(params.since as string) : undefined;
          const metrics = driftService.getDriftDetectionMetrics(since);
          const recentEvents = driftService.getRecentDriftEvents(10);

          return {
            success: true,
            metrics: {
              totalEvents: metrics.totalEvents,
              allowedCount: metrics.allowedCount,
              warnedCount: metrics.warnedCount,
              preventedCount: metrics.preventedCount,
              averageSimilarity: metrics.averageSimilarity,
            },
            recentEvents: recentEvents.map(e => ({
              id: e.id,
              taskId: e.taskId,
              taskType: e.taskType,
              ancestorTaskId: e.ancestorTaskId,
              similarityScore: e.similarityScore,
              actionTaken: e.actionTaken,
              createdAt: e.createdAt.toISOString(),
            })),
            config: {
              enabled: driftService.isEnabled(),
              threshold: driftService.getConfig().threshold,
              warningThreshold: driftService.getConfig().warningThreshold,
              ancestorDepth: driftService.getConfig().ancestorDepth,
              behavior: driftService.getConfig().behavior,
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
  };
}
