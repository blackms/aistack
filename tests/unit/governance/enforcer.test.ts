/**
 * BudgetEnforcer + GovernanceService tests (AIG-867).
 *
 * Covers: budget resolution by specificity, warn->block thresholds, audit event
 * emission (idempotent), default-disabled no-op, block opt-in, and pricing
 * fail-open for unknown models.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Capture audit() calls without touching the real audit chain.
const auditCalls: Array<{ event: string; payload: Record<string, unknown> }> = [];
vi.mock('../../../src/audit/index.js', () => ({
  audit: (_config: unknown, event: string, payload: Record<string, unknown>) => {
    auditCalls.push({ event, payload });
    return 1;
  },
}));

import { CostAggregator } from '../../../src/governance/aggregator.js';
import { BudgetEnforcer, windowStart } from '../../../src/governance/enforcer.js';
import {
  GovernanceService,
  CostBudgetExceededError,
} from '../../../src/governance/service.js';
import type { AgentStackConfig, GovernanceConfig } from '../../../src/types.js';

function makeConfig(governance: GovernanceConfig): AgentStackConfig {
  // Only the fields the governance code touches are required.
  return {
    memory: { path: ':memory:' },
    governance,
  } as unknown as AgentStackConfig;
}

describe('BudgetEnforcer', () => {
  let db: Database.Database;
  let agg: CostAggregator;

  beforeEach(() => {
    auditCalls.length = 0;
    db = new Database(':memory:');
    agg = new CostAggregator(db);
  });

  describe('budget resolution', () => {
    it('selects the most specific matching budget', () => {
      const governance: GovernanceConfig = {
        enabled: true,
        budgets: [
          { id: 'global', limitUsd: 100 },
          { id: 'tenant-a', scope: { tenant: 'a' }, limitUsd: 50 },
          { id: 'tenant-a-coder', scope: { tenant: 'a', agentPattern: 'coder' }, limitUsd: 10 },
        ],
      };
      const enforcer = new BudgetEnforcer(makeConfig(governance), governance, agg);
      const b = enforcer.resolveBudget({ tenantId: 'a', agentType: 'coder' });
      expect(b?.id).toBe('tenant-a-coder');

      const b2 = enforcer.resolveBudget({ tenantId: 'a', agentType: 'reviewer' });
      expect(b2?.id).toBe('tenant-a');

      const b3 = enforcer.resolveBudget({ tenantId: 'z', agentType: 'coder' });
      expect(b3?.id).toBe('global');
    });

    it('returns undefined when no budget matches the tenant', () => {
      const governance: GovernanceConfig = {
        enabled: true,
        budgets: [{ id: 'tenant-a', scope: { tenant: 'a' }, limitUsd: 50 }],
      };
      const enforcer = new BudgetEnforcer(makeConfig(governance), governance, agg);
      expect(enforcer.resolveBudget({ tenantId: 'b' })).toBeUndefined();
    });
  });

  describe('warn -> block thresholds', () => {
    function setup(spentUsd: number) {
      const governance: GovernanceConfig = {
        enabled: true,
        window: 'total',
        enforce: { block: false, warnThresholdPercent: 80 },
        budgets: [{ id: 'cap', scope: { tenant: 'a' }, limitUsd: 100, window: 'total' }],
      };
      // Seed spend for tenant a.
      agg.recordSpend({
        tenantId: 'a',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        inputTokens: 0,
        outputTokens: 0,
        usdCost: spentUsd,
      });
      const enforcer = new BudgetEnforcer(makeConfig(governance), governance, agg);
      return enforcer;
    }

    it('ok below the warn threshold', () => {
      const e = setup(50);
      const ev = e.evaluate({ tenantId: 'a' });
      expect(ev.state).toBe('ok');
      expect(auditCalls).toHaveLength(0);
    });

    it('warn at/above warnThresholdPercent emits cost.budget.warn', () => {
      const e = setup(85);
      const ev = e.evaluate({ tenantId: 'a' });
      expect(ev.state).toBe('warn');
      expect(auditCalls.map((c) => c.event)).toContain('cost.budget.warn');
    });

    it('block at 100% emits cost.budget.block', () => {
      const e = setup(120);
      const ev = e.evaluate({ tenantId: 'a' });
      expect(ev.state).toBe('block');
      expect(auditCalls.map((c) => c.event)).toContain('cost.budget.block');
      expect(ev.percent).toBeGreaterThanOrEqual(100);
    });

    it('audit emission is idempotent per window+stage', () => {
      const e = setup(85);
      e.evaluate({ tenantId: 'a' });
      e.evaluate({ tenantId: 'a' });
      e.evaluate({ tenantId: 'a' });
      const warns = auditCalls.filter((c) => c.event === 'cost.budget.warn');
      expect(warns).toHaveLength(1);
    });
  });

  describe('token-based budgets', () => {
    it('blocks when token cap is exceeded', () => {
      const governance: GovernanceConfig = {
        enabled: true,
        window: 'total',
        budgets: [{ id: 'tok', scope: { tenant: 'a' }, limitTokens: 1000, window: 'total' }],
      };
      agg.recordSpend({
        tenantId: 'a',
        provider: 'anthropic',
        model: 'm',
        inputTokens: 800,
        outputTokens: 400,
      });
      const e = new BudgetEnforcer(makeConfig(governance), governance, agg);
      const ev = e.evaluate({ tenantId: 'a' });
      expect(ev.state).toBe('block');
    });
  });

  it('windowStart total returns 0', () => {
    expect(windowStart('total')).toBe(0);
  });
});

describe('GovernanceService', () => {
  beforeEach(() => {
    auditCalls.length = 0;
  });

  it('is a no-op when disabled (checkBudget never throws, recordSpend stores nothing)', () => {
    const db = new Database(':memory:');
    const governance: GovernanceConfig = {
      enabled: false,
      enforce: { block: true, warnThresholdPercent: 80 },
      budgets: [{ id: 'cap', scope: { tenant: 'a' }, limitUsd: 0.000001, window: 'total' }],
    };
    const svc = new GovernanceService(makeConfig(governance), db);

    // Even with a tiny cap + block enabled, disabled => no throw, no record.
    expect(() => svc.checkBudget({ tenantId: 'a', agentType: 'coder' })).not.toThrow();
    svc.recordSpend({
      tenantId: 'a',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    expect(svc.getAggregator().count()).toBe(0);
    db.close();
  });

  it('SECURITY DEFAULT: with block disabled, an over-budget call is NOT blocked', () => {
    const db = new Database(':memory:');
    const governance: GovernanceConfig = {
      enabled: true,
      window: 'total',
      enforce: { block: false, warnThresholdPercent: 80 },
      budgets: [{ id: 'cap', scope: { tenant: 'a' }, limitUsd: 0.0001, window: 'total' }],
    };
    const svc = new GovernanceService(makeConfig(governance), db);

    // Drive spend over the cap.
    svc.recordSpend({
      tenantId: 'a',
      agentType: 'coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    // block disabled -> checkBudget returns block state but does not throw.
    const ev = svc.checkBudget({ tenantId: 'a', agentType: 'coder' });
    expect(ev.state).toBe('block');
    db.close();
  });

  it('throws CostBudgetExceededError only when block is explicitly enabled', () => {
    const db = new Database(':memory:');
    const governance: GovernanceConfig = {
      enabled: true,
      window: 'total',
      enforce: { block: true, warnThresholdPercent: 80 },
      budgets: [{ id: 'cap', scope: { tenant: 'a' }, limitUsd: 0.0001, window: 'total' }],
    };
    const svc = new GovernanceService(makeConfig(governance), db);
    svc.recordSpend({
      tenantId: 'a',
      agentType: 'coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(() => svc.checkBudget({ tenantId: 'a', agentType: 'coder' })).toThrow(
      CostBudgetExceededError,
    );
    db.close();
  });

  it('records spend with fail-open pricing for unknown model (tokens kept, USD 0)', () => {
    const db = new Database(':memory:');
    const governance: GovernanceConfig = { enabled: true };
    const svc = new GovernanceService(makeConfig(governance), db);
    svc.recordSpend({
      tenantId: 'a',
      provider: 'mystery',
      model: 'unknown-model',
      inputTokens: 500,
      outputTokens: 250,
    });
    const report = svc.getReport({ dimension: 'tenant' });
    expect(report.totals.totalTokens).toBe(750);
    expect(report.totals.usdCost).toBe(0);
    db.close();
  });
});
