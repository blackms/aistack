/**
 * Session hooks - session-start, session-end
 */

import type { HookContext, AgentStackConfig } from '../types.js';
import { MemoryManager, getAccessControl } from '../memory/index.js';
import { listAgents, stopAgent } from '../agents/spawner.js';
import { logger } from '../utils/logger.js';

const log = logger.child('hooks:session');

/**
 * Session start hook
 * Called when a new session begins
 */
export async function sessionStartHook(
  context: HookContext,
  memory: MemoryManager,
  _config: AgentStackConfig
): Promise<void> {
  log.debug('Session start hook triggered', { sessionId: context.sessionId });

  // Create session if not exists
  if (!context.sessionId) {
    const session = memory.createSession(context.data);
    context.sessionId = session.id;
    log.info('Session created', { sessionId: session.id });
  }

  // Store session start in memory for persistence
  await memory.store(
    `session:${context.sessionId}:start`,
    JSON.stringify({
      startedAt: new Date().toISOString(),
      metadata: context.data,
    }),
    {
      namespace: 'sessions',
      metadata: {
        type: 'session-start',
        sessionId: context.sessionId,
      },
    }
  );
}

/**
 * Session end hook
 * Called when a session ends
 */
export async function sessionEndHook(
  context: HookContext,
  memory: MemoryManager,
  _config: AgentStackConfig
): Promise<void> {
  log.debug('Session end hook triggered', { sessionId: context.sessionId });

  if (!context.sessionId) {
    log.warn('Session end hook called without session ID');
    return;
  }

  // End the session
  const ended = memory.endSession(context.sessionId);

  if (ended) {
    log.info('Session ended', { sessionId: context.sessionId });

    // Store session end in memory (in sessions namespace, not session namespace)
    await memory.store(
      `session:${context.sessionId}:end`,
      JSON.stringify({
        endedAt: new Date().toISOString(),
        metadata: context.data,
      }),
      {
        namespace: 'sessions',
        metadata: {
          type: 'session-end',
          sessionId: context.sessionId,
        },
      }
    );

    // Clean up session memory
    const accessControl = getAccessControl();
    const sessionNamespace = accessControl.getSessionNamespace(context.sessionId);
    const deletedCount = memory.getStore().deleteByNamespace(sessionNamespace);
    log.info('Session memory cleaned', { sessionId: context.sessionId, deletedEntries: deletedCount });

    // Stop all agents in this session
    const sessionAgents = listAgents(context.sessionId);
    for (const agent of sessionAgents) {
      stopAgent(agent.id);
    }
    if (sessionAgents.length > 0) {
      log.info('Session agents stopped', { sessionId: context.sessionId, agentCount: sessionAgents.length });
    }
  } else {
    log.warn('Failed to end session', { sessionId: context.sessionId });
  }
}
