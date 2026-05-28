/**
 * GitHub webhook route handler.
 *
 * Mounts `POST /v1/github/webhook` on an `IntegrationRouter`. HMAC
 * verification is enforced when a secret is configured on the route. The
 * handler responds 200 to `ping` events and triggers the issue→PR workflow
 * when an issue is assigned to the configured bot user or a PR is opened
 * targeting an `aistack-claimed` issue.
 *
 * Runs on a separate listener from AIG-636's `WebhookServer` (which is
 * pinned to POST /v1/tasks). See src/transport/integration-router.ts.
 */

import { logger } from '../utils/logger.js';
import { runIssueToPRWorkflow, ingestIssue } from '../github/index.js';
import {
  beginIssueDispatch,
  finishIssueDispatch,
  type DispatchLease,
} from '../github/dispatch-dedupe.js';
import type { AgentStackConfig } from '../types.js';
import type { IntegrationRouter, IntegrationHandler } from './integration-router.js';

const log = logger.child('webhook:github');

export const GITHUB_WEBHOOK_PATH = '/v1/github/webhook';

export interface GitHubWebhookOptions {
  /** Username assigned issues must be routed to in order to trigger the workflow. */
  botLogin?: string;
  /** Route path override (defaults to `/v1/github/webhook`). */
  path?: string;
}

export interface RegisteredWebhook {
  path: string;
  /** Resolves once the most recently dispatched workflow completes (test helper). */
  lastInvocation: () => Promise<unknown> | null;
}

/**
 * Register the GitHub webhook route on an `IntegrationRouter`. Returns the
 * registered path and a `lastInvocation()` accessor used by tests to wait
 * for asynchronously-dispatched workflows.
 */
export function registerGitHubWebhook(
  router: IntegrationRouter,
  config: AgentStackConfig,
  opts: GitHubWebhookOptions = {}
): RegisteredWebhook {
  const path = opts.path ?? GITHUB_WEBHOOK_PATH;
  let lastInvocation: Promise<unknown> | null = null;

  const handler: IntegrationHandler = async (ctx, res) => {
    const eventHeader = ctx.headers['x-github-event'];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    if (event === 'ping') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ pong: true }));
      return;
    }

    let payload: GitHubPayload;
    try {
      payload = JSON.parse(ctx.rawBody.toString('utf-8')) as GitHubPayload;
    } catch (err) {
      log.warn('Malformed JSON payload', { err: (err as Error).message });
      res.statusCode = 400;
      res.end('invalid json');
      return;
    }

    const shouldRun = shouldDispatch(event, payload, opts.botLogin);
    if (!shouldRun.dispatch) {
      log.debug('Event ignored', { event, reason: shouldRun.reason });
      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ dispatched: false, reason: shouldRun.reason }));
      return;
    }

    const issueUrl = payload.issue?.html_url;
    if (!issueUrl) {
      res.statusCode = 400;
      res.end('missing issue url');
      return;
    }

    let lease: DispatchLease;
    try {
      lease = beginIssueDispatch(issueUrl);
    } catch (err) {
      log.warn('Invalid issue URL in webhook payload', { err: (err as Error).message, issueUrl });
      res.statusCode = 400;
      res.end('invalid issue url');
      return;
    }

    const deliveryHeader = ctx.headers['x-github-delivery'];
    const deliveryId = Array.isArray(deliveryHeader) ? deliveryHeader[0] : deliveryHeader;
    if (!lease.started) {
      log.info('Duplicate workflow dispatch suppressed', {
        event,
        issueUrl,
        key: lease.key,
        reason: lease.reason,
        deliveryId,
      });
      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ dispatched: false, reason: lease.reason, issueUrl }));
      return;
    }

    log.info('Dispatching workflow', { event, issueUrl, key: lease.key, deliveryId });
    lastInvocation = dispatchWorkflow(issueUrl, config)
      .then((value) => {
        finishIssueDispatch(lease.key, true);
        return value;
      })
      .catch((err) => {
        finishIssueDispatch(lease.key, false);
        log.error('Workflow dispatch failed', { err: (err as Error).message });
      });

    res.statusCode = 202;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ dispatched: true, issueUrl }));
  };

  router.addRoute({
    method: 'POST',
    path,
    handler,
    secret: config.github.webhookSecret,
    signatureFormat: 'github',
    signatureHeader: 'x-hub-signature-256',
  });

  log.info('GitHub webhook route registered', { path, hmac: Boolean(config.github.webhookSecret) });

  return {
    path,
    lastInvocation: () => lastInvocation,
  };
}

/* -------------------------------------------------------------------------- */

interface GitHubPayload {
  action?: string;
  assignee?: { login?: string };
  issue?: {
    html_url?: string;
    number?: number;
    labels?: Array<{ name?: string } | string>;
  };
  pull_request?: { html_url?: string };
  sender?: { login?: string };
}

interface DispatchDecision {
  dispatch: boolean;
  reason: string;
}

export function shouldDispatch(
  event: string | undefined,
  payload: GitHubPayload,
  botLogin?: string
): DispatchDecision {
  if (botLogin && payload.sender?.login?.toLowerCase() === botLogin.toLowerCase()) {
    return { dispatch: false, reason: `sender ${botLogin} is the bot` };
  }

  if (event === 'issues' && payload.action === 'assigned') {
    if (botLogin) {
      const assignee = payload.assignee?.login?.toLowerCase();
      if (assignee !== botLogin.toLowerCase()) {
        return { dispatch: false, reason: `assignee ${assignee} != bot ${botLogin}` };
      }
    }
    return { dispatch: true, reason: 'issue assigned' };
  }

  if (event === 'issues' && payload.action === 'labeled') {
    const labels = payload.issue?.labels ?? [];
    const claimed = labels.some((l) =>
      typeof l === 'string' ? l === 'aistack-claimed' : l.name === 'aistack-claimed'
    );
    if (claimed) return { dispatch: true, reason: 'aistack-claimed label added' };
  }

  return { dispatch: false, reason: `event ${event}/${payload.action} not actionable` };
}

async function dispatchWorkflow(issueUrl: string, config: AgentStackConfig): Promise<unknown> {
  const { issue, client } = await ingestIssue(issueUrl, {
    credentials: { token: config.github.token },
  });
  return runIssueToPRWorkflow(issue, client, config);
}
