/**
 * Webhook server + GitHub/GitLab route handler tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookServer, verifyHmacSignature } from '../../../src/transport/webhook.js';
import {
  shouldDispatch,
  registerGitHubWebhook,
  GITHUB_WEBHOOK_PATH,
} from '../../../src/transport/github-webhook.js';
import { shouldDispatchGitLab } from '../../../src/transport/gitlab-webhook.js';
import type { AgentStackConfig } from '../../../src/types.js';

function baseConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: { path: ':memory:', defaultNamespace: 'default', vectorSearch: { enabled: false } },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: true, webhookSecret: 'topsecret' },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
  };
}

describe('verifyHmacSignature', () => {
  it('verifies a github sha256 signature', () => {
    const payload = Buffer.from('{"hello":"world"}');
    const secret = 'topsecret';
    const sig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(verifyHmacSignature(payload, sig, secret, 'github')).toBe(true);
  });

  it('rejects a wrong github signature', () => {
    expect(verifyHmacSignature(Buffer.from('x'), 'sha256=deadbeef', 'secret', 'github')).toBe(false);
  });

  it('accepts a matching gitlab raw token in constant time', () => {
    expect(verifyHmacSignature(Buffer.from('payload'), 'topsecret', 'topsecret', 'gitlab')).toBe(true);
  });

  it('rejects mismatched gitlab tokens', () => {
    expect(verifyHmacSignature(Buffer.from('payload'), 'nope', 'topsecret', 'gitlab')).toBe(false);
  });

  it('rejects when no signature is provided', () => {
    expect(verifyHmacSignature(Buffer.from('x'), undefined, 'topsecret', 'github')).toBe(false);
  });
});

describe('shouldDispatch (GitHub)', () => {
  it('dispatches on issues.assigned matching the bot login', () => {
    const d = shouldDispatch(
      'issues',
      { action: 'assigned', assignee: { login: 'aistack-bot' }, issue: { html_url: 'x' } },
      'aistack-bot'
    );
    expect(d.dispatch).toBe(true);
  });

  it('ignores assignments to a different user', () => {
    const d = shouldDispatch(
      'issues',
      { action: 'assigned', assignee: { login: 'someone-else' }, issue: { html_url: 'x' } },
      'aistack-bot'
    );
    expect(d.dispatch).toBe(false);
  });

  it('dispatches when aistack-claimed label is added', () => {
    const d = shouldDispatch(
      'issues',
      { action: 'labeled', issue: { html_url: 'x', labels: [{ name: 'aistack-claimed' }] } }
    );
    expect(d.dispatch).toBe(true);
  });

  it('ignores unrelated events', () => {
    const d = shouldDispatch('push', {});
    expect(d.dispatch).toBe(false);
  });
});

describe('shouldDispatchGitLab', () => {
  it('dispatches on an issue update assigned to the bot', () => {
    const d = shouldDispatchGitLab(
      'Issue Hook',
      {
        object_kind: 'issue',
        object_attributes: { action: 'update', url: 'x' },
        assignees: [{ username: 'aistack-bot' }],
      },
      'aistack-bot'
    );
    expect(d.dispatch).toBe(true);
  });

  it('ignores when bot is not assigned', () => {
    const d = shouldDispatchGitLab(
      'Issue Hook',
      {
        object_kind: 'issue',
        object_attributes: { action: 'update', url: 'x' },
        assignees: [{ username: 'someone-else' }],
      },
      'aistack-bot'
    );
    expect(d.dispatch).toBe(false);
  });
});

describe('WebhookServer + GitHub route (integration)', () => {
  const server = new WebhookServer({ port: 0 });
  let port = 0;

  beforeAll(async () => {
    registerGitHubWebhook(server, baseConfig(), { botLogin: 'aistack-bot' });
    await server.start();
    // @ts-expect-error access private for testing
    const addr = (server.server?.address?.() ?? null) as { port?: number } | null;
    port = addr?.port ?? 0;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('responds 200 to a ping event', async () => {
    const res = await fetch(`http://127.0.0.1:${port}${GITHUB_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'ping',
        'X-Hub-Signature-256': `sha256=${createHmac('sha256', 'topsecret').update('{}').digest('hex')}`,
      },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pong: boolean };
    expect(body.pong).toBe(true);
  });

  it('rejects an invalid signature with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}${GITHUB_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'ping',
        'X-Hub-Signature-256': 'sha256=deadbeef',
      },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('returns 202 with dispatched=false for non-actionable events', async () => {
    const payload = JSON.stringify({ action: 'opened', issue: { html_url: 'https://x' } });
    const res = await fetch(`http://127.0.0.1:${port}${GITHUB_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': `sha256=${createHmac('sha256', 'topsecret').update(payload).digest('hex')}`,
      },
      body: payload,
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { dispatched: boolean };
    expect(body.dispatched).toBe(false);
  });
});
