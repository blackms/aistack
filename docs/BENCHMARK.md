# aistack Benchmark — SWE-bench Verified

> **Status:** plan / harness only. No benchmark has been executed yet. The
> harness lives in [`benchmarks/swe-bench/`](../benchmarks/swe-bench/) and is
> reproducible end-to-end by anyone with Docker and an Anthropic API key.

## 1. Overview

[SWE-bench Verified](https://www.swebench.com/) is a 500-task subset of
SWE-bench, hand-validated by the SWE-bench team to remove ambiguous /
unsolvable instances. Each task is a real GitHub issue from a popular Python
project (Django, sympy, sklearn, etc.); the agent under test must produce a
unified diff that, when applied to the repo at the specified base commit,
causes the maintainer-written hidden tests to pass.

It is currently the de-facto industry benchmark for agentic coding systems —
claude-flow / Ruflo, Devin, Factory, and others all publish scores against it.
aistack publishing one closes the credibility gap MKT-30 was filed to address.

## 2. Hypothesis

> **H1.** aistack's adversarial review loop (coder + adversarial agents,
> `maxIterations: 3`) achieves a SWE-bench Verified pass rate **at least
> 15 percentage points higher** than the same model called single-shot, at a
> total token cost increase of **at most 4x**.

**Falsification.** If delta < +5pp, or cost ratio > 6x while delta < +10pp,
the loop should be revisited (or scoped to a subset of repos) before being
positioned as a quality lever. We will publish the result either way.

## 3. Methodology

### Comparable runners

| Runner | What it does | Same model | Same task list | Same env |
|---|---|---|---|---|
| `baseline` | Single Claude Sonnet 4.6 call per task, no retries | yes | yes | yes |
| `aistack` | `createReviewLoop()` with adversarial agent, max 3 iterations | yes | yes | yes |

Both runners share `results/_tasks.json` (a one-time dump of
`princeton-nlp/SWE-bench_Verified` test split), so neither can drift onto an
easier subset.

### Evaluation

Patches are scored by the official
[`swebench.harness.run_evaluation`](https://github.com/princeton-nlp/SWE-bench)
(pinned to `2.1.4`), which spins a fresh container per task and runs the
maintainer-written hidden tests. We **never** show the model `test_patch` or
the gold `patch` — only `problem_statement` and optional `hints_text`.

### Reproducibility

- Pinned Dockerfile (`python:3.11.9-slim-bookworm`, `swebench==2.1.4`,
  `node:20.18.0`)
- Pinned model snapshot (recorded in every result JSON)
- Pinned dataset revision (recorded in every result JSON)
- Every result JSON also stamps `aistack_version` and `git_sha`

A third party should be able to clone the repo, `./scripts/run-local.sh
build && ./scripts/run-local.sh baseline && ./scripts/run-local.sh aistack`,
and land within statistical noise of our published numbers.

## 4. Setup

### Prerequisites

- Docker 24+ with the daemon running
- ~30 GB free disk (per-task containers cache repo states)
- Anthropic API key with at least $300 spending headroom

### Configure

```bash
cd benchmarks/swe-bench
cp .env.example .env
# Edit .env -> set ANTHROPIC_API_KEY
```

### Build

```bash
./scripts/run-local.sh build
```

This builds `aistack-swebench:latest` (Python 3.11.9 + Node 20 + SWE-bench
2.1.4 + the current aistack source).

## 5. Run

### Smoke test (10 tasks, ~$5)

```bash
./scripts/run-local.sh baseline --limit 10
./scripts/run-local.sh aistack  --limit 10
./scripts/run-local.sh aggregate
# -> benchmarks/swe-bench/results/SUMMARY.md
```

### Full run (500 tasks)

```bash
./scripts/run-local.sh baseline    # ~$40-60, 2-4 h
./scripts/run-local.sh aistack     # ~$120-180, 4-8 h
./scripts/run-local.sh aggregate   # seconds
```

Each runner is resumable — already-scored tasks (present as JSONs in
`results/<runner>/`) are skipped on a re-run, so transient API errors don't
force a full restart.

## 6. Cost estimate

Assumes Claude Sonnet 4.6 list price ($3 / Mtok input, $15 / Mtok output) and
the median SWE-bench task fitting in 15k input / 2k output tokens.

| Component | Baseline (500) | aistack loop (500) | Notes |
|---|---:|---:|---|
| Claude API — input | ~$22.50 | ~$67.50 | aistack does ~3x prompts (coder, adversarial, fix) |
| Claude API — output | ~$15.00 | ~$60.00 | adversarial review adds bulk |
| HuggingFace egress | $0 | $0 | gated dataset, free with `HF_TOKEN` |
| Docker compute (laptop) | $0 | $0 | runs locally; CI runner adds GitHub minutes |
| **Subtotal API** | **~$40** | **~$130** | |
| Buffer for retries / oversized issues (1.5x) | ~$60 | ~$200 | |
| **Total budget** | **~$60** | **~$200** | $260 combined |

**Compute.** GPU rent is **not** required — SWE-bench evaluation only runs
the project's own test suite per task (CPU-bound). A 16 GB / 8-core machine
finishes the full run overnight.

## 7. Results schema

Every per-task JSON conforms to the shape in
[`benchmarks/swe-bench/results/EXAMPLE_OUTPUT.json`](../benchmarks/swe-bench/results/EXAMPLE_OUTPUT.json):

| Field | Type | Meaning |
|---|---|---|
| `task_id` | string | SWE-bench `instance_id` (e.g. `astropy__astropy-12907`) |
| `runner` | `"baseline"` \| `"aistack"` | which runner produced this |
| `status` | `"completed"` \| `"error"` \| `"timeout"` | runner-side status |
| `passed` | bool \| null | filled by `aggregate.ts` after harness scoring |
| `iterations` | int | 1 for baseline; 1-3 for aistack |
| `patch` | string \| null | unified diff produced |
| `tokens_in` / `tokens_out` | int | from provider usage |
| `cost_usd` | number | computed at runner time at list price |
| `duration_ms` | int | wall time |
| `model_snapshot` | string | exact snapshot id used |
| `aistack_version`, `git_sha`, `swebench_harness_version`, `dataset_revision` | string | provenance |

The aggregate output (`results/SUMMARY.md`) joins these with the SWE-bench
harness `report.json` (`{instance_id: {resolved: bool}}`) to compute pass
rates and the H1 verdict.

## 8. Current results

> **TODO: Pending first run — ETA Q3 2026.** See open `NEEDS-HUMAN-DECISION`
> items below.

| Runner | Tasks | Pass rate | Total cost | Notes |
|---|---:|---:|---:|---|
| baseline (Sonnet 4.6, single shot) | TBD / 500 | TBD | TBD | |
| aistack (adversarial loop, max 3) | TBD / 500 | TBD | TBD | |
| **Delta** | — | **TBD pp** | **TBD x cost** | H1 verdict: TBD |

### Reference scores (public, for context)

These are reported by the respective vendors on their own infra; cited here
only as orientation, not as direct apples-to-apples comparisons.

| System | SWE-bench (subset) | Source |
|---|---:|---|
| Devin | ~13.9% (full) | Cognition launch post |
| claude-flow / Ruflo | claimed 84.8% (Verified) | project README |
| Claude 3.5 Sonnet (single-agent, Anthropic) | ~49% (Verified) | Anthropic blog |
| Claude Sonnet 4 (Anthropic) | ~72-77% (Verified) | Anthropic system card |

A baseline run with the **same** prompt template, **same** dataset revision,
and **same** model snapshot we use is the only number that lets us claim a
real delta from the aistack loop.

## 9. Baseline comparison methodology

To call the delta defensible we commit to:

1. **Identical task list.** Both runners read `results/_tasks.json` — the
   same dump of the same dataset revision.
2. **Identical model snapshot.** `AISTACK_MODEL_SNAPSHOT` is an env var,
   read by both runners, recorded in every JSON.
3. **Identical prompt template** for the first turn. The aistack loop adds
   adversarial review turns; the baseline stops after turn 1. Both turn-1
   prompts come from a shared `buildPrompt()` (see `baseline.ts` and
   `run.ts`).
4. **No retries on failure** for baseline. An HTTP error is a `status:
   "error"` result, scored as `passed: false`. Same rule for aistack — we
   do not retry the loop on transport errors.
5. **No cherry-picking.** We publish every task result, including the
   error ones, in the per-task JSONs.

## 10. Open `NEEDS-HUMAN-DECISION`

- **Who executes the first real run?** Options: (a) one-time human run on a
  workstation, (b) a dedicated GitHub Actions workflow with a manual
  `workflow_dispatch` trigger, (c) a one-off rented cloud VM. (a) is fastest;
  (b) is most reproducible long-term.
- **Where to publish results?** Options: (a) a section in the main `README.md`
  with a badge linking here, (b) a dedicated `aistack.dev/benchmarks` page,
  (c) a separate `aistack/swe-bench-runs` repo (the original AC suggestion)
  with one tagged release per run. (c) gives the cleanest provenance trail
  but is more setup.
- **Cost cap policy.** Do we cap at $300/run and skip remaining tasks if
  exceeded, or run to completion? The current `--limit` flag supports the
  former trivially.
