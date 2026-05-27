/**
 * Audit module — hash-chained append-only audit log (AIG-635).
 *
 * Public API:
 *   - `getAuditChain(config)`: lazy singleton accessor; returns the chain or
 *     `null` when audit is disabled in config.
 *   - `audit(eventType, payload)`: fire-and-forget convenience wrapper used at
 *     call sites. Never throws — errors are logged and swallowed so that audit
 *     failures don't bring down agent execution.
 *   - `resetAuditChain()`: testing only.
 */

import { logger } from '../utils/logger.js';
import type { AgentStackConfig } from '../types.js';
import { AuditChain, type AuditEventType } from './chain.js';

export {
  AuditChain,
  MAX_PAYLOAD_BYTES,
  GENESIS_PREV_HASH,
  computeEntryHash,
  canonicalJSONStringify,
} from './chain.js';
export type {
  AuditEntry,
  AuditEventType,
  AuditAppendResult,
  VerifyResult,
  AuditChainOptions,
} from './chain.js';

const log = logger.child('audit');

let instance: AuditChain | null = null;
let configured = false;
let enabledCached = false;

/**
 * Resolve the audit DB path. Defaults to a sibling of the main memory DB so
 * evidence packs are easy to locate, but kept in a separate file to keep the
 * append-only semantics independent of the main DB lifecycle.
 */
function resolveAuditPath(config: AgentStackConfig): string {
  const explicit = config.audit?.path;
  if (explicit) return explicit;
  const main = config.memory.path;
  // Replace trailing .db (if any) with .audit.db; otherwise append.
  if (main.endsWith('.db')) {
    return main.slice(0, -3) + '.audit.db';
  }
  return main + '.audit.db';
}

/**
 * Get the singleton AuditChain, or null if disabled. Reads `AISTACK_AUDIT_KEY`
 * from the environment when the config does not provide one explicitly — never
 * read a key from a config file committed to git.
 */
export function getAuditChain(config: AgentStackConfig): AuditChain | null {
  if (configured) {
    return instance;
  }

  const auditCfg = config.audit;
  if (!auditCfg?.enabled) {
    configured = true;
    enabledCached = false;
    return null;
  }

  // Prefer env var; fall back to config field (less safe — discouraged).
  const envKey = process.env.AISTACK_AUDIT_KEY;
  const cfgKey = auditCfg.signatureKey;
  const signatureKey = envKey ?? cfgKey;

  if (!signatureKey) {
    log.warn(
      'Audit chain enabled but no signature key found (AISTACK_AUDIT_KEY env var or config.audit.signatureKey). ' +
        'Operating in unsigned mode — hash integrity still protects against tampering but entries are not cryptographically attributed.',
    );
  }

  try {
    instance = new AuditChain({
      dbPath: resolveAuditPath(config),
      signatureKey: signatureKey,
      redactFields: auditCfg.redactFields,
    });
    enabledCached = true;
    log.info('Audit chain initialised', {
      signed: instance.isSigned(),
      entries: instance.count(),
    });
  } catch (err) {
    log.error('Failed to initialise audit chain — audit disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
    instance = null;
    enabledCached = false;
  }

  configured = true;
  return instance;
}

/**
 * Fire-and-forget audit log emission. Designed for call-site use:
 *
 *     audit(config, 'agent.spawn', { agentId, type });
 *
 * Never throws: an audit failure logs a warning but does not interrupt the
 * caller. Returns the assigned seq on success, null otherwise.
 */
export function audit(
  config: AgentStackConfig,
  eventType: AuditEventType,
  payload: Record<string, unknown>,
): number | null {
  const chain = getAuditChain(config);
  if (!chain) return null;
  try {
    const result = chain.append(eventType, payload);
    return result.seq;
  } catch (err) {
    log.warn('Audit append failed', {
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Whether the audit chain is currently active (initialised and enabled). */
export function isAuditEnabled(): boolean {
  return configured && enabledCached && instance !== null;
}

/** Reset the singleton (testing only). */
export function resetAuditChain(): void {
  if (instance) {
    try {
      instance.close();
    } catch {
      // ignore close errors during reset
    }
  }
  instance = null;
  configured = false;
  enabledCached = false;
}
