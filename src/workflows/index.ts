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

// Full-Stack Feature Pipeline Workflow
export {
  fullStackFeatureConfig,
  requirementsPhase,
  architecturePhase,
  researchPhase,
  backendPhase,
  frontendPhase,
  testingPhase,
  reviewPhase,
  documentationPhase,
  phaseExecutors,
  type FeaturePhase,
  type FeatureWorkflowConfig,
} from './full-stack-feature.js';
