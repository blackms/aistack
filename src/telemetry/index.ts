/**
 * Telemetry module (AIG-655)
 *
 * Public surface for the opt-in anonymous telemetry client.
 * See docs/TELEMETRY.md for the privacy policy.
 */

export { TelemetryClient, hashSessionId } from './client.js';
export type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryFlushResult,
  TelemetryConfig,
} from './types.js';

import { TelemetryClient } from './client.js';
import type { TelemetryConfig } from './types.js';

/**
 * Factory for a TelemetryClient.
 *
 * Returns a disabled client if `config` is undefined or `config.enabled` is
 * false, so callers can always call `recordEvent()` without guarding.
 */
export function createTelemetry(
  config: TelemetryConfig | undefined,
  options?: {
    aistackVersion?: string;
    nodeVersion?: string;
    osFamily?: string;
    fetchImpl?: typeof fetch;
  },
): TelemetryClient {
  return new TelemetryClient(config ?? { enabled: false }, options);
}
