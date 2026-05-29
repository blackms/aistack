/**
 * A2A client — call remote agents that speak the A2A protocol.
 *
 * Used by aistack agents to invoke CrewAI / Microsoft Agent Framework /
 * OpenAI Agents SDK / Mastra / Letta endpoints that expose an A2A card.
 */

import {
  A2AResponseSchema,
  AgentCardSchema,
  type A2AMessage,
  type A2AResponse,
  type AgentCard,
  textMessage,
} from './types.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';

const log = logger.child('a2a-client');

export interface A2ACallOptions {
  /** Bearer token sent in Authorization header. */
  bearerToken?: string;
  /** Per-request timeout in milliseconds (default 30s). */
  timeoutMs?: number;
  /** Number of retry attempts on network failure (default 2). */
  retries?: number;
  /** Override fetch — primarily for unit tests. */
  fetchImpl?: typeof fetch;
  /** Extra headers to merge into the outbound request. */
  headers?: Record<string, string>;
}

export class A2AClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'A2AClientError';
  }
}

/**
 * Send an A2A message to a remote agent.
 *
 * Acceptance criterion 3: client TS API `a2aCall(url, msg)` returns response.
 *
 * @param url      Either a full message endpoint or the base agent URL.
 *                 If the path doesn't end with `/v1/a2a/message` it is appended.
 * @param message  Either a fully-formed A2AMessage or a plain string (auto-wrapped).
 */
export async function a2aCall(
  url: string,
  message: A2AMessage | string,
  options: A2ACallOptions = {},
): Promise<A2AResponse> {
  const endpoint = normalizeMessageUrl(url);
  const payload: A2AMessage =
    typeof message === 'string' ? textMessage(randomUUID(), message) : message;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.bearerToken) {
    headers.Authorization = `Bearer ${options.bearerToken}`;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = Math.max(1, (options.retries ?? 2) + 1);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const text = await res.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          // fall through — non-JSON body
        }
      }

      if (!res.ok) {
        throw new A2AClientError(
          `A2A call failed: HTTP ${res.status}`,
          res.status,
          parsed ?? text,
        );
      }

      const result = A2AResponseSchema.safeParse(parsed);
      if (!result.success) {
        throw new A2AClientError(
          `A2A response did not match schema: ${result.error.message}`,
          res.status,
          parsed,
        );
      }

      return result.data;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      // Don't retry on auth / validation errors — they won't get better.
      if (error instanceof A2AClientError && error.status && error.status < 500) {
        throw error;
      }

      if (attempt < maxAttempts) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 4000);
        log.warn('A2A call failed, retrying', {
          attempt,
          maxAttempts,
          backoffMs: backoff,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(backoff);
        continue;
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new A2AClientError(String(lastError));
}

/**
 * Fetch the remote agent card at /.well-known/a2a-agent-card.json.
 * Useful for capability discovery before calling.
 */
export async function fetchAgentCard(
  baseUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AgentCard> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = baseUrl.replace(/\/+$/, '') + '/.well-known/a2a-agent-card.json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const res = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      throw new A2AClientError(`Failed to fetch agent card: HTTP ${res.status}`, res.status);
    }
    const json = (await res.json()) as unknown;
    const result = AgentCardSchema.safeParse(json);
    if (!result.success) {
      throw new A2AClientError(`Agent card failed schema validation: ${result.error.message}`, res.status, json);
    }
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMessageUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/a2a/message')) return trimmed;
  return trimmed + '/v1/a2a/message';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
