/**
 * A2A server — registers /.well-known/a2a-agent-card.json and
 * /v1/a2a/message routes onto an A2ARouter (dedicated multi-route
 * HTTP listener, separate from AIG-636's task-ingestion WebhookServer
 * which is pinned to POST /v1/tasks).
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
import type { A2ARouter, WebhookRequest, WebhookResponse } from '../transport/a2a-router.js';
import type { AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const log = logger.child('a2a-server');

export const AGENT_CARD_PATH = '/.well-known/a2a-agent-card.json';
export const MESSAGE_PATH = '/v1/a2a/message';

/** Max entries kept in the replay cache before LRU-style eviction. */
const REPLAY_CACHE_MAX = 10_000;
/** Default TTL for cached responses (5 minutes). */
const REPLAY_TTL_MS = 5 * 60 * 1000;

/**
 * Constant-time string equality. Pads both sides to equal length before
 * `timingSafeEqual` so we don't leak length information via early-exit.
 * Mirrors the helper inside `verifyHmacSignature` (src/transport/webhook.ts).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  const len = Math.max(ab.length, bb.length);
  // Pad both to identical length so the underlying compare always runs.
  const ap = Buffer.alloc(len);
  const bp = Buffer.alloc(len);
  ab.copy(ap);
  bb.copy(bp);
  // Even on length mismatch, run the compare to keep timing stable, then
  // factor the length check into the final result.
  const eq = timingSafeEqual(ap, bp);
  return eq && ab.length === bb.length;
}

interface ReplayEntry {
  response: WebhookResponse;
  expiresAt: number;
}

/**
 * Per-process replay cache keyed by A2A messageId. Idempotent responses
 * are returned verbatim when the same messageId is retried within TTL.
 * Map insertion order gives us cheap LRU-by-arrival eviction.
 */
const replayCache: Map<string, ReplayEntry> = new Map();
/** In-flight requests indexed by messageId — collapses concurrent retries. */
const inFlight: Map<string, Promise<WebhookResponse>> = new Map();

function getCachedReplay(messageId: string): WebhookResponse | undefined {
  const entry = replayCache.get(messageId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    replayCache.delete(messageId);
    return undefined;
  }
  // Refresh LRU position
  replayCache.delete(messageId);
  replayCache.set(messageId, entry);
  return entry.response;
}

function rememberReplay(messageId: string, response: WebhookResponse): void {
  // Evict expired entries opportunistically.
  const now = Date.now();
  if (replayCache.size >= REPLAY_CACHE_MAX) {
    // Drop the oldest entry (Map iteration is insertion order).
    const oldestKey = replayCache.keys().next().value;
    if (oldestKey !== undefined) replayCache.delete(oldestKey);
  }
  replayCache.set(messageId, { response, expiresAt: now + REPLAY_TTL_MS });
}

/** Test-only — reset module-level dedup state between test cases. */
export function __resetReplayCacheForTests(): void {
  replayCache.clear();
  inFlight.clear();
}

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
 * Register A2A routes on an A2ARouter.
 *
 * The router is dedicated to A2A endpoints; the daemon's task-ingestion
 * WebhookServer (AIG-636) lives on its own port. Mirrors AIG-637's
 * IntegrationRouter split so each protocol surface owns its routing.
 */
export function registerA2ARoutes(
  router: A2ARouter,
  options: RegisterA2AOptions,
): void {
  const { config, a2a } = options;

  if (!a2a.bearerToken) {
    log.warn(
      'A2A bearer token is not configured — authentication is DISABLED. ' +
        'Set AISTACK_A2A_TOKEN env var before exposing this endpoint to the network.',
    );
  }

  const card = generateAgentCard({
    ...a2a,
    authSchemes: a2a.authSchemes ?? (a2a.bearerToken ? ['bearer'] : ['none']),
  });

  router.registerRoute('GET', AGENT_CARD_PATH, () => ({
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

  router.registerRoute('POST', MESSAGE_PATH, async (req) =>
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
    const bearerMatch = authHeader ? /^Bearer (\S+)$/.exec(authHeader) : null;
    if (!bearerMatch) {
      return errorResponse(401, 'unauthorized', 'Missing or malformed Authorization header');
    }
    const presented = bearerMatch[1]!;
    if (!timingSafeEqualString(presented, a2a.bearerToken)) {
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

  // Replay dedup — if we've already processed (or are currently processing)
  // this messageId, return the cached/in-flight response without re-invoking
  // the executor. Cache lookup happens *after* schema validation so malformed
  // payloads can't poison the cache, but *before* skill resolution so the
  // idempotent contract holds regardless of routing changes.
  const cached = getCachedReplay(message.messageId);
  if (cached) {
    return cached;
  }
  const inflightExisting = inFlight.get(message.messageId);
  if (inflightExisting) {
    return inflightExisting;
  }

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

  const work = (async (): Promise<WebhookResponse> => {
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
  })();

  inFlight.set(message.messageId, work);
  try {
    const result = await work;
    // Only cache successful 200s — error responses (5xx) shouldn't be
    // pinned for 5 minutes since the failure may be transient.
    if (result.status === 200) {
      rememberReplay(message.messageId, result);
    }
    return result;
  } finally {
    inFlight.delete(message.messageId);
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
