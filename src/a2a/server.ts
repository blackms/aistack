/**
 * A2A server — registers /.well-known/a2a-agent-card.json and
 * /v1/a2a/message routes onto an existing WebhookServer instance
 * (shared with AIG-636 / AIG-637 to avoid HTTP port duplication).
 */

import {
  A2AMessageSchema,
  type A2AMessage,
  type A2AResponse,
  responseText,
} from './types.js';
import { generateAgentCard, type AgentCardOptions } from './agent-card.js';
import { hasAgentType } from '../agents/registry.js';
import { runAgent } from '../agents/spawner.js';
import type { WebhookServer, WebhookRequest, WebhookResponse } from '../transport/webhook.js';
import type { AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';

const log = logger.child('a2a-server');

export const AGENT_CARD_PATH = '/.well-known/a2a-agent-card.json';
export const MESSAGE_PATH = '/v1/a2a/message';

export interface A2AServerConfig extends AgentCardOptions {
  /**
   * Bearer token required on inbound POST /v1/a2a/message.
   * If undefined, authentication is DISABLED (warned at startup).
   * Read from env var AISTACK_A2A_TOKEN by the CLI wrapper — never hardcode.
   */
  bearerToken?: string;
}

export interface RegisterA2AOptions {
  config: AgentStackConfig;
  a2a: A2AServerConfig;
  /**
   * Executor override — primarily for tests so we don't actually spawn a
   * subprocess. Defaults to using `runAgent` from the spawner.
   */
  executor?: (skillId: string, prompt: string) => Promise<string>;
}

/**
 * Register A2A routes on an existing WebhookServer.
 *
 * Pattern intentionally mirrors AIG-637 github-webhook so both can
 * coexist on the same HTTP server with no port collision.
 */
export function registerA2ARoutes(
  webhookServer: WebhookServer,
  options: RegisterA2AOptions,
): void {
  const { config, a2a } = options;

  if (!a2a.bearerToken) {
    log.warn(
      'A2A bearer token is not configured — authentication is DISABLED. ' +
        'Set AISTACK_A2A_TOKEN env var before exposing this endpoint to the network.',
    );
  }

  const card = generateAgentCard(a2a);

  webhookServer.registerRoute('GET', AGENT_CARD_PATH, () => ({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: card,
  }));

  const executor =
    options.executor ??
    (async (skillId: string, prompt: string): Promise<string> => {
      const result = await runAgent(skillId, prompt, config);
      return result.response;
    });

  webhookServer.registerRoute('POST', MESSAGE_PATH, async (req) =>
    handleMessage(req, a2a, executor),
  );

  log.info('A2A routes registered', {
    cardPath: AGENT_CARD_PATH,
    messagePath: MESSAGE_PATH,
    skills: card.skills.length,
  });
}

/**
 * Internal — exposed for direct unit testing without spinning up an HTTP
 * server. Handles bearer auth, schema validation, skill resolution, and
 * delegation to the executor.
 */
export async function handleMessage(
  req: WebhookRequest,
  a2a: A2AServerConfig,
  executor: (skillId: string, prompt: string) => Promise<string>,
): Promise<WebhookResponse> {
  // Bearer auth (skipped when no token configured — see warning above)
  if (a2a.bearerToken) {
    const authHeader = pickHeader(req.headers['authorization']);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(401, 'unauthorized', 'Missing or malformed Authorization header');
    }
    const presented = authHeader.slice('Bearer '.length).trim();
    if (presented !== a2a.bearerToken) {
      return errorResponse(403, 'forbidden', 'Invalid bearer token');
    }
  }

  // Parse JSON body
  let raw: unknown;
  try {
    raw = req.body ? JSON.parse(req.body) : {};
  } catch (error) {
    return errorResponse(400, 'invalid_json', error instanceof Error ? error.message : 'Invalid JSON');
  }

  // Validate against A2A message schema
  const parsed = A2AMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, 'invalid_message', 'A2A message schema validation failed', {
      issues: parsed.error.issues,
    });
  }

  const message: A2AMessage = parsed.data;

  // Resolve target skill — explicit skillId or fall back to first allowed
  const skillId = message.skillId ?? pickDefaultSkill(a2a);
  if (!skillId) {
    return errorResponse(400, 'no_skill', 'Message has no skillId and no default skill configured');
  }
  if (!hasAgentType(skillId)) {
    return errorResponse(404, 'unknown_skill', `Skill not registered: ${skillId}`);
  }
  if (a2a.exposedAgents && a2a.exposedAgents.length > 0 && !a2a.exposedAgents.includes(skillId)) {
    return errorResponse(403, 'skill_not_exposed', `Skill is not exposed via A2A: ${skillId}`);
  }

  // Extract prompt — concatenate text parts
  const prompt = message.parts
    .filter((p) => p.kind === 'text' && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n')
    .trim();

  if (!prompt) {
    return errorResponse(400, 'empty_prompt', 'No text content in message parts');
  }

  try {
    const output = await executor(skillId, prompt);
    const response: A2AResponse = {
      messageId: randomUUID(),
      inReplyTo: message.messageId,
      role: 'agent',
      status: 'completed',
      parts: [{ kind: 'text', text: output }],
      metadata: { skillId },
    };
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: response,
    };
  } catch (error) {
    const failure: A2AResponse = {
      messageId: randomUUID(),
      inReplyTo: message.messageId,
      role: 'agent',
      status: 'failed',
      parts: [
        {
          kind: 'text',
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      metadata: { skillId, error: true },
    };
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: failure,
    };
  }
}

function pickDefaultSkill(a2a: A2AServerConfig): string | undefined {
  if (a2a.exposedAgents && a2a.exposedAgents.length > 0) {
    return a2a.exposedAgents[0];
  }
  return undefined;
}

function pickHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function errorResponse(
  status: number,
  error: string,
  message: string,
  details?: Record<string, unknown>,
): WebhookResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: { error, message, ...(details ? { details } : {}) },
  };
}

// Re-export response helper for callers
export { responseText };
