#!/usr/bin/env tsx
/**
 * SWE-bench Verified runner for aistack (adversarial review loop).
 *
 * For each task in princeton-nlp/SWE-bench_Verified:
 *   1. Materialize the repo at the buggy commit
 *   2. Spawn an aistack adversarial review loop (coder + adversarial, maxIterations=3)
 *      with the issue text as input
 *   3. Capture the generated patch
 *   4. Hand the patch to the SWE-bench harness for test evaluation
 *   5. Emit a per-task JSON to results/aistack/{task_id}.json
 *
 * STUB STATUS: this file documents the intended shape. The aistack-side glue
 * (`buildPromptFromTask`, `extractPatch`) is sketched; the actual SWE-bench
 * harness invocation lives in `scripts/entrypoint.sh` which calls the
 * official `python -m swebench.harness.run_evaluation` after we've written
 * predictions.
 *
 * Invocation (inside container):
 *   tsx benchmarks/swe-bench/run.ts --limit 10 --out /work/results/aistack
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, env, exit } from 'node:process';

// NOTE: these imports rely on aistack being built in the container.
// We import from the built dist via the package name so the runner can
// also be `npm link`-ed for local dev outside Docker.
// @ts-expect-error -- module exists at runtime once aistack is built/installed
import { createReviewLoop, getConfig } from '@blackms/aistack';

interface SweBenchTask {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  test_patch: string;
  patch: string; // gold patch (kept only for debugging, never shown to the model)
  version: string;
}

interface AistackResult {
  task_id: string;
  status: 'completed' | 'error' | 'timeout';
  passed: boolean | null; // null until swebench harness scores it
  iterations: number;
  patch: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number;
  model_snapshot: string;
  aistack_version: string;
  swebench_harness_version: string;
  dataset_revision: string;
  git_sha: string;
  started_at: string;
  finished_at: string;
  error?: string;
}

function parseArgs(): { limit?: number; out: string; tasksFile: string } {
  const args = argv.slice(2);
  let limit: number | undefined;
  let out = '/work/results/aistack';
  let tasksFile = '/work/results/_tasks.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') limit = Number(args[++i]);
    else if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--tasks') tasksFile = args[i + 1] ?? tasksFile, i++;
  }
  return { limit, out, tasksFile };
}

function buildPromptFromTask(task: SweBenchTask): string {
  // The adversarial loop expects a self-contained task description.
  // We deliberately do NOT include `task.patch` (gold) or `task.test_patch`
  // (test changes) — those would be cheating.
  return [
    `Repository: ${task.repo} @ ${task.base_commit}`,
    '',
    'Issue:',
    task.problem_statement,
    '',
    task.hints_text ? `Hints:\n${task.hints_text}\n` : '',
    'Produce a unified diff (git format) that fixes the issue. Output ONLY the diff inside a ```diff fenced block.',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractPatch(loopOutput: string): string | null {
  // Look for ```diff ... ``` first, fall back to any ```...``` containing 'diff --git'
  const fenced = loopOutput.match(/```diff\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const generic = loopOutput.match(/```[a-z]*\s*\n([\s\S]*?)```/);
  if (generic && generic[1].includes('diff --git')) return generic[1].trim();
  if (loopOutput.includes('diff --git')) return loopOutput.trim();
  return null;
}

async function runOne(task: SweBenchTask): Promise<AistackResult> {
  const startedAt = new Date();
  const result: AistackResult = {
    task_id: task.instance_id,
    status: 'completed',
    passed: null,
    iterations: 0,
    patch: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    duration_ms: 0,
    model_snapshot: env.AISTACK_MODEL_SNAPSHOT ?? 'claude-sonnet-4-5-20250514',
    aistack_version: env.npm_package_version ?? 'unknown',
    swebench_harness_version: env.SWEBENCH_VERSION ?? 'unknown',
    dataset_revision: env.DATASET_REVISION ?? 'main',
    git_sha: env.AISTACK_GIT_SHA ?? 'unknown',
    started_at: startedAt.toISOString(),
    finished_at: '',
  };

  try {
    const prompt = buildPromptFromTask(task);
    const loop = await createReviewLoop(prompt, getConfig(), { maxIterations: 3 });
    result.iterations = loop.reviews?.length ?? 0;
    result.patch = extractPatch(loop.currentCode ?? '');
    // Token / cost accounting is the responsibility of the LLM provider layer;
    // when the provider attaches usage we propagate it. Default to 0 so the
    // schema is stable even when usage tracking is off.
    result.tokens_in = loop.totalTokensIn ?? 0;
    result.tokens_out = loop.totalTokensOut ?? 0;
    result.cost_usd = loop.estimatedCostUsd ?? 0;
  } catch (err) {
    result.status = 'error';
    result.error = err instanceof Error ? err.message : String(err);
  }

  const finished = new Date();
  result.finished_at = finished.toISOString();
  result.duration_ms = finished.getTime() - startedAt.getTime();
  return result;
}

async function loadTasks(tasksFile: string, limit?: number): Promise<SweBenchTask[]> {
  // The Python entrypoint pre-downloads the HF dataset and writes it as JSON
  // to avoid pulling huggingface_hub into the Node runtime.
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(tasksFile, 'utf8');
  const tasks: SweBenchTask[] = JSON.parse(raw);
  return limit ? tasks.slice(0, limit) : tasks;
}

async function main(): Promise<void> {
  const { limit, out, tasksFile } = parseArgs();
  await mkdir(out, { recursive: true });

  const tasks = await loadTasks(tasksFile, limit);
  console.log(`[aistack-run] processing ${tasks.length} tasks -> ${out}`);

  let i = 0;
  for (const task of tasks) {
    i++;
    console.log(`[aistack-run] (${i}/${tasks.length}) ${task.instance_id}`);
    const result = await runOne(task);
    await writeFile(join(out, `${task.instance_id}.json`), JSON.stringify(result, null, 2));
  }

  console.log('[aistack-run] done');
}

main().catch((err) => {
  console.error('[aistack-run] fatal:', err);
  exit(1);
});
