/**
 * Unit tests for the A2A client.
 */

import { describe, it, expect, vi } from 'vitest';
import { a2aCall, fetchAgentCard, A2AClientError } from '../../../src/a2a/client.js';
import { textMessage, type A2AResponse, type AgentCard } from '../../../src/a2a/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('a2aCall', () => {
  it('POSTs to /v1/a2a/message and parses the response', async () => {
    const fakeResp: A2AResponse = {
      messageId: 'r1',
      inReplyTo: 'm1',
      role: 'agent',
      status: 'completed',
      parts: [{ kind: 'text', text: 'pong' }],
    };
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('http://remote/v1/a2a/message');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Authorization).toBe('Bearer tok');
      const body = JSON.parse(init?.body as string) as { messageId: string };
      expect(body.messageId).toBe('m1');
      return jsonResponse(200, fakeResp);
    });

    const res = await a2aCall('http://remote', textMessage('m1', 'ping'), {
      bearerToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
    });

    expect(res.status).toBe('completed');
    expect(res.parts[0].text).toBe('pong');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('appends /v1/a2a/message when caller supplies a base URL', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('http://remote:9000/v1/a2a/message');
      return jsonResponse(200, {
        messageId: 'r',
        role: 'agent',
        status: 'completed',
        parts: [{ kind: 'text', text: 'ok' }],
      });
    });
    await a2aCall('http://remote:9000/', 'hi', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('wraps string message into a text A2AMessage', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        parts: Array<{ kind: string; text: string }>;
      };
      expect(body.parts[0].kind).toBe('text');
      expect(body.parts[0].text).toBe('hello');
      return jsonResponse(200, {
        messageId: 'r',
        role: 'agent',
        status: 'completed',
        parts: [{ kind: 'text', text: 'world' }],
      });
    });
    await a2aCall('http://remote', 'hello', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('throws A2AClientError on non-2xx without retry for 4xx', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: 'unauthorized', message: 'no token' }),
    );
    await expect(
      a2aCall('http://remote', 'hi', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retries: 3,
      }),
    ).rejects.toThrow(A2AClientError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on 4xx
  });

  it('retries on 5xx then succeeds', async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse(500, { error: 'boom', message: 'fail' });
      }
      return jsonResponse(200, {
        messageId: 'r',
        role: 'agent',
        status: 'completed',
        parts: [{ kind: 'text', text: 'ok' }],
      });
    });
    const res = await a2aCall('http://remote', 'hi', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
    });
    expect(res.status).toBe('completed');
    expect(attempts).toBe(2);
  }, 10_000);

  it('throws when response does not match schema', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { not: 'a response' }));
    await expect(
      a2aCall('http://remote', 'hi', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retries: 0,
      }),
    ).rejects.toThrow(/did not match schema/);
  });
});

describe('fetchAgentCard', () => {
  it('GETs /.well-known/a2a-agent-card.json and validates', async () => {
    const card: AgentCard = {
      protocolVersion: '1.0',
      name: 'crew-bot',
      description: 'crewai agent',
      url: 'http://crew',
      version: '1.0',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      authentication: { schemes: ['bearer'] },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [
        {
          id: 'plan',
          name: 'planner',
          description: 'plans tasks',
          inputModes: ['text'],
          outputModes: ['text'],
        },
      ],
    };
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('http://crew/.well-known/a2a-agent-card.json');
      return jsonResponse(200, card);
    });
    const fetched = await fetchAgentCard('http://crew/', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetched.name).toBe('crew-bot');
    expect(fetched.skills[0].id).toBe('plan');
  });
});
