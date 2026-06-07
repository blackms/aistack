/**
 * BudgetEnforcer (AIG-867).
 *
 * Resolves the effective budget for a (tenant, workspace, project, agent) tuple,
 * compares current window spend against it, and produces an `ok | warn | block`
 * state. Emits `cost.budget.warn` / `cost.budget.block` audit events (idempotent
 * per budget+window) and, only when `enforce.block` is enabled, signals that the
 * caller should throw a CostBudgetExceededError.
 *
 * SECURITY DEFAULT: `enforce.block` is false unless explicitly enabled, so the
 * enforcer is observe-only (accounting + warn) out of the box.
 *
 * NOTE: enforcement is a soft cap, not an atomic quota — concurrent calls
 * between checkBudget() and recordSpend() can slightly overrun the limit.
 */

import type { AgentStackConfig } from '../types.js';
import { audit } from '../audit/index.js';
import { logger } from '../utils/logger.js';
import type { CostAggregator } from './aggregator.js';
import {
  DEFAULT_BUCKET,
  type BudgetCheckContext,
  type BudgetEvaluation,
  type BudgetWindow,
  type CostBudget,
  type GovernanceConfig,
} from './types.js';

const log = logger.child('governance:enforcer');

const DEFAULT_WARN_PERCENT = 80;

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Compute the inclusive lower bound (epoch millis) of the current budget window.
 * `total` returns 0 (all time). Calendar-aligned for day/month, rolling 7d for
 * week to keep it simple and timezone-independent enough for a soft cap.
 */
export function windowStart(window: BudgetWindow, now: number = Date.now()): number {
  if (window === 'total') return 0;
  const d = new Date(now);
  if (window === 'day') {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  if (window === 'month') {
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  // week: rolling 7 days
  return now - 7 * 24 * 60 * 60 * 1000;
}

/**
 * Score how specifically a budget scope matches the given context. Higher score
 * = more specific. Returns null when the scope explicitly conflicts with the
 * context (e.g. budget targets tenant A but context is tenant B).
 */
function scopeScore(budget: CostBudget, ctx: BudgetCheckContext): number | null {
  const scope = budget.scope ?? {};
  let score = 0;

  if (scope.tenant !== undefined) {
    if ((ctx.tenantId ?? DEFAULT_BUCKET) !== scope.tenant) return null;
    score += 8;
  }
  if (scope.workspace !== undefined) {
    if ((ctx.workspaceId ?? '') !== scope.workspace) return null;
    score += 4;
  }
  if (scope.project !== undefined) {
    if ((ctx.project ?? DEFAULT_BUCKET) !== scope.project) return null;
    score += 2;
  }
  if (scope.agentPattern !== undefined) {
    const agentType = ctx.agentType ?? DEFAULT_BUCKET;
    if (!globToRegExp(scope.agentPattern).test(agentType)) return null;
    // Exact (non-wildcard) patterns are more specific than globs.
    score += scope.agentPattern.includes('*') ? 1 : 3;
  }
  return score;
}

export class BudgetEnforcer {
  private config: AgentStackConfig;
  private governance: GovernanceConfig;
  private aggregator: CostAggregator;
  /** Tracks which (budgetKey:windowStart:stage) events were already emitted. */
  private emitted = new Set<string>();

  constructor(
    config: AgentStackConfig,
    governance: GovernanceConfig,
    aggregator: CostAggregator,
  ) {
    this.config = config;
    this.governance = governance;
    this.aggregator = aggregator;
  }

  /**
   * Select the most specific budget that matches the context. Budgets that
   * don't match the context's tenant/workspace/etc are skipped.
   */
  resolveBudget(ctx: BudgetCheckContext): CostBudget | undefined {
    const budgets = this.governance.budgets ?? [];
    let best: { budget: CostBudget; score: number } | undefined;
    for (const budget of budgets) {
      const score = scopeScore(budget, ctx);
      if (score === null) continue;
      if (!best || score > best.score) {
        best = { budget, score };
      }
    }
    return best?.budget;
  }

  private budgetKey(budget: CostBudget): string {
    return (
      budget.id ??
      JSON.stringify({
        s: budget.scope ?? {},
        u: budget.limitUsd ?? null,
        t: budget.limitTokens ?? null,
      })
    );
  }

  /**
   * Evaluate the budget for the given context. Pure read + audit side-effect;
   * never throws. Returns the enforcement state.
   */
  evaluate(ctx: BudgetCheckContext): BudgetEvaluation {
    const budget = this.resolveBudget(ctx);
    if (!budget) {
      return { state: 'ok', currentUsd: 0, currentTokens: 0, percent: 0 };
    }

    const window = budget.window ?? this.governance.window ?? 'month';
    const from = windowStart(window);

    // Sum spend within the budget's scope. Only filter by scope fields that the
    // budget actually constrains, so a tenant-only budget aggregates across all
    // its workspaces/projects.
    const scope = budget.scope ?? {};
    const sum = this.aggregator.sumSpend({
      from,
      tenantId: scope.tenant,
      workspaceId: scope.workspace,
      project: scope.project,
      // agentPattern is a glob; can't push into SQL equality, so it is left to
      // the (rare) budget that scopes by exact agent type only.
      agentType:
        scope.agentPattern && !scope.agentPattern.includes('*')
          ? scope.agentPattern
          : undefined,
    });

    const currentTokens = sum.inputTokens + sum.outputTokens;
    const currentUsd = sum.usdCost;

    // Determine the percentage against whichever limit is the binding one.
    let percent = 0;
    if (budget.limitUsd && budget.limitUsd > 0) {
      percent = Math.max(percent, (currentUsd / budget.limitUsd) * 100);
    }
    if (budget.limitTokens && budget.limitTokens > 0) {
      percent = Math.max(percent, (currentTokens / budget.limitTokens) * 100);
    }

    const warnPercent =
      this.governance.enforce?.warnThresholdPercent ?? DEFAULT_WARN_PERCENT;

    let state: BudgetEvaluation['state'] = 'ok';
    if (percent >= 100) {
      state = 'block';
    } else if (warnPercent > 0 && percent >= warnPercent) {
      state = 'warn';
    }

    if (state !== 'ok') {
      this.emitOnce(budget, window, from, state, {
        percent: Math.round(percent * 100) / 100,
        currentUsd,
        currentTokens,
        limitUsd: budget.limitUsd ?? null,
        limitTokens: budget.limitTokens ?? null,
        tenantId: ctx.tenantId ?? DEFAULT_BUCKET,
        workspaceId: ctx.workspaceId ?? null,
        project: ctx.project ?? DEFAULT_BUCKET,
        agentType: ctx.agentType ?? DEFAULT_BUCKET,
        window,
      });
    }

    return { state, budget, currentUsd, currentTokens, percent };
  }

  /**
   * Emit a warn/block audit event at most once per (budget, window, stage). A
   * block event is also emitted for higher stages even if a warn was already
   * sent for the same window.
   */
  private emitOnce(
    budget: CostBudget,
    window: BudgetWindow,
    from: number,
    stage: 'warn' | 'block',
    payload: Record<string, unknown>,
  ): void {
    const key = `${this.budgetKey(budget)}:${from}:${stage}`;
    if (this.emitted.has(key)) return;
    this.emitted.add(key);

    const eventType = stage === 'block' ? 'cost.budget.block' : 'cost.budget.warn';
    const enriched = { ...payload, budgetId: budget.id ?? null };

    if (stage === 'block') {
      log.warn('Budget block threshold reached', enriched);
    } else {
      log.warn('Budget warn threshold reached', enriched);
    }
    // Fire-and-forget; audit() is itself non-throwing and no-op when disabled.
    audit(this.config, eventType, enriched);
  }

  /** Whether hard blocking is enabled. */
  isBlockEnabled(): boolean {
    return this.governance.enforce?.block === true;
  }

  /** Reset idempotency state (testing only). */
  _resetEmitted(): void {
    this.emitted.clear();
  }
}
