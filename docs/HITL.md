# Human-In-The-Loop (HITL) Interrupts

> Status: experimental (AIG-644). Stable API surface, persistence backend
> still in-memory until the AIG-633 checkpointer is wired in.

aistack provides a LangGraph-style `interrupt()` primitive so any agent or
workflow can pause execution, surface a question (and the current state)
to a human reviewer, and resume once the reviewer supplies a value — with
optional ad-hoc edits to the captured state.

This complements the existing **consensus checkpoints** (approve / reject)
with a richer interactive pause: the reviewer can *modify* the workflow's
state and *return data* into the workflow, not just gate a decision.

## Concept

```text
  agent code ──┐
               │ await interrupt({...})
               ▼
       ┌───────────────────┐  notify    ┌──────────────────┐
       │ InterruptStore    │──────────► │ console / slack  │
       │ (status: pending) │            │ webhook sinks    │
       └────────┬──────────┘            └──────────────────┘
                │
                │ CLI / Web UI / programmatic resume
                ▼
       ┌───────────────────┐
       │ resumeInterrupt() │ — apply state edits, validate value, resolve
       └────────┬──────────┘
                │
  agent code ◄──┘ Promise resolves with the (validated) value
```

The Promise contract means HITL pauses compose with normal `async/await`
control flow — no callbacks, no state machine refactor required.

## TypeScript API

```ts
import { interrupt } from 'aistack/coordination/interrupt';

// Minimal usage
const env = await interrupt<string>({
  sessionId: ctx.sessionId,
  prompt: 'Choose deployment target',
  schema: { type: 'enum', enum: ['staging', 'production'] },
  state: { build: ctx.build },
  notify: ['console', 'slack'],
  timeoutMs: 15 * 60 * 1000, // optional
});

// With a Zod validator
import { z } from 'zod';
const port = await interrupt<number>({
  sessionId: ctx.sessionId,
  prompt: 'What port?',
  zodSchema: z.number().int().min(1024).max(65535),
});
```

### Options (`InterruptOptions`)

| Field            | Required | Notes                                                                                  |
|------------------|----------|----------------------------------------------------------------------------------------|
| `sessionId`      | yes      | Workflow/session identifier — used by `workflow inspect` and `workflow resume-interrupt`. |
| `workflowId`     | no       | Logical workflow tag (e.g. DSL workflow name).                                         |
| `prompt`         | yes      | Free-form question shown to the reviewer.                                              |
| `schema`         | no       | Lightweight descriptor (`type` + optional `enum` / `default`).                          |
| `zodSchema`      | no       | Anything exposing `safeParse(input)` — takes precedence over `schema`.                  |
| `state`          | no       | Snapshot of workflow state the reviewer can inspect (and edit on resume).               |
| `notify`         | no       | Channels to fan out the notification: `console`, `slack`, `webhook`.                    |
| `timeoutMs`      | no       | If set, `interrupt()` rejects with `InterruptTimeoutError` after this many ms.          |

### Errors

- `InterruptValidationError` — resume value failed schema/Zod validation;
  the underlying interrupt is **reopened** so the operator can retry.
- `InterruptTimeoutError`   — `timeoutMs` elapsed; the interrupt is
  marked `cancelled` and the Promise rejects.

## CLI

### `aistack workflow inspect <session-id>`

Shows the pending interrupts (or all, with `--all`) for a session,
including the captured state snapshot and schema for the expected resume
value.

```text
$ aistack workflow inspect sess-abc
Session: sess-abc
Interrupts: 1

  [PENDING] int_1c8b...
    prompt:    Choose deployment target
    workflow:  deploy
    created:   2026-05-28T07:12:01.234Z (age 4s)
    schema:    {"type":"enum","enum":["staging","production"]}
    state:
      {
        "build": { "sha": "abc1234" },
        "retries": 1
      }

    Resume with:
      aistack workflow resume-interrupt sess-abc --interrupt-id int_1c8b... --input='<json>'
    Or edit state first:
      aistack workflow resume-interrupt sess-abc --interrupt-id int_1c8b... --edit-state='path.to.field=value' --input='<json>'
```

Use `--json` for a machine-readable dump (suitable for piping to `jq`).

### `aistack workflow resume-interrupt <session-id>`

Resumes the latest pending interrupt for a session, or a specific one
with `--interrupt-id`. `--input` carries the JSON-encoded value to feed
back into the awaiting `interrupt()` Promise; `--edit-state` (repeatable)
applies ad-hoc state mutations *before* the Promise resolves.

```bash
# Simple resume
aistack workflow resume-interrupt sess-abc --input='"staging"'

# Bump a retry counter and then resume
aistack workflow resume-interrupt sess-abc \
  --edit-state='retries=5' \
  --edit-state='config.featureFlag=true' \
  --input='"production"'
```

State edits use a tiny `path=value` syntax (dot notation, optional `$.`
prefix). Values are JSON-parsed when possible, falling back to strings.

## Web UI

The dashboard exposes `/interrupts` listing all pending interrupts with
inline state preview, schema hints, a JSON input field, a multi-line
state-edit textarea, and a read-only state snapshot panel. Clicking
**Review &amp; Resume** automatically calls `claim` on the record so other
operators can see someone is working on it.

## REST API

| Method | Path                                  | Description                                      |
|--------|---------------------------------------|--------------------------------------------------|
| GET    | `/api/v1/interrupts`                  | List (`?status=`, `?sessionId=`).                |
| GET    | `/api/v1/interrupts/:id`              | One record.                                      |
| POST   | `/api/v1/interrupts/:id/claim`        | Mark as claimed (sets `claimedAt`).              |
| POST   | `/api/v1/interrupts/:id/resume`       | Body: `{ input, stateEdits }`.                   |
| POST   | `/api/v1/interrupts/:id/cancel`       | Body: `{ reason }`.                              |

## Persistence

The store is in-memory by default. Hosts that have the AIG-633 durable
checkpointer can plug it in:

```ts
import { setInterruptPersistence, getInterruptStore } from 'aistack/coordination/interrupt';

setInterruptPersistence({
  async save(record) { await checkpointer.save({ sessionId: record.sessionId, stepId: 'interrupt', payload: record }); },
  async loadAll()    { /* hydrate from checkpointer */ return []; },
  async delete(id)   { /* no-op for append-only stores */ },
});
await getInterruptStore().hydrate();
```

After hydration, interrupts pending at the time of a crash are resumable
via the CLI / web UI without losing operator-visible state.

## Design notes

- **Promise-based, not callback.** Keeps the workflow code linear and
  diff-friendly. The cost is one in-process emitter + a tiny polling
  fallback to cover cross-process resumes.
- **State edit via dot-path, not full state replacement.** Cheaper to
  audit (each edit is a single key/value), composes well with the CLI
  (`--edit-state` repeatable), and avoids accidental large overwrites.
- **Fan-out notifier.** Sinks are pluggable so PagerDuty / Discord / email
  can be added without touching the core store.

## References

- LangGraph HITL: https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/
- Temporal signals: https://docs.temporal.io/encyclopedia/application-message-passing#signals
