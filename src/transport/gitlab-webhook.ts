/**
 * GitLab webhook route handler.
 *
 * GitLab signs payloads by echoing the configured secret token verbatim in
 * the `X-Gitlab-Token` header (no HMAC). We reuse `IntegrationRouter`'s
 * `signatureFormat: 'gitlab'` mode which performs a constant-time comparison
 * between the header value and the secret.
 */

import { logger } from '../utils/logger.js';
import { runIssueToPRWorkflow, ingestIssue } from '../github/index.js';
import type { AgentStackConfig } from '../types.js';
import type { IntegrationRouter, IntegrationHandler } from './integration-router.js';

const log = logger.child('webhook:gitlab');

export const GITLAB_WEBHOOK_PATH = '/v1/gitlab/webhook';

export interface GitLabWebhookOptions {
  botUsername?: string;
  path?: string;
}

export interface RegisteredGitLabWebhook {
  path: string;
  lastInvocation: () => Promise<unknown> | null;
}

export function registerGitLabWebhook(
  router: IntegrationRouter,
  config: AgentStackConfig,
  opts: GitLabWebhookOptions = {}
): RegisteredGitLabWebhook {
  const path = opts.path ?? GITLAB_WEBHOOK_PATH;
  let lastInvocation: Promise<unknown> | null = null;

  const handler: IntegrationHandler = async (ctx, res) => {
    const eventHeader = ctx.headers['x-gitlab-event'];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    let payload: GitLabPayload;
    try {
      payload = JSON.parse(ctx.rawBody.toString('utf-8')) as GitLabPayload;
    } catch (err) {
      log.warn('Malformed JSON payload', { err: (err as Error).message });
      res.statusCode = 400;
      res.end('invalid json');
      return;
    }

    const decision = shouldDispatchGitLab(event, payload, opts.botUsername);
    if (!decision.dispatch) {
      log.debug('Event ignored', { event, reason: decision.reason });
      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ dispatched: false, reason: decision.reason }));
      return;
    }

    const issueUrl = payload.object_attributes?.url;
    if (!issueUrl) {
      res.statusCode = 400;
      res.end('missing issue url');
      return;
    }

    log.info('Dispatching GitLab workflow', { event, issueUrl });
    lastInvocation = dispatchWorkflow(issueUrl, config).catch((err) => {
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
    secret: config.github.gitlabWebhookSecret,
    signatureFormat: 'gitlab',
    signatureHeader: 'x-gitlab-token',
  });

  log.info('GitLab webhook route registered', { path, secret: Boolean(config.github.gitlabWebhookSecret) });

  return { path, lastInvocation: () => lastInvocation };
}

/* -------------------------------------------------------------------------- */

interface GitLabPayload {
  object_kind?: string;
  event_type?: string;
  user?: { username?: string };
  assignees?: Array<{ username?: string }>;
  object_attributes?: {
    url?: string;
    action?: string;
    iid?: number;
  };
}

interface DispatchDecision {
  dispatch: boolean;
  reason: string;
}

export function shouldDispatchGitLab(
  event: string | undefined,
  payload: GitLabPayload,
  botUsername?: string
): DispatchDecision {
  const kind = payload.object_kind ?? event?.toLowerCase();
  if (kind === 'issue' && (payload.object_attributes?.action === 'update' || payload.object_attributes?.action === 'open')) {
    if (botUsername) {
      const assignees = payload.assignees ?? [];
      const matched = assignees.some((a) => a.username?.toLowerCase() === botUsername.toLowerCase());
      if (!matched) return { dispatch: false, reason: `bot ${botUsername} not assigned` };
    }
    return { dispatch: true, reason: 'issue event matched' };
  }
  return { dispatch: false, reason: `event ${kind}/${payload.object_attributes?.action} not actionable` };
}

async function dispatchWorkflow(issueUrl: string, config: AgentStackConfig): Promise<unknown> {
  const { issue, client } = await ingestIssue(issueUrl, {
    credentials: { token: config.github.gitlabToken },
  });
  return runIssueToPRWorkflow(issue, client, config);
}
