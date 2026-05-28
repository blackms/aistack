# Rubric Grading (Outcomes-style)

aistack ships two complementary review patterns:

| Pattern | Verdict | Use when |
|---|---|---|
| **Adversarial review loop** (`adversarial` agent) | binary APPROVE / REJECT, attack-vector framing | You want a hostile reviewer that tries to break the code. Good for catching security holes and correctness bugs. |
| **Rubric grading** (`grader` agent, this doc) | weighted 0..1 per criterion + PASS/FAIL | You have measurable success criteria (correctness, security, docs, tests…) and want graded adherence rather than a hostile take. Parallel to Anthropic's 2026 Outcomes feature. |

Both run inside `createReviewLoop`; rubric grading is opt-in via the `rubric` option.

## Quick start

```ts
import { createReviewLoop } from '@blackms/aistack';
import { readFileSync } from 'node:fs';

const rubricYaml = readFileSync('templates/rubrics/code-quality.yaml', 'utf8');

const state = await createReviewLoop(
  'Implement a thread-safe ring buffer in TypeScript with capacity 32.',
  config,
  { rubric: rubricYaml, maxIterations: 3 }
);

console.log(state.finalVerdict); // 'APPROVE' if rubric PASS, 'REJECT' otherwise
console.log(state.reviews.at(-1)?.summary); // human-readable per-criterion report
```

You can also pass an already-parsed object or a JSON string:

```ts
await createReviewLoop(input, config, {
  rubric: {
    name: 'inline',
    rubric: [
      { criterion: 'correctness', weight: 0.6, pass_threshold: 0.8 },
      { criterion: 'tests', weight: 0.4, pass_threshold: 0.7 },
    ],
  },
});
```

## Rubric schema

```yaml
version: 1                  # forward-compat schema version (default 1)
name: my-rubric             # required, short slug
description: optional       # surfaced in reports
overall_threshold: 0.8      # weighted-average pass cutoff (default 0.8)
max_iterations: 3           # max coder->grader iterations (default 3)

rubric:                     # >= 1 criterion
  - criterion: correctness  # required, slug-ish identifier
    description: optional   # shown to grader; falls back to criterion name
    weight: 0.4             # default 1.0; absolute (0.4) or relative (4) — engine normalises
    pass_threshold: 0.8     # optional; if set, this criterion's score must be >= it
    checks:                 # optional; specific checks surfaced verbatim to the grader
      - All requirement bullet points are addressed
      - Edge cases handled
```

A rubric **PASSES** when:

1. The weighted-average overall score is `>= overall_threshold`, AND
2. Every criterion that declares a `pass_threshold` meets it.

## Authoring guidelines

- **Keep criteria orthogonal.** Overlapping criteria double-count gaps and skew the weighted average. `correctness` + `tests` are fine; `correctness` + `code quality` overlap heavily.
- **Use 3–6 criteria.** Fewer than 3 collapses into a single judgement; more than 6 dilutes weights and is slow (one grader spawn per criterion).
- **Set `pass_threshold` only where you mean it.** Without one, a criterion is "informational" — it contributes to the weighted average but cannot single-handedly fail the rubric.
- **Use `checks:` to anchor the grader.** Models score more consistently when you spell out 2–4 concrete checks per criterion.
- **Weight by importance, not effort.** Security gets weight=0.3 because security issues are expensive, not because the security check is hard.

## Outcomes vs Adversarial — decision matrix

| Situation | Pick |
|---|---|
| Untrusted code touching auth/secrets/network | **Adversarial** (find holes) + Rubric (`security-audit.yaml`) chained |
| Implementing a spec with measurable acceptance criteria | **Rubric** |
| Refactor where "does it still work" is the question | **Adversarial** |
| Generating documentation, copy, design docs | **Rubric** (correctness is rarely binary) |
| CI gate that must produce a numeric score | **Rubric** |
| One-off review of a PR by a stricter reviewer | **Adversarial** |
| You want both attack-surface coverage and adherence scoring | **Both** — run rubric first, then adversarial on the approved output |

## Provided templates

- `templates/rubrics/code-quality.yaml` — general purpose (correctness / style / tests / docs)
- `templates/rubrics/security-audit.yaml` — high-stakes review (input-validation / auth / secrets / OWASP / error-handling)

## Programmatic API

```ts
import {
  parseRubric,
  gradeOutput,
  computeOverallScore,
  computePassed,
  buildFixPrompt,
} from '@blackms/aistack';

// Lower-level: grade once without the review loop
const rubric = parseRubric(yamlString);
const result = await gradeOutput(rubric, candidateOutput, config, {
  requirements: 'original task description',
});

if (!result.passed) {
  const fixPrompt = buildFixPrompt(result, candidateOutput, 'original requirements');
  // hand to your own coder/fix loop
}
```

### `RubricResult` shape

```ts
{
  rubricName: string,
  scores: Array<{
    criterion: string,
    score: number,          // 0..1
    justification: string,
    passed: boolean,        // met its own pass_threshold (or true if none)
    weight: number,
  }>,
  overallScore: number,     // normalised weighted average
  passed: boolean,          // overallScore >= overall_threshold AND every criterion.passed
  summary: string,          // markdown report
  timestamp: Date,
}
```

## Design notes

**Per-criterion spawning.** The grader is invoked once per criterion rather than once for the whole rubric. This keeps each grader's attention window narrow and reduces the "average the vibes" failure mode where a single agent gives every criterion the same score. Cost: N grader calls per iteration instead of 1.

**Opt-in integration with the review loop.** `createReviewLoop` routes to the rubric loop only when the caller passes `rubric:`. The existing adversarial coordinator is untouched. This keeps the binary REJECT/APPROVE contract stable for all current callers.

**Score parsing tolerance.** The grader prompt requests a strict JSON payload, but the parser also accepts bare JSON, fenced blocks, and regex-extractable `score: 0.7` prose. Unparseable responses default to `score=0` with a justification flagging the parse failure — better to surface a fail than silently average around it.

**YAML subset.** This module ships its own small YAML reader (2-space-indented block mappings + sequences + flow arrays + comments) to avoid coupling to the workflow DSL's `yaml` dependency. Complex YAML inputs can be pre-parsed and handed to `parseRubric` as objects.
