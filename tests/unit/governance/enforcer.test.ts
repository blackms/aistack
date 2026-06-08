/**
 * BudgetEnforcer + GovernanceService tests (AIG-867).
 *
 * Covers: budget resolution by specificity, warn->block thresholds, audit event
 * emission (idempotent), default-disabled no-op, block opt-in, and pricing
 * fail-open for unknown models.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Capture audit() calls without touching the real audit chain. Use vi.hoisted
// so the capture array exists before the hoisted vi.mock factory runs.
const { auditCalls } = vi.hoisted(() => ({
  auditCalls: [] as Array<{ event: string; payload: Record<string, unknown> }>,
}));
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

  describe('windowStart', () => {
    it('total returns 0', () => {
      expect(windowStart('total')).toBe(0);
    });

    it('week is calendar-aligned (stable within the same ISO week)', () => {
      // Two different instants within the same ISO week (Mon 2024-06-03 ..
      // Sun 2024-06-09) must resolve to the same window start.
      const monday = new Date(2024, 5, 3, 9, 0, 0).getTime(); // Mon 09:00 local
      const sunday = new Date(2024, 5, 9, 23, 59, 0).getTime(); // Sun 23:59 local
      const startMon = windowStart('week', monday);
      const startSun = windowStart('week', sunday);
      expect(startMon).toBe(startSun);
      // Start is Monday 00:00 local of that week.
      expect(startMon).toBe(new Date(2024, 5, 3, 0, 0, 0, 0).getTime());
    });

    it('week start is Monday 00:00 for every weekday', () => {
      const expected = new Date(2024, 5, 3, 0, 0, 0, 0).getTime(); // Mon
      for (let dow = 0; dow < 7; dow++) {
        // 2024-06-03 is Monday; iterate Mon..Sun.
        const instant = new Date(2024, 5, 3 + dow, 12, 0, 0).getTime();
        expect(windowStart('week', instant)).toBe(expected);
      }
      // The next Monday rolls over to a new window start.
      const nextMon = new Date(2024, 5, 10, 0, 0, 1).getTime();
      expect(windowStart('week', nextMon)).toBe(
        new Date(2024, 5, 10, 0, 0, 0, 0).getTime(),
      );
    });
  });

  describe('week-window audit idempotency', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function setupWeek(spentUsd: number) {
      const governance: GovernanceConfig = {
        enabled: true,
        enforce: { block: false, warnThresholdPercent: 80 },
        budgets: [{ id: 'cap', scope: { tenant: 'a' }, limitUsd: 100, window: 'week' }],
      };
      agg.recordSpend({
        tenantId: 'a',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        inputTokens: 0,
        outputTokens: 0,
        usdCost: spentUsd,
      });
      return new BudgetEnforcer(makeConfig(governance), governance, agg);
    }

    it('emits warn only once per week across repeated calls at different instants', () => {
      vi.useFakeTimers();
      // Tue 2024-06-04 within the ISO week starting Mon 2024-06-03.
      vi.setSystemTime(new Date(2024, 5, 4, 10, 0, 0));
      const e = setupWeek(85);

      e.evaluate({ tenantId: 'a' });
      // Advance time within the SAME ISO week; rolling-7d would have churned
      // the dedup key here, calendar-aligned must not.
      vi.setSystemTime(new Date(2024, 5, 6, 18, 0, 0)); // Thu, same week
      e.evaluate({ tenantId: 'a' });
      vi.setSystemTime(new Date(2024, 5, 9, 23, 0, 0)); // Sun, same week
      e.evaluate({ tenantId: 'a' });

      const warns = auditCalls.filter((c) => c.event === 'cost.budget.warn');
      expect(warns).toHaveLength(1);
    });

    it('re-emits warn once the ISO week rolls over', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 5, 6, 10, 0, 0)); // Thu, week of 06-03
      const e = setupWeek(85);
      e.evaluate({ tenantId: 'a' });

      // Cross into the next ISO week (Mon 2024-06-10).
      vi.setSystemTime(new Date(2024, 5, 11, 10, 0, 0)); // Tue, week of 06-10
      e.evaluate({ tenantId: 'a' });

      const warns = auditCalls.filter((c) => c.event === 'cost.budget.warn');
      expect(warns).toHaveLength(2);
    });
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
