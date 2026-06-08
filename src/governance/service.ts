/**
 * GovernanceService (AIG-867).
 *
 * Composes the price table, aggregator and enforcer behind two call-site
 * methods used by the spawner:
 *
 *   - `checkBudget(ctx)`  — pre-call; may throw CostBudgetExceededError when
 *                           `enforce.block` is on and the budget is at 100%.
 *   - `recordSpend(...)`  — post-call; computes USD from the price table and
 *                           appends a ledger row, then re-evaluates to emit
 *                           warn/block audit events.
 *
 * SECURITY DEFAULT: when `config.governance.enabled` is false the service is
 * never constructed (see index.ts) — there is no runtime cost. Even when
 * enabled, blocking requires `enforce.block: true`.
 */

import type Database from 'better-sqlite3';
import type { AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { CostAggregator } from './aggregator.js';
import { BudgetEnforcer } from './enforcer.js';
import {
  estimateUsdCost,
  mergePriceTable,
  resolvePrice,
} from './price-table.js';
import {
  DEFAULT_BUCKET,
  type BudgetCheckContext,
  type BudgetEvaluation,
  type GovernanceConfig,
  type PriceTable,
  type SpendQuery,
  type SpendRecord,
  type SpendReport,
} from './types.js';

const log = logger.child('governance');

/**
 * Thrown by the spawner (via GovernanceService.checkBudget) when a budget is at
 * or above 100% and hard blocking is enabled. Carries the evaluation so callers
 * and audit handlers can report the offending budget.
 */
export class CostBudgetExceededError extends Error {
  constructor(public readonly evaluation: BudgetEvaluation) {
    const id = evaluation.budget?.id ?? 'unnamed budget';
    super(
      `cost budget exceeded (${id}): ${Math.round(evaluation.percent)}% of cap ` +
        `(spend $${evaluation.currentUsd.toFixed(4)}, ${evaluation.currentTokens} tokens)`,
    );
    this.name = 'CostBudgetExceededError';
  }
}

/** Input for a post-call spend record (usage + attribution metadata). */
export interface RecordSpendInput {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  agentType?: string;
  project?: string;
  tenantId?: string;
  workspaceId?: string;
  ts?: number;
}

export class GovernanceService {
  private config: AgentStackConfig;
  private governance: GovernanceConfig;
  private priceTable: PriceTable;
  private aggregator: CostAggregator;
  private enforcer: BudgetEnforcer;

  constructor(config: AgentStackConfig, db: Database.Database) {
    this.config = config;
    this.governance = config.governance ?? { enabled: false };
    this.priceTable = mergePriceTable(this.governance.priceTable);
    this.aggregator = new CostAggregator(db);
    this.enforcer = new BudgetEnforcer(config, this.governance, this.aggregator);
  }

  /** Whether the module is active. */
  isEnabled(): boolean {
    return this.governance.enabled === true;
  }

  /**
   * Pre-call budget check. No-op when disabled. Evaluates the matching budget
   * and, only when `enforce.block` is true and the budget is at 100%, throws
   * CostBudgetExceededError to prevent the LLM call. Otherwise (warn / observe)
   * it returns the evaluation without throwing.
   */
  checkBudget(ctx: BudgetCheckContext): BudgetEvaluation {
    if (!this.isEnabled()) {
      return { state: 'ok', currentUsd: 0, currentTokens: 0, percent: 0 };
    }
    const evaluation = this.enforcer.evaluate(ctx);
    if (evaluation.state === 'block' && this.enforcer.isBlockEnabled()) {
      throw new CostBudgetExceededError(evaluation);
    }
    return evaluation;
  }

  /**
   * Post-call accounting. No-op when disabled. Computes the estimated USD cost
   * from the price table, appends a ledger row, then re-evaluates the budget so
   * threshold-crossing warn/block audit events fire.
   */
  recordSpend(input: RecordSpendInput): void {
    if (!this.isEnabled()) return;
    // Nothing to record if the provider didn't return usage.
    if (!input.inputTokens && !input.outputTokens) return;

    const price = resolvePrice(this.priceTable, input.provider, input.model);
    const usdCost = estimateUsdCost(price, input.inputTokens, input.outputTokens);

    const record: SpendRecord = {
      ts: input.ts,
      tenantId: input.tenantId ?? DEFAULT_BUCKET,
      workspaceId: input.workspaceId,
      project: input.project ?? DEFAULT_BUCKET,
      agentType: input.agentType ?? DEFAULT_BUCKET,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      usdCost,
    };
    this.aggregator.recordSpend(record);

    // Re-evaluate so a freshly-crossed threshold emits its audit event. This is
    // observe-only on the post-call path — it never throws.
    try {
      this.enforcer.evaluate({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        project: input.project,
        agentType: input.agentType,
      });
    } catch (err) {
      log.warn('Post-call budget evaluation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Grouped spend report. Works regardless of enabled state (read-only). */
  getReport(query: SpendQuery): SpendReport {
    return this.aggregator.querySpend(query);
  }

  /** Status summary for the CLI / REST `status` endpoint. */
  getStatus(): {
    enabled: boolean;
    blockEnabled: boolean;
    warnThresholdPercent: number;
    window: string;
    budgets: number;
    ledgerRows: number;
  } {
    return {
      enabled: this.isEnabled(),
      blockEnabled: this.enforcer.isBlockEnabled(),
      warnThresholdPercent: this.governance.enforce?.warnThresholdPercent ?? 80,
      window: this.governance.window ?? 'month',
      budgets: (this.governance.budgets ?? []).length,
      ledgerRows: this.aggregator.count(),
    };
  }

  /** Expose budgets for the REST `/budgets` endpoint. */
  getBudgets(): GovernanceConfig['budgets'] {
    return this.governance.budgets ?? [];
  }

  /** Direct aggregator access (testing / advanced callers). */
  getAggregator(): CostAggregator {
    return this.aggregator;
  }
}
