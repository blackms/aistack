/**
 * Workflow hook handler
 *
 * Triggers workflows based on conditions
 */

import type { HookContext, AgentStackConfig } from '../types.js';
import type { MemoryManager } from '../memory/index.js';
import { getWorkflowRunner, registerDocSyncWorkflow, docSyncConfig } from '../workflows/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('workflow-hook');

export interface WorkflowTrigger {
  id: string;
  name: string;
  condition: (context: HookContext) => boolean;
  workflowId: string;
  options?: Record<string, unknown>;
}

// Registered workflow triggers
const triggers: WorkflowTrigger[] = [];

/**
 * Register a workflow trigger
 */
export function registerWorkflowTrigger(trigger: WorkflowTrigger): void {
  triggers.push(trigger);
  log.debug('Registered workflow trigger', { id: trigger.id, name: trigger.name });
}

/**
 * Unregister a workflow trigger
 */
export function unregisterWorkflowTrigger(triggerId: string): boolean {
  const index = triggers.findIndex(t => t.id === triggerId);
  if (index >= 0) {
    triggers.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Get all registered triggers
 */
export function getWorkflowTriggers(): WorkflowTrigger[] {
  return [...triggers];
}

/**
 * Clear all triggers
 */
export function clearWorkflowTriggers(): void {
  triggers.length = 0;
}

/**
 * Workflow hook - executes workflows based on triggers
 */
export async function workflowHook(
  context: HookContext,
  memory: MemoryManager,
  config: AgentStackConfig
): Promise<void> {
  const workflowId = context.data?.workflowId as string | undefined;

  // If specific workflow requested
  if (workflowId) {
    await executeWorkflow(workflowId, context, memory);
    return;
  }

  // Check triggers
  for (const trigger of triggers) {
    if (trigger.condition(context)) {
      log.info('Trigger matched, executing workflow', {
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
      });
      await executeWorkflow(trigger.workflowId, context, memory, trigger.options);
    }
  }
}

/**
 * Execute a workflow by ID
 */
async function executeWorkflow(
  workflowId: string,
  context: HookContext,
  memory: MemoryManager,
  options?: Record<string, unknown>
): Promise<void> {
  const runner = getWorkflowRunner();

  try {
    switch (workflowId) {
      case 'documentation_truth_sync_with_adversarial_review':
      case 'doc-sync': {
        registerDocSyncWorkflow();
        const config = { ...docSyncConfig };

        // Apply options
        if (options?.targetDirectory) {
          config.inputs.targetDirectory = options.targetDirectory as string;
        }
        if (options?.sourceCode) {
          config.inputs.sourceCode = options.sourceCode as string;
        }

        const report = await runner.run(config);

        // Store report in memory
        await memory.store(
          `workflow-report-${report.id}`,
          JSON.stringify(report, null, 2),
          {
            namespace: 'workflows',
            metadata: {
              workflowId,
              verdict: report.verdict,
              completedAt: report.completedAt.toISOString(),
            },
          }
        );

        log.info('Workflow completed', {
          workflowId,
          verdict: report.verdict,
          documentsScanned: report.summary.documentsScanned,
          findings: report.summary.findingsTotal,
        });
        break;
      }

      default:
        log.warn('Unknown workflow', { workflowId });
    }
  } catch (error) {
    log.error('Workflow execution failed', {
      workflowId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Default triggers
 */
export function registerDefaultTriggers(): void {
  // Trigger doc-sync when docs directory changes
  registerWorkflowTrigger({
    id: 'doc-sync-on-change',
    name: 'Documentation Sync on Change',
    condition: (context) => {
      const path = context.data?.path as string | undefined;
      return path?.includes('/docs/') || path?.endsWith('.md') || false;
    },
    workflowId: 'doc-sync',
    options: {
      targetDirectory: './docs',
      sourceCode: '.',
    },
  });
}
