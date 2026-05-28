#!/usr/bin/env tsx
/**
 * Aggregate per-task JSON results from `results/aistack/` and
 * `results/baseline/` into a single `results/SUMMARY.md` table.
 *
 * The SWE-bench harness writes a final `report.json` with per-instance
 * `resolved` booleans. We join that against our runner-side JSONs (which
 * carry token/cost data the harness doesn't know about) and emit:
 *
 *   - Overall pass rate per runner
 *   - Pass rate broken down by repo
 *   - Total / mean cost per runner
 *   - Delta vs H1 thresholds (>= +15pp = hypothesis supported)
 *
 * Invocation (inside container):
 *   tsx benchmarks/swe-bench/aggregate.ts --root /work/results
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

interface RunnerResult {
  task_id: string;
  passed: boolean | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number;
}

interface HarnessReport {
  // SWE-bench's run_evaluation produces a JSON keyed by instance_id with
  // { resolved: bool, tests_passed: [...], tests_failed: [...] }
  [instance_id: string]: { resolved: boolean };
}

interface Aggregate {
  runner: string;
  total: number;
  passed: number;
  passRate: number;
  totalCostUsd: number;
  meanCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  byRepo: Record<string, { total: number; passed: number; passRate: number }>;
}

function parseArgs(): { root: string } {
  let root = '/work/results';
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = args[++i];
  }
  return { root };
}

function repoFromInstanceId(id: string): string {
  // SWE-bench instance ids look like `astropy__astropy-12907`
  return id.split('-').slice(0, -1).join('-');
}

async function loadRunnerResults(dir: string): Promise<RunnerResult[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(
    files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')) as RunnerResult),
  );
}

async function loadHarnessReport(path: string): Promise<HarnessReport> {
  if (!existsSync(path)) return {};
  return JSON.parse(await readFile(path, 'utf8')) as HarnessReport;
}

function aggregate(name: string, results: RunnerResult[], report: HarnessReport): Aggregate {
  const byRepo: Aggregate['byRepo'] = {};
  let passed = 0;
  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const r of results) {
    const repo = repoFromInstanceId(r.task_id);
    const bucket = (byRepo[repo] ??= { total: 0, passed: 0, passRate: 0 });
    bucket.total++;

    const resolved = report[r.task_id]?.resolved ?? false;
    if (resolved) {
      passed++;
      bucket.passed++;
    }
    totalCost += r.cost_usd ?? 0;
    totalIn += r.tokens_in ?? 0;
    totalOut += r.tokens_out ?? 0;
  }

  for (const repo of Object.keys(byRepo)) {
    byRepo[repo].passRate = byRepo[repo].total ? byRepo[repo].passed / byRepo[repo].total : 0;
  }

  return {
    runner: name,
    total: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    totalCostUsd: totalCost,
    meanCostUsd: results.length ? totalCost / results.length : 0,
    totalTokensIn: totalIn,
    totalTokensOut: totalOut,
    byRepo,
  };
}

function fmtPct(x: number): string {
  return (x * 100).toFixed(1) + '%';
}

function fmtUsd(x: number): string {
  return '$' + x.toFixed(2);
}

function renderSummary(baseline: Aggregate, aistack: Aggregate): string {
  const deltaPp = (aistack.passRate - baseline.passRate) * 100;
  const costRatio = baseline.totalCostUsd > 0 ? aistack.totalCostUsd / baseline.totalCostUsd : 0;
  const h1Supported = deltaPp >= 15 && costRatio <= 4;

  const lines: string[] = [];
  lines.push('# SWE-bench Verified — aistack vs baseline');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push('| Runner | Tasks | Resolved | Pass rate | Total cost | Mean cost / task |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  lines.push(
    `| baseline (single-shot) | ${baseline.total} | ${baseline.passed} | ${fmtPct(baseline.passRate)} | ${fmtUsd(baseline.totalCostUsd)} | ${fmtUsd(baseline.meanCostUsd)} |`,
  );
  lines.push(
    `| aistack (adversarial loop) | ${aistack.total} | ${aistack.passed} | ${fmtPct(aistack.passRate)} | ${fmtUsd(aistack.totalCostUsd)} | ${fmtUsd(aistack.meanCostUsd)} |`,
  );
  lines.push('');
  lines.push('## H1 verdict');
  lines.push('');
  lines.push(`- Delta pass rate: **${deltaPp >= 0 ? '+' : ''}${deltaPp.toFixed(1)} pp**`);
  lines.push(`- Cost ratio (aistack / baseline): **${costRatio.toFixed(2)}x**`);
  lines.push(`- H1 (>=+15pp at <=4x cost): **${h1Supported ? 'SUPPORTED' : 'NOT SUPPORTED'}**`);
  lines.push('');
  lines.push('## Per-repo breakdown');
  lines.push('');
  lines.push('| Repo | baseline | aistack | delta |');
  lines.push('|---|---:|---:|---:|');
  const repos = new Set([...Object.keys(baseline.byRepo), ...Object.keys(aistack.byRepo)]);
  for (const repo of [...repos].sort()) {
    const b = baseline.byRepo[repo];
    const a = aistack.byRepo[repo];
    const bRate = b ? fmtPct(b.passRate) : 'n/a';
    const aRate = a ? fmtPct(a.passRate) : 'n/a';
    const delta = b && a ? `${((a.passRate - b.passRate) * 100).toFixed(1)} pp` : 'n/a';
    lines.push(`| ${repo} | ${bRate} | ${aRate} | ${delta} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { root } = parseArgs();
  const baselineResults = await loadRunnerResults(join(root, 'baseline'));
  const aistackResults = await loadRunnerResults(join(root, 'aistack'));
  const baselineReport = await loadHarnessReport(join(root, 'baseline', 'harness_report.json'));
  const aistackReport = await loadHarnessReport(join(root, 'aistack', 'harness_report.json'));

  const baselineAgg = aggregate('baseline', baselineResults, baselineReport);
  const aistackAgg = aggregate('aistack', aistackResults, aistackReport);

  const out = renderSummary(baselineAgg, aistackAgg);
  await writeFile(join(root, 'SUMMARY.md'), out);
  console.log(`[aggregate] wrote ${join(root, 'SUMMARY.md')}`);
}

main().catch((err) => {
  console.error('[aggregate] fatal:', err);
  exit(1);
});
