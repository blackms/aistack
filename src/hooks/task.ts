/**
 * Task hooks - pre-task, post-task
 */

import type { HookContext, AgentStackConfig } from '../types.js';
import { MemoryManager } from '../memory/index.js';
import { logger } from '../utils/logger.js';
import { getWorkflowTriggers } from './workflow.js';
import { getWorkflowRunner, registerDocSyncWorkflow, docSyncConfig } from '../workflows/index.js';

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

  // Check if task modified documentation files
  await checkDocumentationTrigger(context, memory);
}

/**
 * Check if task modified documentation and trigger sync workflow
 */
async function checkDocumentationTrigger(
  context: HookContext,
  memory: MemoryManager
): Promise<void> {
  const modifiedFiles = context.data?.modifiedFiles as string[] | undefined;

  if (!modifiedFiles || modifiedFiles.length === 0) {
    return;
  }

  // Check if any modified file is documentation
  const hasDocChanges = modifiedFiles.some(
    (file) => file.includes('/docs/') || file.endsWith('.md') || file.endsWith('.mdx')
  );

  if (!hasDocChanges) {
    return;
  }

  log.info('Documentation changes detected, checking triggers', {
    files: modifiedFiles.filter((f) => f.includes('/docs/') || f.endsWith('.md')),
  });

  // Check registered triggers
  const triggers = getWorkflowTriggers();
  const docSyncTrigger = triggers.find((t) => t.workflowId === 'doc-sync');

  if (docSyncTrigger) {
    log.info('Running doc-sync workflow via trigger');

    try {
      const runner = getWorkflowRunner();
      registerDocSyncWorkflow();

      const config = { ...docSyncConfig };
      if (docSyncTrigger.options?.targetDirectory) {
        config.inputs.targetDirectory = docSyncTrigger.options.targetDirectory as string;
      }

      const report = await runner.run(config);

      // Store workflow report
      await memory.store(
        `workflow-report-${report.id}`,
        JSON.stringify(report, null, 2),
        {
          namespace: 'workflows',
          metadata: {
            triggeredBy: 'post-task',
            taskId: context.taskId,
            verdict: report.verdict,
          },
        }
      );

      log.info('Doc-sync workflow completed', {
        verdict: report.verdict,
        documentsScanned: report.summary.documentsScanned,
        findings: report.summary.findingsTotal,
      });
    } catch (error) {
      log.error('Doc-sync workflow failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
