/**
 * Cost governance module (AIG-867) — public facade.
 *
 * A cost-governance layer on top of the OTel usage signal + multitenancy:
 *   - derives spend (tokens + estimated USD) from each LLM call,
 *   - attributes it per tenant/workspace/project/agent-pattern,
 *   - enforces optional budget caps with a warn -> block kill-switch,
 *   - exposes spend reports via REST (`/api/v1/governance/*`) and a CLI.
 *
 * SECURITY DEFAULT: opt-in. `config.governance.enabled` defaults to false, and
 * `enforce.block` defaults to false, so the module is a no-op until explicitly
 * enabled and blocking is an additional explicit opt-in (observe-only first).
 *
 * Singleton lifecycle mirrors getAuditChain/getMemoryManager: a lazily created
 * instance keyed off the shared SQLite store, with a reset hook for tests.
 */

import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { GovernanceService } from './service.js';
import type { RecordSpendInput } from './service.js';

export { GovernanceService, CostBudgetExceededError } from './service.js';
export type { RecordSpendInput } from './service.js';
export { CostAggregator } from './aggregator.js';
export { BudgetEnforcer, windowStart } from './enforcer.js';
export {
  DEFAULT_PRICE_TABLE,
  resolvePrice,
  estimateUsdCost,
  mergePriceTable,
} from './price-table.js';
export type {
  GovernanceConfig,
  GovernanceEnforceConfig,
  CostBudget,
  CostBudgetScope,
  BudgetWindow,
  BudgetState,
  BudgetEvaluation,
  BudgetCheckContext,
  ModelPrice,
  PriceTable,
  SpendDimension,
  SpendRecord,
  SpendReport,
  SpendReportRow,
  SpendQuery,
} from './types.js';
export { DEFAULT_BUCKET } from './types.js';

const log = logger.child('governance');

let instance: GovernanceService | null = null;
let configured = false;
let ownedDb: Database.Database | null = null;

/**
 * Open the shared SQLite DB. We open our own handle to the same file rather than
 * reaching into MemoryManager so the module stays decoupled and usable from the
 * CLI without booting the full memory manager. better-sqlite3 multi-connection
 * to one WAL file is safe.
 */
function openDb(config: AgentStackConfig): Database.Database {
  const path = config.memory.path;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * Initialise the governance service. Idempotent. Returns null when governance
 * is disabled in config (the entire module is then a no-op). Safe to call
 * eagerly at boot or lazily via getGovernanceService().
 */
export function initGovernance(config: AgentStackConfig): GovernanceService | null {
  if (configured) return instance;
  configured = true;

  if (!config.governance?.enabled) {
    instance = null;
    return null;
  }

  try {
    ownedDb = openDb(config);
    instance = new GovernanceService(config, ownedDb);
    const status = instance.getStatus();
    log.info('Cost governance initialised', {
      block: status.blockEnabled,
      warnThresholdPercent: status.warnThresholdPercent,
      budgets: status.budgets,
    });
  } catch (err) {
    log.error('Failed to initialise cost governance — governance disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
    instance = null;
  }
  return instance;
}

/**
 * Lazy singleton accessor. Returns the service or null when disabled. Call
 * sites in the spawner use the null-safe `?.` so a disabled module costs
 * nothing beyond a map lookup.
 */
export function getGovernanceService(
  config: AgentStackConfig,
): GovernanceService | null {
  if (!configured) return initGovernance(config);
  return instance;
}

/**
 * Convenience wrapper for the post-call accounting site. Fire-and-forget,
 * never throws. No-op when governance is disabled.
 */
export function recordSpend(
  config: AgentStackConfig,
  input: RecordSpendInput,
): void {
  try {
    getGovernanceService(config)?.recordSpend(input);
  } catch (err) {
    log.warn('recordSpend failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Reset the singleton (testing only). */
export function resetGovernanceService(): void {
  if (ownedDb) {
    try {
      ownedDb.close();
    } catch {
      // ignore
    }
  }
  ownedDb = null;
  instance = null;
  configured = false;
}
