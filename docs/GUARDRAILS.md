# Guardrails Framework

> Status: Engine landed in AIG-645 (M2-17). **Wired into the review loop +
> exposed as a Claude Code `PreToolUse` hook in AIG-868** — see
> "[Review-loop gate (AIG-868)](#review-loop-gate-aig-868)" and
> "[Using guardrails as a Claude Code `PreToolUse` hook](#using-guardrails-as-a-claude-code-pretooluse-hook)".

## Concept

Guardrails are **pluggable input/output validators** that run in *parallel*
to agent execution. They are aistack's **cheap first-line defense**:
regex / schema validation that fails fast and adds negligible latency,
complementary to the heavier adversarial review loop.

### Guardrails vs adversarial review

| Aspect          | Guardrails                          | Adversarial loop                     |
|-----------------|-------------------------------------|--------------------------------------|
| When            | Pre-/post- agent call, in parallel  | Post-hoc, sequential                 |
| What            | Deterministic patterns & schemas    | LLM semantic critique                |
| Latency         | ~1ms (regex) – ~10ms (zod)          | Seconds (full LLM round-trip)        |
| Cost            | ~0                                  | Tokens × iterations                  |
| Blocks?         | YES (`{ pass: false }` ⇒ throw)     | Yes, via iteration limit             |
| False positives | Higher (narrow regex, still noisy)  | Lower                                |
| False negatives | High (trivially bypassed)           | Lower                                |

Use BOTH. Guardrails catch the obvious; adversarial catches the subtle.

## Built-in guardrails

| Name               | Direction | Detects                                                     |
|--------------------|-----------|-------------------------------------------------------------|
| `secrets`          | both      | AWS / GitHub / OpenAI / Anthropic / Slack / Google / Stripe keys, PEM private keys |
| `pii`              | both      | Email, US SSN, IT codice fiscale, credit card (LUHN), IPv4 (opt-in) |
| `prompt-injection` | input     | "ignore previous", DAN, role spoofing, XML smuggling, dev-mode |
| `zod-schema`       | output\*  | Arbitrary zod schema (factory — pass your schema)           |

\* `zodSchemaGuardrail(schema)` is a *factory* (needs a schema), so it
is not auto-registered by name in the default registry. Construct and
register it explicitly when wiring up `withGuardrails`.

### Pattern provenance

All regexes live in [`src/guardrails/patterns.ts`](../src/guardrails/patterns.ts)
with inline source attribution (vendor docs, OWASP, public corpora) and
a `Last review` stamp. Bump quarterly.

## Config

`aistack.config.json` sibling field:

```jsonc
{
  "guardrails": {
    "enabled": true,
    "builtin": ["secrets", "pii"],
    "customPaths": ["./guardrails/company-pii.js"],
    "timeoutMs": 2000,
    "killSwitch": true
  }
}
```

- `enabled`: master switch. `false` ⇒ framework is inert.
- `builtin`: names resolved against the default registry.
- `customPaths`: modules that call `registerGuardrail(...)` on import.
- `timeoutMs`: per-guardrail timeout (slow guardrail ⇒ synthetic crash failure).
- `killSwitch`: abort remaining checks on first **high-severity** failure.

The framework is **opt-in**: enabling config alone changes nothing. Call
sites must explicitly wrap their executor with `withGuardrails(...)`. See
"Integration" below.

## Integration — `withGuardrails`

```ts
import {
  withGuardrails,
  getGuardrailRegistry,
  zodSchemaGuardrail,
} from '@blackms/aistack/guardrails';
import { z } from 'zod';

const registry = getGuardrailRegistry();

const wrapped = withGuardrails(
  async (taskInput: string) => runAgent(taskInput),
  {
    input: registry.resolve(['secrets', 'pii', 'prompt-injection']),
    output: [
      ...registry.resolve(['secrets']),
      zodSchemaGuardrail(
        z.object({ summary: z.string(), citations: z.array(z.string()) }).strict()
      ),
    ],
    context: { agentType: 'researcher', taskId: 't-123' },
    runOptions: { onAudit: (e) => emitAuditEvent(e) },
  }
);

try {
  const result = await wrapped(userQuery);
} catch (err) {
  if (err instanceof GuardrailBlockedError) {
    // err.stage === 'input' | 'output'
    // err.outcome.failures has full attribution
  }
  throw err;
}
```

### Why a higher-order wrapper?

Three concurrent issues touch the agent lifecycle (AIG-633 checkpointer,
AIG-635 audit, AIG-641 rubric). Editing `spawner.ts` or `review-loop.ts`
from this issue would conflict. The HOF pattern keeps guardrails as an
**opt-in concern at the call site**.

## Authoring a custom guardrail

```ts
// guardrails/no-broken-links.ts
import { registerGuardrail } from '@blackms/aistack/guardrails';

registerGuardrail({
  name: 'no-broken-links',
  direction: 'output',
  description: 'Reject outputs containing localhost / 127.0.0.1 URLs',
  async validate(payload, ctx) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const bad = /https?:\/\/(?:localhost|127\.0\.0\.1)/g.exec(text);
    if (!bad) return { pass: true };
    return {
      pass: false,
      severity: 'high',
      reason: 'output contains a localhost URL',
      matches: [{ kind: 'localhost-url', sample: bad[0] }],
    };
  },
});
```

Reference it via config: `"customPaths": ["./guardrails/no-broken-links.js"]`.

### Contract

1. `validate` MUST NOT throw. If it does, the runner converts it into a
   synthetic `{ pass: false, severity: 'high', crashed: true }` failure
   and continues with the other guardrails (isolation guarantee).
2. `validate` SHOULD be fast (< 50ms). Hard timeout: `timeoutMs`.
3. Output `matches[].sample` MUST be redacted — never echo the raw secret.
4. `severity: 'high'` triggers the kill-switch; `'low'` is accumulated.

## Execution model

`runGuardrails(payload, guardrails, opts)`:

1. Launch all guardrails concurrently.
2. Each is wrapped with `setTimeout` for the timeout fence and `try/catch`
   for isolation.
3. The outer await is a `Promise.race` between (a) `Promise.all(runOne)`
   and (b) a kill-signal that resolves on the first high-severity failure
   when `killSwitch` is on.
4. Background guardrails keep settling so their audit events are still
   recorded.

Wall-clock latency:

- No failures: `O(max(durations))`
- Fast-fail high: `O(min(time-to-first-high-failure))`

## Security model & trade-offs

### False positives

Tuned narrow: `pii` only matches credit cards that **pass LUHN**; secrets
require canonical vendor prefixes (`AKIA`, `ghp_`, `sk-`, ...). Generic
high-entropy detection is **off by default**.

Documented sharp edges:

- `email` regex matches anything `local@domain.tld` — common case is real PII,
  but transactional addresses (`alerts@yourdomain.io`) are valid PII too.
- `it-codice-fiscale` does not validate the checksum char. Add a custom
  guardrail with `@sgarciav/codice-fiscale` if you need it.

### False negatives

Regex-based prompt-injection detection is **trivially bypassed** by
rephrasing (2026 baseline). Treat it as a tripwire for naive attacks
only — semantic detection requires the adversarial loop (AIG-641) or an
LLM-based scanner. The guardrail emits a known-coverage list in its
`matches` so reviewers can see what was *not* checked.

### Isolation

A malicious or buggy custom guardrail:

- Cannot crash the agent (caught and logged).
- Cannot deadlock the agent (hard `timeoutMs`).
- Cannot poison audit (audit emitter wrapped in try/catch).

### Audit trail

Every failure produces a `GuardrailAuditEvent` via the `onAudit` callback,
ready to forward to the central audit sink landed in AIG-635 (or wherever
your project routes audit events).

```ts
onAudit: (event) => myAuditSink.write({ ...event, source: 'guardrail' })
```

## Review-loop gate (AIG-868)

In addition to the opt-in `withGuardrails(...)` wrapper, the review loop
(`src/coordination/review-loop.ts`) now runs the configured guardrails as a
**real gate** — not just an available library:

1. **INPUT gate** — the task requirements are validated *before* the coder
   runs (prompt-injection, secrets/PII smuggled into the requirements). The
   coder is never invoked when the input gate blocks.
2. **OUTPUT gate** — the coder's response is validated *before* it reaches
   the adversarial reviewer or is persisted, on both the initial generation
   and every fix iteration (leaked secrets, PII).

On a **blocking** violation the loop sets its status to `failed`, records the
offending guardrails in `state.guardrailFailures` (as `name(severity)`
labels), emits an audit log line, and throws `ReviewLoopGuardrailError`
(re-exported from the package root). It does **not** proceed silently.

The gate is **disabled by default** — existing installs are unaffected.
Enable it per project via `agentstack.config.json`:

```jsonc
{
  "guardrails": {
    "enabled": true,
    "builtin": ["secrets", "pii", "prompt-injection"],
    // Optional per-direction overrides (default to `builtin`):
    "input": ["prompt-injection", "secrets", "pii"],
    "output": ["secrets", "pii"],
    "timeoutMs": 2000,
    "aggregateTimeoutMs": 200,
    "killSwitch": true,
    // Output failures log-only instead of blocking (rollout aid). Input
    // failures ALWAYS block (fail-closed). Default false.
    "outputNonBlocking": false
  }
}
```

Notes:

- When `builtin` is empty the gate falls back to
  `['secrets', 'pii', 'prompt-injection']`.
- A guardrail only runs in the direction it declares — an `input`-only
  guardrail (e.g. `prompt-injection`) is never run on output, and a
  `both`/`output` guardrail (`secrets`, `pii`) is run on output.
- Unknown guardrail names in config **throw** at resolution time, so a typo
  cannot silently disable the gate (fail-closed).

`ReviewLoopGuardrailError` carries `.direction` (`'input' | 'output'`) and
`.outcome` (the full `GuardrailRunOutcome` with per-guardrail failures).

## Using guardrails as a Claude Code `PreToolUse` hook

Claude Code's native hook system can invoke the same built-ins as a
`PreToolUse` hook so prompts / tool inputs are screened *before* a tool
runs. This reuses the native hook lifecycle — aistack does **not**
re-implement hooks.

### 1. A tiny hook script

A `PreToolUse` hook receives the tool call as JSON on **stdin** and denies
the call by exiting non-zero. The script feeds the tool input through the
engine via the public API:

```js
// .claude/hooks/guardrails-pretooluse.mjs
import { runGuardrails, getGuardrailRegistry } from '@blackms/aistack';

const raw = await new Promise((res) => {
  let buf = '';
  process.stdin.on('data', (c) => (buf += c));
  process.stdin.on('end', () => res(buf));
});

const event = JSON.parse(raw || '{}');
// Scan the tool input payload (e.g. Bash command, file contents, prompt).
const payload = JSON.stringify(event.tool_input ?? event);

const guardrails = getGuardrailRegistry().resolve([
  'secrets',
  'pii',
  'prompt-injection',
]);

const outcome = await runGuardrails(payload, guardrails, {
  context: { direction: 'input', agentType: 'claude-code' },
  killSwitch: true,
  aggregateTimeoutMs: 200,
});

if (!outcome.pass) {
  const reasons = outcome.failures
    .map((f) => `${f.guardrail}: ${f.reason}`)
    .join('; ');
  // Stderr is surfaced to the model; non-zero exit denies the tool call.
  console.error(`Blocked by aistack guardrails -> ${reasons}`);
  process.exit(2);
}
process.exit(0);
```

### 2. Register it in `.claude/settings.json`

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/guardrails-pretooluse.mjs"
          }
        ]
      }
    ]
  }
}
```

Every `Bash`, `Write`, or `Edit` tool call is now screened by the same
secrets / PII / prompt-injection validators used by the review loop. Tune
the `matcher` and the resolved guardrail list to taste.

## Roadmap

- ML-classifier guardrail (HuggingFace Prompt-Guard / Llama-Guard)
- LLM-based deep-scan guardrail (semantic, ~500ms)
- Built-in `no-secrets-by-entropy` with shannon scoring
- Configurable redaction transformer (return *cleansed* payload, not just pass/fail)
