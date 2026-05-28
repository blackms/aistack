# Workflow DSL

Declarative YAML/JSON syntax for orchestrating multi-agent workflows in aistack.

Inspired by Microsoft Agent Framework's YAML agents and LangGraph's graph DSL, the aistack DSL trades the full expressiveness of imperative TypeScript orchestration for:

- **Versionability** — workflows live in git, diff cleanly, and travel between projects.
- **Hot-reload** — edit a `.yaml` file and re-run without restarting any daemon.
- **Shareability** — drop a YAML file in `templates/workflows/` and anyone can run it.
- **No-rebuild iteration** — non-engineers can author and tweak workflows.

The DSL is **complementary** to the existing imperative APIs (e.g. `createReviewLoop` in `src/coordination/review-loop.ts`); the TS path remains the source of truth for production-critical loops, while the DSL is the recommended entry point for new workflows and templates.

---

## Quick start

```bash
aistack workflow run templates/workflows/adversarial-review.yaml \
  --input='{"input": "Write a TypeScript function that validates email addresses"}'
```

Add `--watch` to re-run on every file save:

```bash
aistack workflow run my-flow.yaml --watch --input='{"input":"..."}'
```

---

## Document schema

A workflow document is a YAML or JSON object with the following shape:

```yaml
name: my-workflow                # required, kebab-case recommended
description: One-line summary    # optional
version: "1"                     # optional, defaults to "1"
max_iterations: 30               # optional global safety cap on total step executions
defaults:
  timeout_ms: 60000              # optional, per-step default
  session_id: my-session         # optional, propagated to agent spawner
steps:                           # required, at least one
  - id: step-id                  # optional, alphanumeric / _ / -
    agent: coder                 # required (XOR with `parallel`)
    name: Friendly label         # optional, used in logs
    input: "..."                 # string or object — see "Variable resolution"
    if: "$task.opt_in == yes"    # optional gate, see "Conditionals"
    on_reject:                   # optional, triggered on verdict=REJECT
      goto: step-id              # step id or 0-based index
      max_retries: 3             # default 3
      fail_after: true           # surface error once retries exhausted
    on_error:                    # optional, triggered on thrown exception
      goto: step-id
      max_retries: 1
      fail_after: true
    timeout_ms: 30000            # optional override
  - id: fan-out                  # OR — parallel block (no `agent`)
    parallel:
      - agent: researcher
        input: source A
      - agent: researcher
        input: source B
```

Validation is performed by [zod](https://zod.dev/) in `src/workflows/dsl/schema.ts`; errors include a path-qualified summary like:

```
Workflow validation failed:
  - steps.1.on_reject.max_retries: Number must be less than or equal to 20
```

---

## Variable resolution

Variable references are `$`-prefixed and resolved per-string at execution time. The full grammar:

| Reference                    | Resolves to                                                        |
|------------------------------|--------------------------------------------------------------------|
| `$task.input`                | The `input` field of the top-level task context                    |
| `$task.<field>`              | An arbitrary field from the task context (JSON-stringified if not a string) |
| `$prev.output`               | The `output` of the previously executed step                       |
| `$prev.<field>`              | An arbitrary field from the previous StepResult                    |
| `$steps.<id>.output`         | The `output` of a previously executed step by id                   |
| `$steps.<id>.<field>`        | An arbitrary field from a previous StepResult by id                |

Strings without a leading `$` are treated as literals. Object inputs are deep-resolved (leaf strings interpolated) then JSON-serialized before being passed to the agent.

### Examples

```yaml
input: "Original task: $task.input\nPrevious result: $prev.output"
```

```yaml
input:
  task: $task.input
  prior_findings: $steps.research.output
```

---

## Control flow

### `on_reject` — verdict-driven retry

Triggered when a step's runtime result includes `verdict: REJECT` (case-insensitive). The default `runStep` (CLI bridge in `src/cli/commands/workflow-dsl-runner.ts`) extracts the verdict by matching `**VERDICT: APPROVE|REJECT**` in the agent's response — the same convention used by `src/coordination/review-loop.ts`.

```yaml
- id: review
  agent: adversarial
  input: "Review: $steps.code.output"
  on_reject:
    goto: code          # jump back to step id `code`
    max_retries: 3      # at most 3 jump-backs
    fail_after: true    # if exhausted, terminate with error
```

### `on_error` — exception-driven retry

Triggered when the underlying `runStep` hook throws. Same shape as `on_reject` but `fail_after` defaults to `true`.

### `if` — conditional skip

A boolean expression evaluated against resolved variables. Supported operators:

- `$ref == literal`
- `$ref != literal`
- `$ref contains literal`
- `$ref exists` — truthy if the resolved value is non-empty

A skipped step is recorded in `history` with `skipped: true` and does **not** become `$prev`.

### `parallel`

A step may declare `parallel: [...]` instead of `agent`. Children execute concurrently via `Promise.all`; their outputs are joined with `\n---\n` in the parent's `output`, and the individual `StepResult`s are preserved in `parallelResults`.

### `max_iterations` — global safety net

Caps total step executions (including loop-back retries) across the entire workflow. Defaults to `steps.length * 10`.

---

## Hot-reload

`aistack workflow run <file> --watch` uses native `fs.watch` with a 200ms debounce. On every change the file is re-parsed (parse errors are logged but don't tear down the watcher), then the workflow is re-executed with the same `--input` payload.

If the executor is mid-run when a change arrives, the new run is queued and starts as soon as the current run finishes.

Programmatic use:

```ts
import { watchWorkflowFile } from '@blackms/aistack/workflows/dsl';

const handle = await watchWorkflowFile('./flow.yaml', async (doc) => {
  console.log('Reloaded', doc.name);
});

// later...
handle.close();
```

---

## CLI reference

```
aistack workflow run <workflow>          run a named workflow OR a DSL file
  --input <json>                         task input as JSON string (DSL mode)
  --watch                                hot-reload on file change (DSL mode)
  -v, --verbose                          verbose output

aistack workflow list                    list named workflows
aistack workflow triggers --list         list hook triggers
aistack workflow reset                   reset runner state
```

The `run` subcommand routes to the DSL executor when its argument ends in `.yaml`, `.yml`, `.json`, or points to an existing file. Otherwise it falls through to the legacy named-workflow runner.

---

## Programmatic API

```ts
import {
  parseWorkflow,
  runWorkflow,
  WorkflowContext,
  type RunStepHook,
} from '@blackms/aistack/workflows/dsl';

const runStep: RunStepHook = async ({ agent, input }) => {
  // spawn / dispatch — return { output, verdict? }
  return { output: '...', verdict: 'APPROVE' };
};

const doc = await parseWorkflow(await fs.readFile('flow.yaml', 'utf-8'));
const ctx = new WorkflowContext({ task: { input: 'do it' }, runStep });

for await (const result of runWorkflow(doc, ctx)) {
  console.log(result.id, result.output);
}
```

---

## Comparison with the imperative review loop

`src/coordination/review-loop.ts` encodes the coder → adversarial → maybe-loop pattern in ~420 lines of TypeScript with first-class persistence to the memory store, EventEmitter-based progress, and semaphore-limited concurrency. The equivalent DSL workflow (`templates/workflows/adversarial-review.yaml`) is ~40 lines of YAML.

The DSL is strictly less expressive — there is no hand-rolled regex parsing of issue severity, no review history persistence, no per-iteration event payload customization. For most templating use cases that's a feature: the YAML is a hot-reloadable, shareable artifact that any engineer can read in seconds. For mission-critical review loops with bespoke instrumentation, the imperative coordinator is still the right tool.

The two share the same `**VERDICT: APPROVE|REJECT**` contract for review outcomes, so an agent written to be reviewed by `ReviewLoopCoordinator` works inside a DSL workflow without modification.

---

## Troubleshooting

**`YAML parser not available`** — install the optional dep with `npm install yaml`, or use a JSON workflow.

**`Workflow validation failed: ...on_reject.goto: Required`** — every `on_reject` clause needs a `goto`.

**Step input shows `[object Object]`** — you passed an object input; the executor JSON-stringifies it. Wrap with a templated string if you want raw substitution.

**`Exceeded max_iterations`** — your loop runs too long; raise `max_iterations` at the workflow root or tighten `on_reject.max_retries`.

**Variable references show as empty strings** — check the reference path with the `--verbose` flag; unknown references resolve to empty strings (non-fatal).
