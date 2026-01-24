/**
 * Session MCP tools - start, end, status
 */

import { z } from 'zod';
import type { MemoryManager } from '../../memory/index.js';

// Input schemas
const StartInputSchema = z.object({
  metadata: z.record(z.unknown()).optional().describe('Session metadata'),
});

const EndInputSchema = z.object({
  sessionId: z.string().uuid().describe('Session ID to end'),
});

const StatusInputSchema = z.object({
  sessionId: z.string().uuid().optional().describe('Session ID (optional, uses active session)'),
});

export function createSessionTools(memory: MemoryManager) {
  return {
    session_start: {
      name: 'session_start',
      description: 'Start a new session',
      inputSchema: {
        type: 'object',
        properties: {
          metadata: { type: 'object', description: 'Session metadata' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = StartInputSchema.parse(params);

        try {
          const session = memory.createSession(input.metadata);

          return {
            success: true,
            session: {
              id: session.id,
              status: session.status,
              startedAt: session.startedAt.toISOString(),
              metadata: session.metadata,
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

    session_end: {
      name: 'session_end',
      description: 'End an active session',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID to end' },
        },
        required: ['sessionId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = EndInputSchema.parse(params);
        const ended = memory.endSession(input.sessionId);

        if (!ended) {
          return {
            success: false,
            error: 'Session not found or already ended',
          };
        }

        return {
          success: true,
          message: 'Session ended',
          sessionId: input.sessionId,
        };
      },
    },

    session_status: {
      name: 'session_status',
      description: 'Get session status',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID (optional, uses active session)' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = StatusInputSchema.parse(params);

        let session;
        if (input.sessionId) {
          session = memory.getSession(input.sessionId);
        } else {
          session = memory.getActiveSession();
        }

        if (!session) {
          return {
            found: false,
            message: input.sessionId ? 'Session not found' : 'No active session',
          };
        }

        // Get task counts for this session
        const allTasks = memory.listTasks(session.id);
        const pendingTasks = allTasks.filter(t => t.status === 'pending').length;
        const runningTasks = allTasks.filter(t => t.status === 'running').length;
        const completedTasks = allTasks.filter(t => t.status === 'completed').length;
        const failedTasks = allTasks.filter(t => t.status === 'failed').length;

        return {
          found: true,
          session: {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt.toISOString(),
            endedAt: session.endedAt?.toISOString(),
            metadata: session.metadata,
            tasks: {
              total: allTasks.length,
              pending: pendingTasks,
              running: runningTasks,
              completed: completedTasks,
              failed: failedTasks,
            },
          },
        };
      },
    },

    session_active: {
      name: 'session_active',
      description: 'Get the currently active session',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const session = memory.getActiveSession();

        if (!session) {
          return {
            active: false,
            message: 'No active session',
          };
        }

        return {
          active: true,
          session: {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt.toISOString(),
            metadata: session.metadata,
          },
        };
      },
    },
  };
}
