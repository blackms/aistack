/**
 * A2A end-to-end roundtrip test.
 *
 * Acceptance criterion 4: aistack agent calls a (mock) CrewAI A2A endpoint
 * and vice versa.
 *
 * We spin up TWO local A2ARouter instances:
 *   1. "aistack" — uses registerA2ARoutes with a stub executor so we don't
 *      need real Claude/OpenAI providers in CI.
 *   2. "crewai-dummy" — a hand-rolled A2ARouter that mimics a remote
 *      CrewAI-style A2A endpoint (returns a canned A2AResponse). This is
 *      the "mock external agent" called by aistack.
 *
 * Both directions are exercised: aistack -> crewai-dummy and crewai-dummy
 * -> aistack, proving cross-runtime interop works.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  A2ARouter,
  type WebhookRequest,
  type WebhookResponse,
} from '../../src/transport/a2a-router.js';
import {
  registerA2ARoutes,
  AGENT_CARD_PATH,
  MESSAGE_PATH,
} from '../../src/a2a/server.js';
import { a2aCall, fetchAgentCard } from '../../src/a2a/client.js';
import { A2AMessageSchema, type A2AResponse } from '../../src/a2a/types.js';
import type { AgentStackConfig } from '../../src/types.js';
import { randomUUID } from 'node:crypto';

const minimalConfig = {
  providers: { default: 'anthropic' },
} as unknown as AgentStackConfig;

async function freePort(): Promise<number> {
  // Let the OS pick an ephemeral port by listening on 0 then closing.
  const { createServer } = await import('node:http');
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        s.close(() => resolve(port));
      } else {
        reject(new Error('no address'));
      }
    });
  });
}

interface RunningServer {
  server: A2ARouter;
  baseUrl: string;
}

async function startAistackServer(token?: string): Promise<RunningServer> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = new A2ARouter({ port, host: '127.0.0.1' });
  registerA2ARoutes(server, {
    config: minimalConfig,
    a2a: {
      url: baseUrl,
      name: 'aistack-test',
      bearerToken: token,
      exposedAgents: ['coder', 'reviewer'],
    },
    executor: async (skillId, prompt) =>
      `aistack[${skillId}] received: ${prompt}`,
  });
  await server.start();
  return { server, baseUrl };
}

async function startCrewAIDummy(): Promise<RunningServer> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = new A2ARouter({ port, host: '127.0.0.1' });

  // Hand-rolled card to prove cross-implementation compatibility
  server.registerRoute('GET', AGENT_CARD_PATH, () => ({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      protocolVersion: '1.0',
      name: 'crewai-dummy',
      description: 'Mock CrewAI agent for A2A interop testing',
      url: baseUrl,
      version: '1.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      authentication: { schemes: ['none'] },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [
        {
          id: 'crewai_planner',
          name: 'CrewAI Planner',
          description: 'Plans tasks like a crewai crew',
          inputModes: ['text'],
          outputModes: ['text'],
        },
      ],
    },
  }));

  server.registerRoute('POST', MESSAGE_PATH, (req: WebhookRequest): WebhookResponse => {
    const parsed = A2AMessageSchema.safeParse(JSON.parse(req.body || '{}'));
    if (!parsed.success) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'invalid_message', message: parsed.error.message },
      };
    }
    const incoming = parsed.data;
    const incomingText = incoming.parts
      .map((p) => p.text ?? '')
      .join(' ')
      .trim();
    const response: A2AResponse = {
      messageId: randomUUID(),
      inReplyTo: incoming.messageId,
      role: 'agent',
      status: 'completed',
      parts: [
        {
          kind: 'text',
          text: `crewai-dummy[${incoming.skillId ?? 'default'}] heard: ${incomingText}`,
        },
      ],
    };
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: response,
    };
  });

  await server.start();
  return { server, baseUrl };
}

const running: RunningServer[] = [];

afterEach(async () => {
  while (running.length) {
    const r = running.pop();
    if (r) await r.server.stop();
  }
});

describe('A2A roundtrip', () => {
  it('aistack -> crewai-dummy: fetches card and sends message', async () => {
    const crew = await startCrewAIDummy();
    running.push(crew);

    const card = await fetchAgentCard(crew.baseUrl);
    expect(card.name).toBe('crewai-dummy');
    expect(card.skills[0].id).toBe('crewai_planner');

    const response = await a2aCall(crew.baseUrl, 'plan my sprint', {
      retries: 0,
    });
    expect(response.status).toBe('completed');
    expect(response.parts[0].text).toContain('crewai-dummy');
    expect(response.parts[0].text).toContain('plan my sprint');
  });

  it('crewai-dummy -> aistack: external client calls aistack endpoint with bearer auth', async () => {
    const token = 'integration-token-xyz';
    const aistack = await startAistackServer(token);
    running.push(aistack);

    // Verify the aistack agent card is served correctly
    const card = await fetchAgentCard(aistack.baseUrl);
    expect(card.name).toBe('aistack-test');
    expect(card.skills.map((s) => s.id).sort()).toEqual(['coder', 'reviewer']);
    expect(card.authentication.schemes).toContain('bearer');

    // Auth required
    await expect(
      a2aCall(aistack.baseUrl, 'fix bug', { retries: 0 }),
    ).rejects.toThrow(/401|unauthorized/i);

    // With bearer token: success
    const response = await a2aCall(aistack.baseUrl, 'fix the null pointer', {
      bearerToken: token,
      retries: 0,
    });
    expect(response.status).toBe('completed');
    expect(response.parts[0].text).toContain('aistack[coder]');
    expect(response.parts[0].text).toContain('fix the null pointer');
  });

  it('full bidirectional handshake', async () => {
    const token = 'bidir-token';
    const aistack = await startAistackServer(token);
    const crew = await startCrewAIDummy();
    running.push(aistack, crew);

    // aistack -> crew
    const fromAistack = await a2aCall(crew.baseUrl, 'hello from aistack', { retries: 0 });
    expect(fromAistack.parts[0].text).toContain('hello from aistack');

    // crew -> aistack (with auth)
    const fromCrew = await a2aCall(aistack.baseUrl, 'hello from crew', {
      bearerToken: token,
      retries: 0,
    });
    expect(fromCrew.parts[0].text).toContain('hello from crew');
  });
});
