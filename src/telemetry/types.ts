/**
 * Telemetry types (AIG-655)
 *
 * Opt-in anonymous telemetry. No identifiable information is collected.
 * See docs/TELEMETRY.md for the full privacy policy.
 */

export type TelemetryEventType =
  | 'review_loop.started'
  | 'review_loop.completed'
  | 'review_loop.failed'
  | 'agent.spawned'
  | 'agent.completed'
  | 'session.started'
  | 'session.ended';

/**
 * A single telemetry event.
 *
 * Intentionally minimal — only event type, anonymized context, and a small
 * structured payload. No file paths, no user input, no API keys, no IPs.
 */
export interface TelemetryEvent {
  /** Event type discriminator. */
  type: TelemetryEventType;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  /** Hashed session ID (SHA-256, first 16 hex chars). Optional. */
  sessionId?: string;
  /** aistack package version (e.g. "1.5.3"). */
  aistackVersion: string;
  /** Node.js version family (e.g. "20", "22"). */
  nodeVersion: string;
  /** OS family ("darwin" | "linux" | "win32"). */
  osFamily: string;
  /** Free-form numeric/categorical payload. Must not contain PII. */
  payload?: Record<string, number | string | boolean>;
}

/**
 * Re-export of the public TelemetryConfig (defined in src/types.ts so
 * AgentStackConfig can reference it without a cycle).
 */
export type { TelemetryConfig } from '../types.js';

/**
 * Result of a flush attempt.
 */
export interface TelemetryFlushResult {
  delivered: number;
  failed: number;
  endpoint?: string;
}
