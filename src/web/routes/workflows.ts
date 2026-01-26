/**
 * Workflow routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  getWorkflowRunner,
  docSyncConfig,
  fullStackFeatureConfig,
  type WorkflowConfig,
  type WorkflowPhase,
} from '../../workflows/index.js';
import { agentEvents } from '../websocket/event-bridge.js';
import type { LaunchWorkflowRequest } from '../types.js';

// Track running workflows
const runningWorkflows = new Map<string, {
  id: string;
  workflow: string;
  startedAt: Date;
  status: 'running' | 'completed' | 'failed';
  report?: unknown;
}>();

export function registerWorkflowRoutes(router: Router, _config: AgentStackConfig): void {
  // GET /api/v1/workflows - List available workflows
  router.get('/api/v1/workflows', (_req, res) => {
    // List built-in workflows
    const workflows = [
      {
        id: 'doc-sync',
        name: 'Documentation Sync',
        description: 'Synchronize documentation with codebase implementation',
        phases: docSyncConfig.phases,
      },
      {
        id: 'full-stack-feature',
        name: 'Full-Stack Feature Pipeline',
        description: 'End-to-end workflow for implementing a complete full-stack feature',
        phases: fullStackFeatureConfig.phases,
      },
    ];

    sendJson(res, workflows);
  });

  // POST /api/v1/workflows - Launch workflow
  router.post('/api/v1/workflows', async (_req, res, params) => {
    const body = params.body as LaunchWorkflowRequest | undefined;

    if (!body?.workflow) {
      throw badRequest('Workflow name is required');
    }

    const runner = getWorkflowRunner();

    // Prepare workflow config based on name
    let workflowConfig: WorkflowConfig;

    switch (body.workflow) {
      case 'doc-sync':
        workflowConfig = {
          ...docSyncConfig,
          ...body.config,
        } as WorkflowConfig;
        break;
      case 'full-stack-feature':
        workflowConfig = {
          ...fullStackFeatureConfig,
          ...body.config,
        } as WorkflowConfig;
        break;
      default:
        throw badRequest(`Unknown workflow: ${body.workflow}`);
    }

    const workflowId = `wf-${Date.now()}`;

    // Track the workflow
    runningWorkflows.set(workflowId, {
      id: workflowId,
      workflow: body.workflow,
      startedAt: new Date(),
      status: 'running',
    });

    // Emit start event
    agentEvents.emit('workflow:start', {
      workflowId,
      config: workflowConfig,
    });

    // Wire up event handlers
    runner.on('phase:start', (phase: WorkflowPhase) => {
      agentEvents.emit('workflow:phase', {
        workflowId,
        phase,
        status: 'started',
      });
    });

    runner.on('phase:complete', (result) => {
      agentEvents.emit('workflow:phase', {
        workflowId,
        phase: result.phase,
        status: 'completed',
      });
    });

    runner.on('finding', (finding) => {
      agentEvents.emit('workflow:finding', {
        workflowId,
        finding,
      });
    });

    // Run workflow asynchronously
    runner.run(workflowConfig)
      .then((report) => {
        const workflow = runningWorkflows.get(workflowId);
        if (workflow) {
          workflow.status = 'completed';
          workflow.report = report;
        }

        agentEvents.emit('workflow:complete', {
          workflowId,
          report,
        });
      })
      .catch((error) => {
        const workflow = runningWorkflows.get(workflowId);
        if (workflow) {
          workflow.status = 'failed';
          workflow.report = { error: error instanceof Error ? error.message : 'Unknown error' };
        }

        agentEvents.emit('workflow:error', {
          workflowId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    sendJson(res, {
      workflowId,
      workflow: body.workflow,
      status: 'running',
      startedAt: new Date().toISOString(),
    }, 202);
  });

  // GET /api/v1/workflows/running - List running workflows
  router.get('/api/v1/workflows/running', (_req, res) => {
    const workflows = Array.from(runningWorkflows.values()).map(w => ({
      ...w,
      startedAt: w.startedAt.toISOString(),
    }));

    sendJson(res, workflows);
  });

  // GET /api/v1/workflows/:id - Get workflow status/report
  router.get('/api/v1/workflows/:id', (_req, res, params) => {
    const workflowId = params.path[0];
    if (!workflowId) {
      throw badRequest('Workflow ID is required');
    }

    const workflow = runningWorkflows.get(workflowId);
    if (!workflow) {
      throw notFound('Workflow');
    }

    sendJson(res, {
      ...workflow,
      startedAt: workflow.startedAt.toISOString(),
    });
  });
}
