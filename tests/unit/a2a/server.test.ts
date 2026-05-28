/**
 * Unit tests for A2A server route handling.
 */

import { describe, it, expect } from 'vitest';
import {
  handleMessage,
  registerA2ARoutes,
  AGENT_CARD_PATH,
  MESSAGE_PATH,
  type A2AServerConfig,
} from '../../../src/a2a/server.js';
import { generateAgentCard } from '../../../src/a2a/agent-card.js';
import { A2A_PROTOCOL_VERSION } from '../../../src/a2a/types.js';
import { A2ARouter, type WebhookRequest } from '../../../src/transport/a2a-router.js';
import type { AgentStackConfig } from '../../../src/types.js';

function makeReq(overrides: Partial<WebhookRequest> = {}): WebhookRequest {
  return {
    method: 'POST',
    url: MESSAGE_PATH,
    path: MESSAGE_PATH,
    headers: {},
    body: '',
    query: {},
    ...overrides,
  };
}

describe('A2A agent card', () => {
  it('generates a spec-valid card with all registered agents', () => {
    const card = generateAgentCard({ url: 'http://localhost:8787' });
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.name).toBe('aistack');
    expect(card.url).toBe('http://localhost:8787');
    expect(card.skills.length).toBeGreaterThan(0);
    expect(card.skills.find((s) => s.id === 'coder')).toBeDefined();
    expect(card.authentication.schemes).toContain('bearer');
  });

  it('restricts skills via exposedAgents allowlist', () => {
    const card = generateAgentCard({
      url: 'http://localhost:8787',
      exposedAgents: ['coder', 'reviewer'],
    });
    expect(card.skills.map((s) => s.id).sort()).toEqual(['coder', 'reviewer']);
  });

  it('strips trailing slashes from url', () => {
    const card = generateAgentCard({ url: 'http://localhost:8787///' });
    expect(card.url).toBe('http://localhost:8787');
  });
});

describe('A2A handleMessage — auth', () => {
  const baseConfig: A2AServerConfig = {
    url: 'http://localhost:8787',
    bearerToken: 'sekret',
  };
  const executor = async (_skill: string, prompt: string): Promise<string> => `echo: ${prompt}`;

  it('rejects request without Authorization header', async () => {
    const res = await handleMessage(makeReq({ body: '{}' }), baseConfig, executor);
    expect(res.status).toBe(401);
    const body = res.body as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('rejects request with wrong bearer token', async () => {
    const res = await handleMessage(
      makeReq({
        body: JSON.stringify({
          messageId: 'm1',
          parts: [{ kind: 'text', text: 'hi' }],
          skillId: 'coder',
        }),
        headers: { authorization: 'Bearer wrong' },
      }),
      baseConfig,
      executor,
    );
    expect(res.status).toBe(403);
  });

  it('accepts request with correct bearer token', async () => {
    const res = await handleMessage(
      makeReq({
        body: JSON.stringify({
          messageId: 'm1',
          parts: [{ kind: 'text', text: 'hi' }],
          skillId: 'coder',
        }),
        headers: { authorization: 'Bearer sekret' },
      }),
      baseConfig,
      executor,
    );
    expect(res.status).toBe(200);
    const body = res.body as { status: string; parts: Array<{ text?: string }> };
    expect(body.status).toBe('completed');
    expect(body.parts[0].text).toBe('echo: hi');
  });

  it('skips auth entirely when no bearer token configured', async () => {
    const res = await handleMessage(
      makeReq({
        body: JSON.stringify({
          messageId: 'm1',
          parts: [{ kind: 'text', text: 'hi' }],
          skillId: 'coder',
        }),
      }),
      { url: 'http://localhost:8787' },
      executor,
    );
    expect(res.status).toBe(200);
  });
});

describe('A2A handleMessage — validation', () => {
  const cfg: A2AServerConfig = { url: 'http://localhost:8787' };
  const executor = async (_s: string, p: string): Promise<string> => p;

  it('returns 400 on invalid JSON', async () => {
    const res = await handleMessage(makeReq({ body: 'not-json' }), cfg, executor);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_json');
  });

  it('returns 400 when message schema validation fails', async () => {
    const res = await handleMessage(
      makeReq({ body: JSON.stringify({ wrong: 'shape' }) }),
      cfg,
      executor,
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_message');
  });

  it('returns 404 for unknown skill', async () => {
    const res = await handleMessage(
      makeReq({
        body: JSON.stringify({
          messageId: 'm1',
          parts: [{ kind: 'text', text: 'hi' }],
          skillId: 'nonexistent',
        }),
      }),
      cfg,
      executor,
    );
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('unknown_skill');
  });

  it('returns 403 when requested skill is not in exposedAgents', async () => {
    const res = await handleMessage(
      makeReq({
        body: JSON.stringify({
          messageId: 'm1',
          parts: [{ kind: 'text', text: 'hi' }],
          skillId: 'tester',
        }),
      }),
      { url: 'http://localhost:8787', exposedAgents: ['coder'] },
      executor,
    );
    expect(res.status).toBe(403);
  });

  it('uses default skill when none specified', async () => {
    const res = await handleMessage(
      makeReq({
        body: JSON.stringify({
          messageId: 'm1',
          parts: [{ kind: 'text', text: 'hi' }],
        }),
      }),
      { url: 'http://localhost:8787', exposedAgents: ['reviewer'] },
      executor,
    );
    expect(res.status).toBe(200);
  });

  it('returns 500 with failed status when executor throws', async () => {
    const boom = async (): Promise<string> => {
      throw new Error('boom');
    };
    const res = await handleMessage(
      makeReq({
        body: JSON.stringify({
          messageId: 'm1',
          parts: [{ kind: 'text', text: 'hi' }],
          skillId: 'coder',
        }),
      }),
      cfg,
      boom,
    );
    expect(res.status).toBe(500);
    const body = res.body as { status: string; parts: Array<{ text?: string }> };
    expect(body.status).toBe('failed');
    expect(body.parts[0].text).toContain('boom');
  });
});

describe('A2A registerA2ARoutes', () => {
  it('registers both card and message routes on the A2A router', () => {
    const server = new A2ARouter({ port: 0 });
    const cfg = { providers: { default: 'anthropic' } } as unknown as AgentStackConfig;
    registerA2ARoutes(server, {
      config: cfg,
      a2a: { url: 'http://localhost:8787' },
      executor: async () => 'ok',
    });
    const paths = server.getRoutes().map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain(`GET ${AGENT_CARD_PATH}`);
    expect(paths).toContain(`POST ${MESSAGE_PATH}`);
  });
});
