/**
 * Issue → draft PR workflow coordinator.
 *
 * High-level flow (all steps best-effort; failures surface as `status: failed`
 * on the returned result so the CLI / webhook handler can decide how to
 * propagate them):
 *
 *   1. Mark issue as `aistack-claimed` (idempotent label update).
 *   2. Spawn a coordinator agent to produce a structured plan from the issue.
 *   3. Run the existing review loop (coder + adversarial) on the plan.
 *   4. Update issue label to `aistack-in-progress` while the loop runs and
 *      `aistack-blocked-needs-human` if the loop exhausts iterations.
 *   5. Render the PR body and open a draft PR/MR via the provider client.
 *   6. Flip the label to `aistack-done` once the PR is open.
 *
 * The coordinator is intentionally tolerant of missing pieces (no git push,
 * no real branch creation) so it can be exercised end-to-end against the
 * provider APIs in test environments where the agent runtime is stubbed.
 */

import { randomUUID } from 'node:crypto';
import { spawnAgent, executeAgent, updateAgentStatus, stopAgent } from '../agents/spawner.js';
import { ReviewLoopCoordinator } from '../coordination/review-loop.js';
import { logger } from '../utils/logger.js';
import type { AgentStackConfig, ReviewResult } from '../types.js';
import type { IssueDetails, ProviderClient, CreatePrResult } from './providers.js';
import { applyLifecycleLabel } from './labels.js';
import { buildPrBody } from './pr-body.js';

const log = logger.child('github:coordinator');

export interface IssueToPrOptions {
  /** Override the head branch used in the draft PR. Defaults to `aistack/<provider>-<number>-<uuid>`. */
  head?: string;
  /** Base branch for the draft PR. Defaults to `main`. */
  base?: string;
  /** Maximum review loop iterations. Defaults to 2 (coordinator → coder → review). */
  maxIterations?: number;
  /** When true, skip the actual PR creation (used by tests / dry-run). */
  dryRun?: boolean;
  /** When true, skip writing labels on the source issue. */
  skipLabels?: boolean;
}

export type WorkflowStatus = 'success' | 'blocked' | 'failed';

export interface IssueToPrResult {
  status: WorkflowStatus;
  issue: IssueDetails;
  branch: string;
  plan: string;
  reviews: ReviewResult[];
  pullRequest?: CreatePrResult;
  prBody: string;
  error?: string;
}

/**
 * Run the full issue → draft PR workflow.
 */
export async function runIssueToPRWorkflow(
  issue: IssueDetails,
  client: ProviderClient,
  config: AgentStackConfig,
  opts: IssueToPrOptions = {}
): Promise<IssueToPrResult> {
  const branch = opts.head ?? `aistack/${issue.provider}-${issue.number}-${randomUUID().slice(0, 8)}`;
  const base = opts.base ?? 'main';
  const labelOverrides = config.github.labels;

  log.info('Starting issue→PR workflow', {
    provider: issue.provider,
    owner: issue.owner,
    repo: issue.repo,
    number: issue.number,
    branch,
  });

  // 1. Claim
  let labels = issue.labels.slice();
  if (!opts.skipLabels) {
    try {
      labels = await applyLifecycleLabel(client, issue.owner, issue.repo, issue.number, 'claimed', labels, labelOverrides);
    } catch (err) {
      log.warn('Failed to apply claimed label', { err: (err as Error).message });
    }
  }

  // 2. Plan
  let plan = '';
  try {
    plan = await generatePlan(issue, config);
  } catch (err) {
    return finishFailure(client, issue, labels, branch, '', [], opts, labelOverrides, `plan generation failed: ${(err as Error).message}`);
  }

  // 3. Review loop on the plan + issue body
  if (!opts.skipLabels) {
    try {
      labels = await applyLifecycleLabel(client, issue.owner, issue.repo, issue.number, 'inProgress', labels, labelOverrides);
    } catch (err) {
      log.warn('Failed to apply in-progress label', { err: (err as Error).message });
    }
  }

  let reviews: ReviewResult[] = [];
  let approved = false;
  try {
    const loopResult = await runReviewLoop(issue, plan, config, opts.maxIterations ?? 2);
    reviews = loopResult.reviews;
    approved = loopResult.approved;
  } catch (err) {
    return finishFailure(client, issue, labels, branch, plan, reviews, opts, labelOverrides, `review loop failed: ${(err as Error).message}`);
  }

  // 4. Build PR body
  const auditUrl = renderAuditUrl(config, issue);
  const prBody = buildPrBody({ issue, plan, reviews, auditUrl, branch });

  if (!approved) {
    // Mark blocked and stop short of opening a PR
    if (!opts.skipLabels) {
      try {
        await applyLifecycleLabel(client, issue.owner, issue.repo, issue.number, 'blocked', labels, labelOverrides);
      } catch (err) {
        log.warn('Failed to apply blocked label', { err: (err as Error).message });
      }
    }
    return {
      status: 'blocked',
      issue,
      branch,
      plan,
      reviews,
      prBody,
      error: 'adversarial review did not approve within iteration budget',
    };
  }

  // 5. Open draft PR
  if (opts.dryRun) {
    if (!opts.skipLabels) {
      try {
        await applyLifecycleLabel(client, issue.owner, issue.repo, issue.number, 'done', labels, labelOverrides);
      } catch (err) {
        log.warn('Failed to apply done label during dry run', { err: (err as Error).message });
      }
    }
    log.info('Dry run: skipping PR creation');
    return { status: 'success', issue, branch, plan, reviews, prBody };
  }

  let pr: CreatePrResult;
  try {
    pr = await client.createPullRequest(issue.owner, issue.repo, {
      title: `[aistack] ${issue.title}`,
      body: prBody,
      head: branch,
      base,
      draft: true,
    });
  } catch (err) {
    return finishFailure(client, issue, labels, branch, plan, reviews, opts, labelOverrides, `PR creation failed: ${(err as Error).message}`);
  }

  // 6. Done label
  if (!opts.skipLabels) {
    try {
      await applyLifecycleLabel(client, issue.owner, issue.repo, issue.number, 'done', labels, labelOverrides);
    } catch (err) {
      log.warn('Failed to apply done label', { err: (err as Error).message });
    }
  }

  log.info('Workflow completed', { pr: pr.url });
  return { status: 'success', issue, branch, plan, reviews, pullRequest: pr, prBody };
}

/* -------------------------------------------------------------------------- */

async function generatePlan(issue: IssueDetails, config: AgentStackConfig): Promise<string> {
  const agent = spawnAgent('coordinator', { name: `issue-${issue.number}-planner-${randomUUID().slice(0, 6)}` }, config);
  try {
    updateAgentStatus(agent.id, 'running');
    const prompt = `You are coordinating an autonomous code change in response to an issue.

## Issue (${issue.provider} ${issue.owner}/${issue.repo} #${issue.number})
Title: ${issue.title}

${issue.body || '_(no body)_'}

Produce a concise markdown plan with:
1. Goal restated in 1-2 sentences
2. Files to touch (best guess) with one-line reason each
3. Steps (numbered) the coder agent should follow
4. Verification steps the tester agent should run

Output only the markdown plan, no preamble.`;
    const result = await executeAgent(agent.id, prompt, config);
    return result.response.trim();
  } finally {
    updateAgentStatus(agent.id, 'idle');
    stopAgent(agent.id);
  }
}

async function runReviewLoop(
  issue: IssueDetails,
  plan: string,
  config: AgentStackConfig,
  maxIterations: number
): Promise<{ reviews: ReviewResult[]; approved: boolean }> {
  const codeInput = `Implement the following plan for issue ${issue.provider} ${issue.owner}/${issue.repo} #${issue.number}.

## Issue
${issue.title}

${issue.body}

## Plan
${plan}`;

  const loop = new ReviewLoopCoordinator(codeInput, config, { maxIterations });
  try {
    const state = await loop.start();
    return { reviews: state.reviews, approved: state.status === 'approved' };
  } finally {
    loop.cleanup();
  }
}

function renderAuditUrl(config: AgentStackConfig, issue: IssueDetails): string | undefined {
  const template = config.github.auditUrlTemplate;
  if (!template) return undefined;
  return template
    .replace('{provider}', issue.provider)
    .replace('{owner}', issue.owner)
    .replace('{repo}', issue.repo)
    .replace('{number}', String(issue.number));
}

async function finishFailure(
  client: ProviderClient,
  issue: IssueDetails,
  labels: string[],
  branch: string,
  plan: string,
  reviews: ReviewResult[],
  opts: IssueToPrOptions,
  labelOverrides: AgentStackConfig['github']['labels'] | undefined,
  message: string
): Promise<IssueToPrResult> {
  log.error('Workflow failed', { message });
  if (!opts.skipLabels) {
    try {
      await applyLifecycleLabel(client, issue.owner, issue.repo, issue.number, 'blocked', labels, labelOverrides);
    } catch (err) {
      log.warn('Failed to apply blocked label on failure', { err: (err as Error).message });
    }
  }
  return {
    status: 'failed',
    issue,
    branch,
    plan,
    reviews,
    prBody: '',
    error: message,
  };
}
