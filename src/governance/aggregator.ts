/**
 * CostAggregator (AIG-867).
 *
 * Persists one append-only row per LLM call into `cost_ledger` and answers
 * grouped spend queries by dimension. Uses the shared SQLite database (the same
 * file `getMemoryManager(config).getStore()` opens) so reports survive process
 * restarts and can be inspected with standard SQLite tooling.
 *
 * Schema bootstrap is inline + idempotent (mirrors TenantService) so unit tests
 * and REPL usage work without running a migration file first.
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_BUCKET,
  type SpendDimension,
  type SpendQuery,
  type SpendRecord,
  type SpendReport,
  type SpendReportRow,
} from './types.js';

const log = logger.child('governance:aggregator');

interface LedgerAggRow {
  key: string | null;
  input_tokens: number;
  output_tokens: number;
  usd_cost: number;
  calls: number;
}

/** Column the GROUP BY uses for each report dimension. */
const DIMENSION_COLUMN: Record<SpendDimension, string> = {
  tenant: 'tenant_id',
  workspace: 'workspace_id',
  project: 'project',
  agent: 'agent_type',
};

export class CostAggregator {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT,
        project TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        usd_cost REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cost_ledger_ts ON cost_ledger(ts);
      CREATE INDEX IF NOT EXISTS idx_cost_ledger_tenant_ts
        ON cost_ledger(tenant_id, ts);
      CREATE INDEX IF NOT EXISTS idx_cost_ledger_tenant_ws_ts
        ON cost_ledger(tenant_id, workspace_id, ts);
      CREATE INDEX IF NOT EXISTS idx_cost_ledger_project_ts
        ON cost_ledger(project, ts);
      CREATE INDEX IF NOT EXISTS idx_cost_ledger_agent_ts
        ON cost_ledger(agent_type, ts);
    `);
  }

  /**
   * Append a spend record. Caller is expected to have already computed
   * `usdCost`; if absent it is stored as 0 (tokens are always preserved).
   */
  recordSpend(record: SpendRecord): void {
    const ts = record.ts ?? Date.now();
    try {
      this.db
        .prepare(
          `INSERT INTO cost_ledger
             (ts, tenant_id, workspace_id, project, agent_type,
              provider, model, input_tokens, output_tokens, usd_cost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ts,
          record.tenantId ?? DEFAULT_BUCKET,
          record.workspaceId ?? null,
          record.project ?? DEFAULT_BUCKET,
          record.agentType ?? DEFAULT_BUCKET,
          record.provider,
          record.model,
          record.inputTokens,
          record.outputTokens,
          record.usdCost ?? 0,
        );
    } catch (err) {
      // Accounting must never break the caller's flow.
      log.warn('Failed to record spend', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Sum tokens and USD over a window, optionally filtered by scope. Used by the
   * enforcer to compute current spend against a budget.
   */
  sumSpend(filters: {
    from?: number;
    to?: number;
    tenantId?: string;
    workspaceId?: string;
    project?: string;
    agentType?: string;
  }): { inputTokens: number; outputTokens: number; usdCost: number; calls: number } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.from !== undefined) {
      where.push('ts >= ?');
      params.push(filters.from);
    }
    if (filters.to !== undefined) {
      where.push('ts <= ?');
      params.push(filters.to);
    }
    if (filters.tenantId !== undefined) {
      where.push('tenant_id = ?');
      params.push(filters.tenantId);
    }
    if (filters.workspaceId !== undefined) {
      where.push('workspace_id = ?');
      params.push(filters.workspaceId);
    }
    if (filters.project !== undefined) {
      where.push('project = ?');
      params.push(filters.project);
    }
    if (filters.agentType !== undefined) {
      where.push('agent_type = ?');
      params.push(filters.agentType);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(usd_cost), 0) AS usd_cost,
           COUNT(*) AS calls
         FROM cost_ledger ${clause}`,
      )
      .get(...params) as {
        input_tokens: number;
        output_tokens: number;
        usd_cost: number;
        calls: number;
      };
    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      usdCost: row.usd_cost,
      calls: row.calls,
    };
  }

  /**
   * Grouped spend report by the requested dimension. Rows are ordered by USD
   * cost descending so the biggest spenders surface first.
   */
  querySpend(query: SpendQuery): SpendReport {
    const column = DIMENSION_COLUMN[query.dimension];
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.from !== undefined) {
      where.push('ts >= ?');
      params.push(query.from);
    }
    if (query.to !== undefined) {
      where.push('ts <= ?');
      params.push(query.to);
    }
    if (query.tenantId !== undefined) {
      where.push('tenant_id = ?');
      params.push(query.tenantId);
    }
    if (query.workspaceId !== undefined) {
      where.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    if (query.project !== undefined) {
      where.push('project = ?');
      params.push(query.project);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `SELECT
           ${column} AS key,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(usd_cost), 0) AS usd_cost,
           COUNT(*) AS calls
         FROM cost_ledger ${clause}
         GROUP BY ${column}
         ORDER BY usd_cost DESC, calls DESC`,
      )
      .all(...params) as LedgerAggRow[];

    const reportRows: SpendReportRow[] = rows.map((r) => ({
      key: r.key ?? DEFAULT_BUCKET,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      totalTokens: r.input_tokens + r.output_tokens,
      usdCost: r.usd_cost,
      calls: r.calls,
    }));

    const totals = reportRows.reduce(
      (acc, r) => {
        acc.inputTokens += r.inputTokens;
        acc.outputTokens += r.outputTokens;
        acc.totalTokens += r.totalTokens;
        acc.usdCost += r.usdCost;
        acc.calls += r.calls;
        return acc;
      },
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, usdCost: 0, calls: 0 },
    );

    return {
      dimension: query.dimension,
      from: query.from,
      to: query.to,
      rows: reportRows,
      totals,
    };
  }

  /** Total rows in the ledger (for status). */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM cost_ledger')
      .get() as { n: number };
    return row.n;
  }
}
