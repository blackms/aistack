#!/usr/bin/env tsx
/**
 * Baseline runner: same SWE-bench Verified task set, but a SINGLE Claude
 * Sonnet 4.6 call per task — no aistack loop, no adversarial review, no
 * retries. This is the apples-to-apples control for H1 in
 * `docs/BENCHMARK.md`.
 *
 * Why a separate file and not a `--no-loop` flag on run.ts:
 *   - Forces the diff to be obvious in code review (no chance of accidentally
 *     enabling adversarial review during the baseline run)
 *   - Lets us record `runner: "baseline"` in every result for honest comparison
 *
 * Invocation (inside container):
 *   tsx benchmarks/swe-bench/baseline.ts --limit 10 --out /work/results/baseline
 */

import Anthropic from '@anthropic-ai/sdk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, env, exit } from 'node:process';

interface SweBenchTask {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
}

interface BaselineResult {
  task_id: string;
  runner: 'baseline';
  status: 'completed' | 'error';
  passed: boolean | null;
  iterations: 1;
  patch: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number;
  model_snapshot: string;
  started_at: string;
  finished_at: string;
  git_sha: string;
  dataset_revision: string;
  error?: string;
}

const MODEL = env.AISTACK_MODEL_SNAPSHOT ?? 'claude-sonnet-4-5-20250514';

// Sonnet 4.6 list price as of plan time. Update when running.
// $3.00 / Mtok input, $15.00 / Mtok output.
const PRICE_IN_PER_MTOK = 3.0;
const PRICE_OUT_PER_MTOK = 15.0;

function parseArgs(): { limit?: number; out: string; tasksFile: string } {
  const args = argv.slice(2);
  let limit: number | undefined;
  let out = '/work/results/baseline';
  let tasksFile = '/work/results/_tasks.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') limit = Number(args[++i]);
    else if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--tasks') tasksFile = args[++i];
  }
  return { limit, out, tasksFile };
}

function buildPrompt(task: SweBenchTask): string {
  return [
    `Repository: ${task.repo} @ ${task.base_commit}`,
    '',
    'Issue:',
    task.problem_statement,
    task.hints_text ? `\nHints:\n${task.hints_text}` : '',
    '',
    'Produce a unified diff (git format) that fixes the issue. Output ONLY the diff inside a ```diff fenced block.',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractPatch(text: string): string | null {
  const fenced = text.match(/```diff\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  if (text.includes('diff --git')) return text.trim();
  return null;
}

async function runOne(client: Anthropic, task: SweBenchTask): Promise<BaselineResult> {
  const startedAt = new Date();
  const result: BaselineResult = {
    task_id: task.instance_id,
    runner: 'baseline',
    status: 'completed',
    passed: null,
    iterations: 1,
    patch: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    duration_ms: 0,
    model_snapshot: MODEL,
    started_at: startedAt.toISOString(),
    finished_at: '',
    git_sha: env.AISTACK_GIT_SHA ?? 'unknown',
    dataset_revision: env.DATASET_REVISION ?? 'main',
  };

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      messages: [{ role: 'user', content: buildPrompt(task) }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    result.patch = extractPatch(text);
    result.tokens_in = resp.usage.input_tokens;
    result.tokens_out = resp.usage.output_tokens;
    result.cost_usd =
      (result.tokens_in / 1_000_000) * PRICE_IN_PER_MTOK +
      (result.tokens_out / 1_000_000) * PRICE_OUT_PER_MTOK;
  } catch (err) {
    result.status = 'error';
    result.error = err instanceof Error ? err.message : String(err);
  }

  const finished = new Date();
  result.finished_at = finished.toISOString();
  result.duration_ms = finished.getTime() - startedAt.getTime();
  return result;
}

async function main(): Promise<void> {
  const { limit, out, tasksFile } = parseArgs();
  await mkdir(out, { recursive: true });

  if (!env.ANTHROPIC_API_KEY) {
    console.error('[baseline] ANTHROPIC_API_KEY not set');
    exit(2);
  }

  const tasks: SweBenchTask[] = JSON.parse(await readFile(tasksFile, 'utf8'));
  const slice = limit ? tasks.slice(0, limit) : tasks;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  console.log(`[baseline] ${slice.length} tasks -> ${out}`);
  let i = 0;
  for (const task of slice) {
    i++;
    console.log(`[baseline] (${i}/${slice.length}) ${task.instance_id}`);
    const r = await runOne(client, task);
    await writeFile(join(out, `${task.instance_id}.json`), JSON.stringify(r, null, 2));
  }
  console.log('[baseline] done');
}

main().catch((err) => {
  console.error('[baseline] fatal:', err);
  exit(1);
});
