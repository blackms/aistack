/**
 * TelemetryClient (AIG-655)
 *
 * Opt-in anonymous telemetry client. Disabled by default.
 *
 * Design goals:
 *  - Privacy-first: never collects identifiable information.
 *  - Opt-in: silently no-ops if `config.enabled` is false.
 *  - No mandatory infra: if no endpoint is configured, events are buffered
 *    in memory and flush() is a no-op (callers can inspect via drainBuffer()
 *    for testing or local logging).
 *  - Best-effort: a failed POST never throws into the caller; failures are
 *    counted and returned in the flush result.
 *
 * See docs/TELEMETRY.md for the full privacy policy.
 */

import { createHash } from 'node:crypto';
import type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryFlushResult,
  TelemetryConfig,
} from './types.js';

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 20;

export class TelemetryClient {
  private readonly config: Required<Pick<TelemetryConfig, 'enabled' | 'anonymizeSessionId' | 'flushIntervalMs' | 'batchSize'>> & {
    endpoint?: string;
  };
  private readonly aistackVersion: string;
  private readonly nodeVersion: string;
  private readonly osFamily: string;
  private readonly fetchImpl: typeof fetch;
  private buffer: TelemetryEvent[] = [];

  constructor(
    config: TelemetryConfig,
    options: {
      aistackVersion?: string;
      nodeVersion?: string;
      osFamily?: string;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    this.config = {
      enabled: config.enabled === true,
      endpoint: config.endpoint,
      anonymizeSessionId: config.anonymizeSessionId !== false,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
    };
    this.aistackVersion = options.aistackVersion ?? 'unknown';
    this.nodeVersion = options.nodeVersion ?? extractNodeMajor(process.version);
    this.osFamily = options.osFamily ?? process.platform;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** Whether telemetry is enabled (opt-in). */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Record a telemetry event. No-op if telemetry is disabled.
   *
   * The session ID, if provided, is hashed (SHA-256, first 16 hex chars)
   * when `anonymizeSessionId` is enabled (default).
   *
   * Payload values are limited to numbers, strings, and booleans — callers
   * are responsible for not passing PII. Strings longer than 200 chars are
   * truncated as a defense-in-depth measure.
   */
  recordEvent(
    type: TelemetryEventType,
    payload?: Record<string, number | string | boolean>,
    sessionId?: string,
  ): void {
    if (!this.config.enabled) {
      return;
    }

    const event: TelemetryEvent = {
      type,
      timestamp: new Date().toISOString(),
      aistackVersion: this.aistackVersion,
      nodeVersion: this.nodeVersion,
      osFamily: this.osFamily,
      ...(sessionId !== undefined && {
        sessionId: this.config.anonymizeSessionId ? hashSessionId(sessionId) : sessionId,
      }),
      ...(payload !== undefined && { payload: sanitizePayload(payload) }),
    };

    this.buffer.push(event);

    // Auto-flush when batch is full.
    if (this.buffer.length >= this.config.batchSize) {
      // Fire-and-forget: don't await, don't throw.
      void this.flush();
    }
  }

  /**
   * POST buffered events to the configured endpoint.
   *
   * Returns counts of delivered/failed events. If no endpoint is configured,
   * the buffer is cleared and the result reports the events as "failed" with
   * no endpoint — callers can use `drainBuffer()` instead for local handling.
   */
  async flush(): Promise<TelemetryFlushResult> {
    if (!this.config.enabled || this.buffer.length === 0) {
      return { delivered: 0, failed: 0, endpoint: this.config.endpoint };
    }

    const events = this.buffer.splice(0, this.buffer.length);

    if (!this.config.endpoint) {
      // No endpoint configured: events are dropped.
      return { delivered: 0, failed: events.length, endpoint: undefined };
    }

    try {
      const response = await this.fetchImpl(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        return { delivered: 0, failed: events.length, endpoint: this.config.endpoint };
      }
      return { delivered: events.length, failed: 0, endpoint: this.config.endpoint };
    } catch {
      // Network errors are silenced — telemetry must never break the host app.
      return { delivered: 0, failed: events.length, endpoint: this.config.endpoint };
    }
  }

  /**
   * Drain the in-memory buffer without posting. Useful for tests and for
   * callers that want to handle delivery themselves.
   */
  drainBuffer(): TelemetryEvent[] {
    return this.buffer.splice(0, this.buffer.length);
  }

  /** Buffered (not-yet-flushed) event count. */
  bufferSize(): number {
    return this.buffer.length;
  }
}

/**
 * Stable, irreversible session-ID hash (SHA-256, first 16 hex chars = 64 bits).
 * Exposed for testing.
 */
export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

function extractNodeMajor(version: string): string {
  // process.version is like "v20.11.0" — return just the major.
  const match = /^v?(\d+)/.exec(version);
  return match ? match[1] : version;
}

function sanitizePayload(
  payload: Record<string, number | string | boolean>,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      out[key] = value.length > 200 ? value.slice(0, 200) : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
    // Silently drop anything else (objects, arrays, null, undefined).
  }
  return out;
}
