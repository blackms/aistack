# aistack on SWE-bench Verified

> **Status:** SETUP / PLAN — no run executed yet. See [docs/BENCHMARK.md](../../docs/BENCHMARK.md) for full plan.

This directory contains the reproducible benchmark harness for evaluating aistack's
adversarial review loop on the [SWE-bench Verified](https://www.swebench.com/) subset
(500 human-validated tasks from real GitHub issues).

## Why a public benchmark

Competing agentic frameworks publish SWE-bench numbers (claude-flow/Ruflo claim 84.8%,
Devin and Factory report public scores). aistack currently has none, which makes it
hard for adopters to compare. This harness produces a **defensible, reproducible
score** that anyone can re-run end-to-end.

## Hypothesis (testable)

> **H1:** Running aistack's adversarial review loop (coder + adversarial agents,
> max 3 iterations) on SWE-bench Verified yields a pass rate **15-30 percentage
> points higher** than a single-shot Claude Sonnet 4.6 baseline on the same task
> set, at a token cost increase of at most 4x.

A null result (improvement < 5pp, or cost overhead > 6x with < 10pp gain) would
indicate the loop should be reworked or scoped to specific task categories before
being marketed as a quality lever.

## Quick start (when execution is in scope)

```bash
# 1. Configure secrets (create benchmarks/swe-bench/.env with at minimum)
#   ANTHROPIC_API_KEY=sk-ant-...
#   AISTACK_MODEL_SNAPSHOT=claude-sonnet-4-5-20250514
#   HF_TOKEN=hf_...    # optional, raises HuggingFace rate limits

# 2. Build the pinned evaluation image
./scripts/run-local.sh build

# 3. Run baseline (Sonnet 4.6, single shot)
./scripts/run-local.sh baseline --limit 10        # smoke test
./scripts/run-local.sh baseline                   # full 500-task run

# 4. Run aistack adversarial loop
./scripts/run-local.sh aistack --limit 10         # smoke test
./scripts/run-local.sh aistack                    # full 500-task run

# 5. Aggregate and compare
./scripts/run-local.sh aggregate
# -> results/SUMMARY.md
```

## Files

| Path | Purpose |
|------|---------|
| `Dockerfile` | Pinned env with Python 3.11, Node 20, SWE-bench harness, Docker-in-Docker for per-task containers |
| `run.ts` | aistack runner: enumerates Verified tasks, spawns adversarial review loop per task, emits patch |
| `baseline.ts` | Baseline runner: same task set, single Claude Sonnet 4.6 call, no aistack |
| `aggregate.ts` | Reads `results/*.json`, computes pass rate, breakdown by repo/category, writes `SUMMARY.md` |
| `scripts/run-local.sh` | Convenience wrapper around `docker build && docker run` |
| `results/` | Per-task JSON outputs + aggregate summary (gitignored except `.gitkeep` + example) |
| `results/EXAMPLE_OUTPUT.json` | Schema reference for a single task result |

## Reproducibility guarantees

- **Pinned base image** — `python:3.11.9-slim-bookworm` + `swebench==2.1.4` (latest as of plan)
- **Pinned model snapshot** — `claude-sonnet-4-5-20250514` (or whichever snapshot is the
  marketed baseline at run time; recorded in every result JSON)
- **Frozen task list** — `princeton-nlp/SWE-bench_Verified` HuggingFace dataset, revision
  pinned in `run.ts` via `dataset_revision`
- **Recorded versions** — Every result JSON includes `aistack_version`, `model_snapshot`,
  `swebench_harness_version`, `dataset_revision`, `started_at`, `finished_at`
- **No network egress during patch eval** — the swebench harness runs each repo in an
  isolated container; only the LLM call hits the network

## Cost guard rails

The `--limit N` flag exists so anyone can validate the pipeline on 5-10 tasks
(~$2-5) before committing to the full ~$150-250 budget. See
[docs/BENCHMARK.md](../../docs/BENCHMARK.md#cost-estimate) for breakdown.

## Current results

**Pending first run — ETA Q3 2026.** See [docs/BENCHMARK.md](../../docs/BENCHMARK.md#current-results) for the placeholder table and the `NEEDS-HUMAN-DECISION` items that gate execution.
