/**
 * GitHub module exports
 */

export { GitHubClient, createGitHubClient, type GitHubClientOptions } from './client.js';
export {
  parseIssueUrl,
  createProviderClient,
  type ProviderName,
  type ProviderClient,
  type ProviderCredentials,
  type IssueDetails,
  type CreatePrParams,
  type CreatePrResult,
  type ParsedIssueUrl,
} from './providers.js';
export { ingestIssue, type IngestResult, type IngestOptions } from './ingest.js';
export {
  runIssueToPRWorkflow,
  type IssueToPrOptions,
  type IssueToPrResult,
  type WorkflowStatus,
} from './coordinator.js';
export { buildPrBody, type PrBodyInput } from './pr-body.js';
export {
  applyLifecycleLabel,
  DEFAULT_LABELS,
  type LifecyclePhase,
} from './labels.js';
