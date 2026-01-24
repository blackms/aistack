/**
 * Workflows module - Multi-phase workflow orchestration
 *
 * @packageDocumentation
 */

// Types
export type {
  WorkflowPhase,
  Severity,
  Verdict,
  WorkflowAgent,
  Finding,
  PhaseResult,
  WorkflowConfig,
  WorkflowContext,
  DocumentInfo,
  DocumentType,
  SyncResult,
  DocumentChange,
  DiagramUpdate,
  WorkflowReport,
} from './types.js';

// Runner
export {
  WorkflowRunner,
  getWorkflowRunner,
  resetWorkflowRunner,
  type PhaseExecutor,
  type WorkflowEvents,
} from './runner.js';

// Documentation Sync Workflow
export {
  docSyncConfig,
  inventoryPhase,
  analysisPhase,
  syncPhase,
  consistencyPhase,
  adversarialPhase,
  reconciliationPhase,
  registerDocSyncWorkflow,
  runDocSync,
} from './doc-sync.js';
