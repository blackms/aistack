/**
 * Cost governance types (AIG-867).
 *
 * A thin governance layer that derives spend (tokens + estimated USD) from the
 * same usage signal the OTel `aistack.llm.chat` span already carries, attributes
 * it per tenant/workspace/project/agent-pattern, and enforces optional budget
 * caps with a two-stage kill-switch (warn -> block).
 *
 * SECURITY DEFAULT: the whole module is opt-in. `enabled: false` (default) makes
 * every entry point a no-op, and `enforce.block` is additionally `false` by
 * default so that turning governance on starts in observe-only / warn mode.
 * This mirrors the guardrails (AIG-868), audit (AIG-635) and tracing modules,
 * all of which are off by default.
 */

// Config-shaped types live in the root types module (single source of truth,
// referenced by AgentStackConfig.governance). Imported here for local use in
// the report/runtime types below, and re-exported so governance code can import
// everything from one place.
import type { CostBudget } from '../types.js';

export type {
  ModelPrice,
  PriceTable,
  BudgetWindow,
  CostBudgetScope,
  CostBudget,
  GovernanceEnforceConfig,
  GovernanceConfig,
} from '../types.js';

/** Dimension a spend report can be grouped by. */
export type SpendDimension = 'tenant' | 'workspace' | 'project' | 'agent';

/**
 * A normalized spend event derived from one LLM call. Persisted as a row in the
 * `cost_ledger` table and the unit of aggregation for reports.
 */
export interface SpendRecord {
  /** Epoch millis the spend occurred. Defaults to now() when omitted. */
  ts?: number;
  /** Resolved tenant id, or `__default__` in single-tenant mode. */
  tenantId?: string;
  /** Resolved workspace id, or null. */
  workspaceId?: string;
  /** Project label (free-form), or `__default__`. */
  project?: string;
  /** Concrete agent type (e.g. `coder`) used for agent-pattern attribution. */
  agentType?: string;
  /** Provider name (e.g. `anthropic`). */
  provider: string;
  /** Model id (request or response model). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD cost; computed from the price table when omitted. */
  usdCost?: number;
}

/** One grouped row of a spend report. */
export interface SpendReportRow {
  /** The dimension key (tenant id / workspace id / project / agent type). */
  key: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usdCost: number;
  /** Number of LLM calls aggregated into this row. */
  calls: number;
}

/** Result of a spend query. */
export interface SpendReport {
  dimension: SpendDimension;
  from?: number;
  to?: number;
  rows: SpendReportRow[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    usdCost: number;
    calls: number;
  };
}

/** Filters accepted by the aggregator query. */
export interface SpendQuery {
  dimension: SpendDimension;
  /** Inclusive lower bound (epoch millis). */
  from?: number;
  /** Inclusive upper bound (epoch millis). */
  to?: number;
  tenantId?: string;
  workspaceId?: string;
  project?: string;
}

/** Context passed to a pre-call budget check. */
export interface BudgetCheckContext {
  tenantId?: string;
  workspaceId?: string;
  project?: string;
  agentType?: string;
}

/** Enforcement state for a budget check. */
export type BudgetState = 'ok' | 'warn' | 'block';

/** Outcome of a budget evaluation. */
export interface BudgetEvaluation {
  state: BudgetState;
  /** The budget that produced the highest-severity state, if any matched. */
  budget?: CostBudget;
  /** Current spend in the window, in USD and tokens. */
  currentUsd: number;
  currentTokens: number;
  /** Percentage of the tripped limit reached (0..n). */
  percent: number;
}

/** Sentinel used when no tenant/workspace/project is resolvable. */
export const DEFAULT_BUCKET = '__default__';
