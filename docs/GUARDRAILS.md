# Guardrails Framework

> Status: Initial — landed in AIG-645 (M2-17).

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

## Roadmap

- ML-classifier guardrail (HuggingFace Prompt-Guard / Llama-Guard)
- LLM-based deep-scan guardrail (semantic, ~500ms)
- Built-in `no-secrets-by-entropy` with shannon scoring
- Configurable redaction transformer (return *cleansed* payload, not just pass/fail)
