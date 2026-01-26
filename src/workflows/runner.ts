/**
 * Workflow runner - orchestrates multi-phase workflows with agents
 */

import { EventEmitter } from 'node:events';
import type {
  WorkflowConfig,
  WorkflowContext,
  WorkflowPhase,
  PhaseResult,
  WorkflowReport,
  Finding,
} from './types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('workflow');

export interface WorkflowEvents {
  'workflow:start': (config: WorkflowConfig) => void;
  'workflow:complete': (report: WorkflowReport) => void;
  'workflow:error': (error: Error) => void;
  'phase:start': (phase: WorkflowPhase) => void;
  'phase:complete': (result: PhaseResult) => void;
  'finding': (finding: Finding) => void;
}

export type PhaseExecutor = (context: WorkflowContext) => Promise<PhaseResult>;

export class WorkflowRunner extends EventEmitter {
  private phaseExecutors: Map<WorkflowPhase, PhaseExecutor> = new Map();

  constructor() {
    super();
  }

  /**
   * Register a phase executor
   */
  registerPhase(phase: WorkflowPhase, executor: PhaseExecutor): void {
    this.phaseExecutors.set(phase, executor);
    log.debug('Registered phase executor', { phase });
  }

  /**
   * Run a workflow
   */
  async run(config: WorkflowConfig): Promise<WorkflowReport> {
    const context: WorkflowContext = {
      config,
      currentPhase: config.phases[0] as WorkflowPhase,
      iteration: 0,
      results: [],
      inventory: [],
      startedAt: new Date(),
    };

    log.info('Starting workflow', { id: config.id, name: config.name });
    this.emit('workflow:start', config);

    try {
      // Execute each phase
      for (const phase of config.phases) {
        context.currentPhase = phase as WorkflowPhase;
        const result = await this.executePhase(phase as WorkflowPhase, context);
        context.results.push(result);

        // Check for adversarial failure and reconciliation loop
        if (phase === 'adversarial' && !result.success) {
          context.verdict = 'FAIL';

          // Run reconciliation loop
          const maxIterations = config.maxIterations ?? 3;
          while (context.iteration < maxIterations && context.verdict === 'FAIL') {
            context.iteration++;
            log.info('Running reconciliation iteration', { iteration: context.iteration });

            // Re-run sync phase
            const syncResult = await this.executePhase('sync', context);
            context.results.push(syncResult);

            // Re-run adversarial
            const adversarialResult = await this.executePhase('adversarial', context);
            context.results.push(adversarialResult);

            if (adversarialResult.success) {
              context.verdict = 'PASS';
            }
          }
        }
      }

      // Set final verdict if not already set
      if (!context.verdict) {
        const lastAdversarial = context.results
          .filter(r => r.phase === 'adversarial')
          .pop();
        context.verdict = lastAdversarial?.success ? 'PASS' : 'FAIL';
      }

      const report = this.generateReport(context);
      this.emit('workflow:complete', report);
      log.info('Workflow completed', { id: config.id, verdict: context.verdict });

      return report;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('workflow:error', err);
      log.error('Workflow failed', { id: config.id, error: err.message });
      throw err;
    }
  }

  /**
   * Execute a single phase
   */
  private async executePhase(phase: WorkflowPhase, context: WorkflowContext): Promise<PhaseResult> {
    const executor = this.phaseExecutors.get(phase);

    if (!executor) {
      log.warn('No executor for phase, skipping', { phase });
      return {
        phase,
        success: true,
        findings: [],
        artifacts: {},
        duration: 0,
      };
    }

    log.info('Executing phase', { phase });
    this.emit('phase:start', phase);

    const startTime = Date.now();
    const result = await executor(context);
    result.duration = Date.now() - startTime;

    // Emit findings
    for (const finding of result.findings) {
      this.emit('finding', finding);
    }

    this.emit('phase:complete', result);
    log.info('Phase completed', { phase, success: result.success, findings: result.findings.length });

    return result;
  }

  /**
   * Generate workflow report
   */
  private generateReport(context: WorkflowContext): WorkflowReport {
    const completedAt = new Date();
    const allFindings = context.results.flatMap(r => r.findings);

    const findingsBySeverity = {
      low: allFindings.filter(f => f.severity === 'low').length,
      medium: allFindings.filter(f => f.severity === 'medium').length,
      high: allFindings.filter(f => f.severity === 'high').length,
    };

    // Count from sync results
    let sectionsRemoved = 0;
    let sectionsAdded = 0;
    let diagramsUpdated = 0;

    for (const result of context.results) {
      if (result.phase === 'sync' && result.artifacts.syncResults) {
        const syncResults = result.artifacts.syncResults as Array<{
          removed: string[];
          added: string[];
          diagrams: unknown[];
        }>;
        for (const sr of syncResults) {
          sectionsRemoved += sr.removed?.length ?? 0;
          sectionsAdded += sr.added?.length ?? 0;
          diagramsUpdated += sr.diagrams?.length ?? 0;
        }
      }
    }

    const confidence = this.generateConfidenceStatement(context);

    return {
      id: `report-${Date.now()}`,
      workflow: context.config.id,
      startedAt: context.startedAt,
      completedAt,
      duration: completedAt.getTime() - context.startedAt.getTime(),
      verdict: context.verdict ?? 'FAIL',
      phases: context.results,
      summary: {
        documentsScanned: context.inventory.length,
        documentsUpdated: context.inventory.filter(d => d.status === 'synced').length,
        sectionsRemoved,
        sectionsAdded,
        diagramsUpdated,
        findingsTotal: allFindings.length,
        findingsBySeverity,
      },
      confidence,
    };
  }

  /**
   * Generate confidence statement
   */
  private generateConfidenceStatement(context: WorkflowContext): string {
    const { verdict, inventory, results } = context;
    const totalDocs = inventory.length;
    const syncedDocs = inventory.filter(d => d.status === 'synced').length;
    const coverage = totalDocs > 0 ? Math.round((syncedDocs / totalDocs) * 100) : 0;

    const highFindings = results
      .flatMap(r => r.findings)
      .filter(f => f.severity === 'high').length;

    if (verdict === 'PASS' && highFindings === 0) {
      return `Documentation is ${coverage}% synchronized with codebase. All adversarial checks passed.`;
    } else if (verdict === 'PASS') {
      return `Documentation is ${coverage}% synchronized. ${highFindings} high-severity issues were resolved.`;
    } else {
      return `Documentation sync incomplete. ${highFindings} high-severity issues remain unresolved.`;
    }
  }
}

// Singleton instance
let runnerInstance: WorkflowRunner | null = null;

export function getWorkflowRunner(): WorkflowRunner {
  if (!runnerInstance) {
    runnerInstance = new WorkflowRunner();
  }
  return runnerInstance;
}

export function resetWorkflowRunner(): void {
  runnerInstance = null;
}
