# Durable Execution

`aistack` supports **crash-resumable workflows** through a SQLite-backed
checkpointer modeled after LangGraph and Temporal patterns. When enabled,
agent state is serialized after every step into the `agent_checkpoints`
table, so a workflow that crashed mid-flight can be resumed from the last
successful step instead of starting over.

Issue: [AIG-633](https://linear.app/aigensolutionsit/issue/AIG-633/m1-5-durable-execution-checkpointer-resume-after-crash).

---

## 1. Enabling checkpointing

Checkpointing is **opt-in**. Add a `checkpointing` block to `aistack.config.json`:

```json
{
  "checkpointing": {
    "enabled": true,
    "granularity": "step",
    "retentionPerSession": 50
  }
}
```

| Field                  | Type                     | Default | Description                                                                 |
| ---------------------- | ------------------------ | ------- | --------------------------------------------------------------------------- |
| `enabled`              | `boolean`                | `false` | Master switch. When `false`, all checkpoint writes are no-ops.              |
| `granularity`          | `'step' \| 'agent'`      | `'step'`| `'step'` = write after every agent step; `'agent'` = write only on completion. |
| `retentionPerSession`  | `number` (0–10000)       | `50`    | Keep only the latest N checkpoints per session. `0` disables pruning.       |

---

## 2. Schema

Migration: `migrations/004_add_checkpoints.sql`.

```sql
CREATE TABLE agent_checkpoints (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  step_id     TEXT NOT NULL,
  state_blob  TEXT NOT NULL,
  format      TEXT NOT NULL DEFAULT 'json',  -- 'json' | 'json+gzip'
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
```

Indexes on `(session_id, created_at)`, `(session_id, agent_id, created_at)`,
and `(session_id, step_id)` cover the three most common queries:
"latest checkpoint for this session", "latest for this agent", and
"specific step for replay".

State is stored as JSON. Payloads ≥ 2 KiB are gzipped + base64-encoded
(format = `json+gzip`) to keep the database small for large agent
contexts. Gzip is transparent to the API — `loadLatest()` and friends
decompress automatically.

---

## 3. API

```ts
import { getCheckpointer } from 'aistack/persistence/checkpointer';

const checkpointer = getCheckpointer(config);

// Persist state after a step.
checkpointer.save(sessionId, agentId, stepId, { progress: 0.5, items: [...] });

// Recover state on startup.
const latest = checkpointer.loadLatest(sessionId);
if (latest) {
  console.log(`Resuming from ${latest.stepId} (saved ${latest.createdAt.toISOString()})`);
  // …feed state back into the workflow
}

// Replay a specific step deterministically.
const step = checkpointer.loadByStep(sessionId, 'phase-3:implement');

// Bound storage.
checkpointer.prune(sessionId, 50);
```

For agent code, a thin helper handles the common case:

```ts
import { saveCheckpointIfEnabled } from 'aistack/persistence/checkpointer';

saveCheckpointIfEnabled(config, sessionId, agentId, stepId, state);
// No-op when checkpointing is disabled or sessionId is undefined.
// Failures are logged and swallowed — never breaks the primary workflow.
```

The agent runtime (`src/agents/spawner.ts`) already calls
`saveCheckpointIfEnabled()` after every successful `executeAgent()`
invocation, so most workflows get checkpointing for free.

---

## 4. CLI: resume after a crash

```bash
# List the latest checkpoint for a session and print its metadata.
aistack workflow resume <session-id>

# Inspect the serialized state without re-executing.
aistack workflow resume <session-id> --dry-run

# Resume from a specific step (deterministic replay).
aistack workflow resume <session-id> --from-step phase-3:implement
```

Sample output:

```
Loaded checkpoint for session 4f8e1b...
  agent:      coder
  step:       phase-3:implement
  created at: 2026-05-28T14:32:11.842Z
  format:     json+gzip

Checkpoint is now available to the workflow runtime.
Re-run the original workflow with the same session id to continue execution.
```

---

## 5. Example: crash recovery walkthrough

```ts
// 1. Start a workflow with checkpointing enabled.
const sessionId = 'demo-session';
const config = loadConfig(); // checkpointing.enabled === true

// 2. The spawner persists state after every step automatically.
await runAgent('researcher', 'gather info', config, { sessionId });
await runAgent('analyst',    'analyze data',  config, { sessionId });
// 💥 process.exit(137) — crash here

// 3. After restart, recover the latest state.
const checkpointer = getCheckpointer(config);
const last = checkpointer.loadLatest(sessionId);
if (last) {
  // Skip already-completed steps; pick up at the next one.
  console.log(`Crashed after ${last.agentId}/${last.stepId}, resuming…`);
  await runAgent('coder', 'implement based on analysis', config, { sessionId });
}
```

---

## 6. Example: deterministic replay

Useful for debugging non-deterministic failures: feed the same step's
state back through the agent and verify the output matches.

```ts
const checkpointer = getCheckpointer(config);
const original = checkpointer.loadByStep(sessionId, 'analysis-step');

// Replay with the exact same input state.
const replayedOutput = await runAgentDeterministic(
  'analyst',
  original.state.input,
  { seed: original.state.seed }
);

assert.deepEqual(replayedOutput, original.state.output);
```

Replay determinism depends on the agent itself (LLM temperature, tool
calls, etc.). The checkpointer only guarantees byte-identical state
recovery — reproducibility of the agent's response is the agent's
responsibility.

---

## 7. Operational notes

- **Storage growth**: at `retentionPerSession: 50` and ~2 KiB/checkpoint
  (gzip-compressed for large states), a busy session uses ≤ 100 KiB. The
  prune step runs best-effort after every save.
- **Concurrency**: the checkpointer reuses the main `better-sqlite3`
  handle from `MemoryManager`. WAL mode is enabled on the underlying
  database, so concurrent reads from multiple workflow processes work
  without lock contention. Writes are serialized at the SQLite level.
- **Failure mode**: `saveCheckpointIfEnabled()` swallows errors and logs
  them at `warn` level. A failing checkpoint never aborts the agent step
  that triggered it.
- **What is NOT checkpointed**: external side effects (file writes,
  network calls, MCP tool invocations) are out of scope. Treat
  checkpoints as resumable *state*, not transactional replay logs. If
  you need exactly-once side effects, layer a separate idempotency key
  on top.

---

## 8. References

- LangGraph persistence — <https://langchain-ai.github.io/langgraph/concepts/persistence/>
- Temporal workflow patterns — <https://docs.temporal.io/encyclopedia/workflows>
