/**
 * governance command — inspect cost/budget governance (AIG-867)
 *
 * Sub-commands:
 *   - status   module enabled/block state + ledger summary
 *   - budgets  list configured budgets
 *   - report   grouped spend report by dimension (--dimension --from --to)
 *
 * Read-only: governance is configured via aistack.config.json, not the CLI.
 * Modelled on src/cli/commands/audit.ts.
 */

import { Command } from 'commander';
import { getConfig } from '../../utils/config.js';
import { getGovernanceService } from '../../governance/index.js';
import type { SpendDimension, SpendReportRow } from '../../governance/index.js';

const VALID_DIMENSIONS: SpendDimension[] = ['tenant', 'workspace', 'project', 'agent'];

function parseTs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : ms;
}

function printTable(rows: SpendReportRow[], dimension: string): void {
  const header = [dimension.toUpperCase(), 'CALLS', 'IN_TOK', 'OUT_TOK', 'TOTAL_TOK', 'USD'];
  const data = rows.map((r) => [
    r.key,
    String(r.calls),
    String(r.inputTokens),
    String(r.outputTokens),
    String(r.totalTokens),
    r.usdCost.toFixed(4),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length)),
  );
  const fmt = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of data) console.log(fmt(row));
}

export function createGovernanceCommand(): Command {
  const command = new Command('governance').description(
    'Inspect cost/budget governance (spend reports, budgets, status)',
  );

  command
    .command('status')
    .description('Show governance status and ledger summary')
    .action(() => {
      const config = getConfig();
      const service = getGovernanceService(config);
      if (!service) {
        console.log('Cost governance: disabled (config.governance.enabled = false)');
        return;
      }
      const s = service.getStatus();
      console.log(`Cost governance: ${s.enabled ? 'enabled' : 'disabled'}`);
      console.log(`Block (kill-switch): ${s.blockEnabled ? 'ON' : 'off (observe-only)'}`);
      console.log(`Warn threshold:      ${s.warnThresholdPercent}%`);
      console.log(`Default window:      ${s.window}`);
      console.log(`Budgets configured:  ${s.budgets}`);
      console.log(`Ledger rows:         ${s.ledgerRows}`);
    });

  command
    .command('budgets')
    .description('List configured budgets')
    .option('-f, --format <fmt>', 'Output format: table | json', 'table')
    .action((options: { format: string }) => {
      const config = getConfig();
      const service = getGovernanceService(config);
      const budgets = service?.getBudgets() ?? [];
      if (options.format.toLowerCase() === 'json') {
        console.log(JSON.stringify(budgets, null, 2));
        return;
      }
      if (budgets.length === 0) {
        console.log('No budgets configured (unlimited).');
        return;
      }
      for (const b of budgets) {
        const scope = b.scope ?? {};
        const scopeStr =
          Object.entries(scope)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ') || '(global)';
        const limit = [
          b.limitUsd !== undefined ? `$${b.limitUsd}` : null,
          b.limitTokens !== undefined ? `${b.limitTokens} tok` : null,
        ]
          .filter(Boolean)
          .join(' / ');
        console.log(`- ${b.id ?? '(unnamed)'} [${scopeStr}] limit=${limit} window=${b.window ?? 'default'}`);
      }
    });

  command
    .command('report')
    .description('Grouped spend report by dimension')
    .option('-d, --dimension <dim>', 'tenant | workspace | project | agent', 'tenant')
    .option('--from <ts>', 'Lower bound (epoch ms or ISO-8601)')
    .option('--to <ts>', 'Upper bound (epoch ms or ISO-8601)')
    .option('-f, --format <fmt>', 'Output format: table | json', 'table')
    .action((options: { dimension: string; from?: string; to?: string; format: string }) => {
      const config = getConfig();
      const service = getGovernanceService(config);
      if (!service) {
        console.error('Cost governance is disabled. Enable with config.governance.enabled = true.');
        process.exit(1);
      }

      const dim = options.dimension as SpendDimension;
      if (!VALID_DIMENSIONS.includes(dim)) {
        console.error(`Invalid dimension "${options.dimension}" (use ${VALID_DIMENSIONS.join('|')})`);
        process.exit(1);
      }

      const report = service.getReport({
        dimension: dim,
        from: parseTs(options.from),
        to: parseTs(options.to),
      });

      if (options.format.toLowerCase() === 'json') {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      if (report.rows.length === 0) {
        console.log('No spend recorded for the selected window.');
        return;
      }
      printTable(report.rows, dim);
      console.log('');
      console.log(
        `TOTAL: ${report.totals.calls} calls, ${report.totals.totalTokens} tokens, ` +
          `$${report.totals.usdCost.toFixed(4)}`,
      );
    });

  return command;
}
