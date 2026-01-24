/**
 * Task hooks - pre-task, post-task
 */

import type { HookContext, AgentStackConfig } from '../types.js';
import { MemoryManager } from '../memory/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('hooks:task');

/**
 * Pre-task hook
 * Called before an agent starts a task
 */
export async function preTaskHook(
  context: HookContext,
  memory: MemoryManager,
  _config: AgentStackConfig
): Promise<void> {
  log.debug('Pre-task hook triggered', {
    taskId: context.taskId,
    agentType: context.agentType,
  });

  // Load relevant context for the task
  if (context.agentType) {
    // Search for relevant previous work
    const relevantMemories = await memory.search(`${context.agentType} task`, {
      namespace: 'tasks',
      limit: 5,
    });

    // Attach relevant context to the hook context
    if (relevantMemories.length > 0) {
      context.data = {
        ...context.data,
        previousContext: relevantMemories.map(m => ({
          key: m.entry.key,
          content: m.entry.content,
          score: m.score,
        })),
      };

      log.debug('Loaded previous context', {
        taskId: context.taskId,
        contextCount: relevantMemories.length,
      });
    }
  }

  // Record task start
  if (context.taskId) {
    await memory.store(
      `task:${context.taskId}:pre`,
      JSON.stringify({
        startedAt: new Date().toISOString(),
        agentType: context.agentType,
        sessionId: context.sessionId,
      }),
      {
        namespace: 'tasks',
        metadata: {
          type: 'pre-task',
          taskId: context.taskId,
          agentType: context.agentType,
        },
      }
    );
  }
}

/**
 * Post-task hook
 * Called after an agent completes a task
 */
export async function postTaskHook(
  context: HookContext,
  memory: MemoryManager,
  _config: AgentStackConfig
): Promise<void> {
  log.debug('Post-task hook triggered', {
    taskId: context.taskId,
    agentType: context.agentType,
  });

  // Store task result for future reference
  if (context.taskId && context.data) {
    await memory.store(
      `task:${context.taskId}:post`,
      JSON.stringify({
        completedAt: new Date().toISOString(),
        agentType: context.agentType,
        sessionId: context.sessionId,
        result: context.data,
      }),
      {
        namespace: 'tasks',
        metadata: {
          type: 'post-task',
          taskId: context.taskId,
          agentType: context.agentType,
        },
        generateEmbedding: true, // Index for future retrieval
      }
    );

    log.debug('Stored task result', { taskId: context.taskId });
  }
}
