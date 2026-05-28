/**
 * Unit tests for A2A server route handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleMessage,
  registerA2ARoutes,
  timingSafeEqualString,
  __resetReplayCacheForTests,
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

// Reset module-level replay cache between every test so reused messageIds
// (e.g. the "m1" sentinel used across many cases below) don't cross-pollinate.
beforeEach(() => {
  __resetReplayCacheForTests();
});

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

  it('can advertise no auth when bearer auth is disabled', () => {
    const card = generateAgentCard({
      url: 'http://localhost:8787',
      authSchemes: ['none'],
    });
    expect(card.authentication.schemes).toEqual(['none']);
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

describe('timingSafeEqualString', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualString('sekret', 'sekret')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeEqualString('sekret', 'secret')).toBe(false);
  });

  it('returns false (and does NOT throw) for length mismatch — covers both shorter and longer', () => {
    // The whole point of the helper is that it pads both sides so the
    // underlying crypto.timingSafeEqual call never sees mismatched lengths.
    expect(() => timingSafeEqualString('short', 'much-longer-token')).not.toThrow();
    expect(timingSafeEqualString('short', 'much-longer-token')).toBe(false);
    expect(timingSafeEqualString('much-longer-token', 'short')).toBe(false);
  });

  it('handles empty strings on either side', () => {
    expect(timingSafeEqualString('', '')).toBe(true);
    expect(timingSafeEqualString('', 'x')).toBe(false);
    expect(timingSafeEqualString('x', '')).toBe(false);
  });
});

describe('A2A handleMessage — replay/messageId dedup', () => {
  beforeEach(() => {
    __resetReplayCacheForTests();
  });

  const cfg: A2AServerConfig = { url: 'http://localhost:8787' };

  function buildReq(messageId: string): WebhookRequest {
    return makeReq({
      body: JSON.stringify({
        messageId,
        parts: [{ kind: 'text', text: 'hi' }],
        skillId: 'coder',
      }),
    });
  }

  it('returns cached response on duplicate messageId without re-invoking executor', async () => {
    let calls = 0;
    const executor = async (_s: string, p: string): Promise<string> => {
      calls += 1;
      return `out:${p}:${calls}`;
    };

    const first = await handleMessage(buildReq('dup-1'), cfg, executor);
    const second = await handleMessage(buildReq('dup-1'), cfg, executor);
    const third = await handleMessage(buildReq('dup-1'), cfg, executor);

    expect(calls).toBe(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    // Cached response is byte-equal to the original (same generated
    // messageId, same payload).
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
  });

  it('5 concurrent retries with same messageId invoke executor exactly once', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const executor = async (_s: string, p: string): Promise<string> => {
      calls += 1;
      // Block until released so all 5 retries are genuinely in-flight at
      // the same time — exercises the inFlight collapsing path.
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return `out:${p}`;
    };

    const results = Promise.all(
      Array.from({ length: 5 }, () => handleMessage(buildReq('race-1'), cfg, executor)),
    );

    // Spin until the first call has entered the executor, then release.
    // This guarantees concurrent submission window covers the inFlight map.
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (release) resolve();
        else setImmediate(tick);
      };
      tick();
    });
    release!();

    const resolved = await results;
    expect(calls).toBe(1);
    expect(resolved.every((r) => r.status === 200)).toBe(true);
    // All 5 responses share the same payload (cached + in-flight collapse).
    const first = resolved[0].body;
    for (const r of resolved.slice(1)) {
      expect(r.body).toEqual(first);
    }
  });

  it('does NOT cache 5xx failures — executor is retried on subsequent calls', async () => {
    let calls = 0;
    const executor = async (): Promise<string> => {
      calls += 1;
      throw new Error('transient');
    };
    const a = await handleMessage(buildReq('fail-1'), cfg, executor);
    const b = await handleMessage(buildReq('fail-1'), cfg, executor);
    expect(a.status).toBe(500);
    expect(b.status).toBe(500);
    expect(calls).toBe(2);
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
