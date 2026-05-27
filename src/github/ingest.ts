/**
 * Issue ingest entry point.
 *
 * Given a GitHub or GitLab issue URL, fetches the issue and returns a
 * normalised record ready to feed the coordinator workflow.
 */

import { logger } from '../utils/logger.js';
import {
  createProviderClient,
  parseIssueUrl,
  type IssueDetails,
  type ProviderClient,
  type ProviderCredentials,
} from './providers.js';

const log = logger.child('github:ingest');

export interface IngestOptions {
  credentials?: ProviderCredentials;
  /** Override the provider client (used in tests) */
  client?: ProviderClient;
}

export interface IngestResult {
  issue: IssueDetails;
  client: ProviderClient;
}

/**
 * Parse the URL, instantiate the right provider client and fetch the issue.
 * Returns both the issue details and the client so the caller can re-use it
 * for follow-up operations (label updates, PR creation).
 */
export async function ingestIssue(url: string, opts: IngestOptions = {}): Promise<IngestResult> {
  const parsed = parseIssueUrl(url);
  log.info('Ingesting issue', { url, provider: parsed.provider, owner: parsed.owner, repo: parsed.repo, number: parsed.number });

  const client = opts.client ?? createProviderClient(parsed.provider, opts.credentials ?? {});
  const issue = await client.getIssue(parsed.owner, parsed.repo, parsed.number);
  log.debug('Issue fetched', { title: issue.title, labels: issue.labels.length, assignees: issue.assignees.length });
  return { issue, client };
}
