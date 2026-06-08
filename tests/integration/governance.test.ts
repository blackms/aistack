/**
 * Cost governance integration test (AIG-867).
 *
 * Exercises the public facade end-to-end against a real on-disk SQLite store,
 * simulating the spawner's record/check flow:
 *   - spend attribution per tenant/workspace/project/agent dimension,
 *   - default-disabled no-op,
 *   - kill-switch: NOT blocking by default (observe-only), blocking when
 *     enforce.block is explicitly enabled.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultConfig } from '../../src/utils/config.js';
import {
  getGovernanceService,
  resetGovernanceService,
  CostBudgetExceededError,
} from '../../src/governance/index.js';
import type { AgentStackConfig, GovernanceConfig } from '../../src/types.js';

function configWith(governance: GovernanceConfig, dbPath: string): AgentStackConfig {
  const config = getDefaultConfig();
  config.memory.path = dbPath;
  config.governance = governance;
  return config;
}

describe('cost governance (integration)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aistack-gov-test-'));
    dbPath = join(tmpDir, 'gov.db');
    resetGovernanceService();
  });

  afterEach(() => {
    resetGovernanceService();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is fully disabled by default (getDefaultConfig)', () => {
    const config = getDefaultConfig();
    config.memory.path = dbPath;
    expect(config.governance?.enabled).toBe(false);
    expect(getGovernanceService(config)).toBeNull();
  });

  it('attributes spend per tenant/workspace/project/agent', () => {
    const config = configWith({ enabled: true }, dbPath);
    const svc = getGovernanceService(config)!;
    expect(svc).not.toBeNull();

    // Simulate two LLM calls in different tenants/agents.
    svc.recordSpend({
      tenantId: 'tenant-a',
      workspaceId: 'ws-1',
      project: 'alpha',
      agentType: 'coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 10_000,
      outputTokens: 2_000,
    });
    svc.recordSpend({
      tenantId: 'tenant-b',
      workspaceId: 'ws-2',
      project: 'beta',
      agentType: 'reviewer',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 5_000,
      outputTokens: 1_000,
    });

    const byTenant = svc.getReport({ dimension: 'tenant' });
    expect(byTenant.rows.map((r) => r.key).sort()).toEqual(['tenant-a', 'tenant-b']);
    // tenant-a sonnet: (10000/1e6*3) + (2000/1e6*15) = 0.03 + 0.03 = 0.06
    const a = byTenant.rows.find((r) => r.key === 'tenant-a')!;
    expect(a.usdCost).toBeCloseTo(0.06, 6);

    const byAgent = svc.getReport({ dimension: 'agent' });
    expect(byAgent.rows.map((r) => r.key).sort()).toEqual(['coder', 'reviewer']);

    const byProject = svc.getReport({ dimension: 'project' });
    expect(byProject.rows.map((r) => r.key).sort()).toEqual(['alpha', 'beta']);

    expect(byTenant.totals.totalTokens).toBe(18_000);
  });

  it('persists spend across service resets (shared SQLite store)', () => {
    const config = configWith({ enabled: true }, dbPath);
    getGovernanceService(config)!.recordSpend({
      tenantId: 'tenant-a',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    resetGovernanceService();

    const svc2 = getGovernanceService(config)!;
    expect(svc2.getReport({ dimension: 'tenant' }).totals.calls).toBe(1);
  });

  it('kill-switch: observe-only by default does NOT block over-budget calls', () => {
    const config = configWith(
      {
        enabled: true,
        window: 'total',
        enforce: { block: false, warnThresholdPercent: 80 },
        budgets: [
          { id: 'cap-a', scope: { tenant: 'tenant-a' }, limitUsd: 0.01, window: 'total' },
        ],
      },
      dbPath,
    );
    const svc = getGovernanceService(config)!;

    // Spend well past the $0.01 cap.
    svc.recordSpend({
      tenantId: 'tenant-a',
      agentType: 'coder',
      provider: 'anthropic',
      model: 'claude-3-opus',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });

    // checkBudget reports block state but must NOT throw (block disabled).
    const ev = svc.checkBudget({ tenantId: 'tenant-a', agentType: 'coder' });
    expect(ev.state).toBe('block');
    expect(() => svc.checkBudget({ tenantId: 'tenant-a', agentType: 'coder' })).not.toThrow();
  });

  it('kill-switch: blocks over-budget calls when enforce.block is enabled', () => {
    const config = configWith(
      {
        enabled: true,
        window: 'total',
        enforce: { block: true, warnThresholdPercent: 80 },
        budgets: [
          { id: 'cap-a', scope: { tenant: 'tenant-a' }, limitUsd: 0.01, window: 'total' },
        ],
      },
      dbPath,
    );
    const svc = getGovernanceService(config)!;

    // Under budget initially: should not throw.
    expect(() => svc.checkBudget({ tenantId: 'tenant-a', agentType: 'coder' })).not.toThrow();

    // Drive spend over the cap, then the next pre-call check must throw.
    svc.recordSpend({
      tenantId: 'tenant-a',
      agentType: 'coder',
      provider: 'anthropic',
      model: 'claude-3-opus',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(() => svc.checkBudget({ tenantId: 'tenant-a', agentType: 'coder' })).toThrow(
      CostBudgetExceededError,
    );

    // A different tenant with no budget is unaffected.
    expect(() => svc.checkBudget({ tenantId: 'tenant-b', agentType: 'coder' })).not.toThrow();
  });

  it('CLI providers without usage produce no ledger rows', () => {
    const config = configWith({ enabled: true }, dbPath);
    const svc = getGovernanceService(config)!;
    svc.recordSpend({
      tenantId: 'tenant-a',
      provider: 'claude-code',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(svc.getReport({ dimension: 'tenant' }).totals.calls).toBe(0);
  });
});
