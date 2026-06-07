/**
 * CostAggregator tests (AIG-867) — token aggregation + per-dimension attribution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CostAggregator } from '../../../src/governance/aggregator.js';
import { DEFAULT_BUCKET } from '../../../src/governance/types.js';

describe('CostAggregator', () => {
  let db: Database.Database;
  let agg: CostAggregator;

  beforeEach(() => {
    db = new Database(':memory:');
    agg = new CostAggregator(db);
  });

  afterEach(() => {
    db.close();
  });

  function seed(): void {
    // tenant A / ws-1 / proj-x / coder
    agg.recordSpend({
      tenantId: 'tenant-a',
      workspaceId: 'ws-1',
      project: 'proj-x',
      agentType: 'coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 0.0105,
    });
    // tenant A / ws-1 / proj-x / reviewer
    agg.recordSpend({
      tenantId: 'tenant-a',
      workspaceId: 'ws-1',
      project: 'proj-x',
      agentType: 'reviewer',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 200,
      outputTokens: 100,
      usdCost: 0.0021,
    });
    // tenant B / ws-2 / proj-y / coder
    agg.recordSpend({
      tenantId: 'tenant-b',
      workspaceId: 'ws-2',
      project: 'proj-y',
      agentType: 'coder',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 4000,
      outputTokens: 1000,
      usdCost: 0.02,
    });
  }

  it('aggregates tokens + USD grouped by tenant', () => {
    seed();
    const report = agg.querySpend({ dimension: 'tenant' });
    expect(report.rows).toHaveLength(2);

    const a = report.rows.find((r) => r.key === 'tenant-a')!;
    expect(a.inputTokens).toBe(1200);
    expect(a.outputTokens).toBe(600);
    expect(a.totalTokens).toBe(1800);
    expect(a.calls).toBe(2);
    expect(a.usdCost).toBeCloseTo(0.0126, 6);

    const b = report.rows.find((r) => r.key === 'tenant-b')!;
    expect(b.totalTokens).toBe(5000);
    expect(b.calls).toBe(1);
  });

  it('aggregates by workspace, project and agent dimensions', () => {
    seed();
    expect(agg.querySpend({ dimension: 'workspace' }).rows).toHaveLength(2);
    expect(agg.querySpend({ dimension: 'project' }).rows).toHaveLength(2);

    const byAgent = agg.querySpend({ dimension: 'agent' });
    const coder = byAgent.rows.find((r) => r.key === 'coder')!;
    // coder spans tenant A + tenant B
    expect(coder.calls).toBe(2);
    expect(coder.totalTokens).toBe(1500 + 5000);
  });

  it('computes report totals across rows', () => {
    seed();
    const report = agg.querySpend({ dimension: 'tenant' });
    expect(report.totals.calls).toBe(3);
    expect(report.totals.totalTokens).toBe(1800 + 5000);
    expect(report.totals.usdCost).toBeCloseTo(0.0326, 6);
  });

  it('filters by time window in querySpend', () => {
    const t0 = 1_000_000;
    agg.recordSpend({
      tenantId: 'tenant-a',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 100,
      outputTokens: 100,
      usdCost: 0.001,
      ts: t0,
    });
    agg.recordSpend({
      tenantId: 'tenant-a',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 100,
      outputTokens: 100,
      usdCost: 0.001,
      ts: t0 + 10_000,
    });
    const recent = agg.querySpend({ dimension: 'tenant', from: t0 + 5_000 });
    expect(recent.totals.calls).toBe(1);
  });

  it('sumSpend honours scope filters', () => {
    seed();
    const all = agg.sumSpend({});
    expect(all.calls).toBe(3);

    const justA = agg.sumSpend({ tenantId: 'tenant-a' });
    expect(justA.calls).toBe(2);
    expect(justA.inputTokens + justA.outputTokens).toBe(1800);

    const justWs1Proj = agg.sumSpend({ tenantId: 'tenant-a', project: 'proj-x' });
    expect(justWs1Proj.calls).toBe(2);
  });

  it('uses default buckets for missing tenant/project/agent', () => {
    agg.recordSpend({
      provider: 'ollama',
      model: 'llama3',
      inputTokens: 10,
      outputTokens: 10,
    });
    const report = agg.querySpend({ dimension: 'tenant' });
    expect(report.rows[0].key).toBe(DEFAULT_BUCKET);
    // usdCost defaults to 0 when not supplied
    expect(report.rows[0].usdCost).toBe(0);
  });

  it('schema bootstrap is idempotent (re-construct over same db)', () => {
    seed();
    const agg2 = new CostAggregator(db);
    expect(agg2.count()).toBe(3);
  });
});
