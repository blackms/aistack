# Telemetry & Privacy Policy

aistack ships an **opt-in, anonymous** telemetry client (`src/telemetry/`)
introduced in AIG-655. This document describes exactly what is collected,
what is **not** collected, how to enable or disable it, and how the
upstream aggregation endpoint can be deployed by the maintainers.

> **Default behavior: telemetry is DISABLED.**
> You must explicitly set `telemetry.enabled = true` in your
> `aistack.config.json` to send any data.

---

## What we collect (only when opted in)

When `telemetry.enabled` is `true`, the client posts batched JSON events
to the configured `telemetry.endpoint`. Each event contains:

| Field            | Example                              | Why                                |
|------------------|--------------------------------------|------------------------------------|
| `type`           | `review_loop.completed`              | Which feature was exercised        |
| `timestamp`      | `2026-05-28T10:00:00.000Z`           | Aggregation by day/week            |
| `sessionId`      | `a3f5e2c1b9d04e7f` (hashed, 64 bits) | Distinct-session counting          |
| `aistackVersion` | `1.5.3`                              | Adoption per version               |
| `nodeVersion`    | `20`                                 | Supported runtime distribution     |
| `osFamily`       | `darwin` / `linux` / `win32`         | Platform breakdown                 |
| `payload`        | `{ iterations: 2, approved: true }`  | Small structured event facts       |

### Currently emitted event types

- `review_loop.started`, `review_loop.completed`, `review_loop.failed`
- `agent.spawned`, `agent.completed`
- `session.started`, `session.ended`

Payload values are restricted at the client to `number | string | boolean`
and string values are truncated to 200 characters as a defense-in-depth
measure. Anything that does not match these types is silently dropped.

---

## What we explicitly do NOT collect

- No **email addresses**, **usernames**, or other identifiers
- No **IP addresses** (the endpoint MUST NOT log them — see deploy notes below)
- No **API keys**, **tokens**, or **credentials** of any kind
- No **source code**, **prompts**, **task inputs**, or **agent outputs**
- No **file paths** or **filenames**
- No **stack traces** or **error messages** (only event types like `review_loop.failed`)
- No **raw session IDs** by default — the local SHA-256 hash is irreversible
  for any practical purpose (16 hex chars = 64 bits, used only for distinct
  counting within a rolling window)

The telemetry client source is in this repository
(`src/telemetry/client.ts`) — anyone can audit it.

---

## How to opt in

Add a `telemetry` block to your `aistack.config.json`:

```json
{
  "telemetry": {
    "enabled": true,
    "endpoint": "https://stats.aistack.dev/v1/events",
    "anonymizeSessionId": true,
    "flushIntervalMs": 60000,
    "batchSize": 20
  }
}
```

| Field                | Type      | Default                              | Meaning                                    |
|----------------------|-----------|--------------------------------------|--------------------------------------------|
| `enabled`            | boolean   | `false`                              | Master switch                              |
| `endpoint`           | string    | _none_                               | HTTPS POST target; events are dropped if absent |
| `anonymizeSessionId` | boolean   | `true`                               | SHA-256-hash session IDs before sending    |
| `flushIntervalMs`    | number    | `60000`                              | (Informational — host app drives flush)    |
| `batchSize`          | number    | `20`                                 | Auto-flush when this many events buffered  |

## How to opt out

Either:

- Remove the `telemetry` block from `aistack.config.json`, or
- Set `telemetry.enabled` to `false`, or
- Leave `telemetry.endpoint` blank (events are buffered locally and dropped on flush)

There is no remote kill-switch and no fallback endpoint. If you do nothing,
nothing is sent.

---

## Where the data goes

The intended aggregation endpoint is `https://stats.aistack.dev/v1/events`
(planned; not yet deployed at the time of this writing — see the M0
follow-up note in `README.md`).

You can also point `telemetry.endpoint` at your own collector — useful
for self-hosted teams who want internal usage analytics without
contributing to public counters.

---

## Deploying the upstream collector (maintainer notes)

The collector is intentionally a single Cloudflare Worker backed by a KV
namespace — small enough to read in one sitting, cheap enough to stay on
the free tier indefinitely, and explicit about what it stores.

> **Status:** stub code only. No deploy has been performed by this issue
> branch. Provisioning DNS, the Cloudflare account, and the KV namespace
> is out of scope for AIG-655 and tracked as M0 follow-up infra work.

### Worker source (`worker.js`)

```js
// stats.aistack.dev — aistack telemetry collector
//
// Privacy guarantees enforced at the worker:
//   - No IP logging (Cloudflare access logs MUST be disabled for this route)
//   - No request body retention — only counter increments in KV
//   - CORS is intentionally NOT permissive; only POST from any origin is allowed
//
// KV binding: env.STATS (Cloudflare KV namespace)

const ALLOWED_EVENT_TYPES = new Set([
  'review_loop.started',
  'review_loop.completed',
  'review_loop.failed',
  'agent.spawned',
  'agent.completed',
  'session.started',
  'session.ended',
]);

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const events = Array.isArray(body?.events) ? body.events : [];
    if (events.length === 0 || events.length > 100) {
      return new Response('Bad batch size', { status: 400 });
    }

    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const updates = new Map();

    for (const event of events) {
      if (!event || !ALLOWED_EVENT_TYPES.has(event.type)) continue;
      const key = `count:${day}:${event.type}`;
      updates.set(key, (updates.get(key) ?? 0) + 1);
    }

    // Best-effort increments (KV is eventually consistent — close enough
    // for "how many review loops ran this week" counters).
    await Promise.all(
      [...updates.entries()].map(async ([key, increment]) => {
        const current = parseInt((await env.STATS.get(key)) ?? '0', 10);
        await env.STATS.put(key, String(current + increment));
      }),
    );

    return new Response('ok', { status: 204 });
  },
};
```

### Companion read endpoint for shields.io

shields.io's [endpoint badge](https://shields.io/badges/endpoint-badge)
expects a JSON shape `{ schemaVersion, label, message, color }`. A
sibling worker (or the same one, with routing) can serve aggregates:

```js
// GET /loops.json — returns this-week's review loop count for shields.io
async function loopsJson(env) {
  const today = new Date();
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const key = `count:${d.toISOString().slice(0, 10)}:review_loop.completed`;
    total += parseInt((await env.STATS.get(key)) ?? '0', 10);
  }
  return Response.json({
    schemaVersion: 1,
    label: 'review loops/week',
    message: total.toLocaleString(),
    color: 'blueviolet',
  });
}
```

The README can then reference it as:

```markdown
![review loops/week](https://img.shields.io/endpoint?url=https://stats.aistack.dev/loops.json)
```

### Deployment steps (manual, out of AIG-655 scope)

1. Create a Cloudflare account and add the `aistack.dev` zone.
2. `wrangler kv:namespace create STATS` and bind it to the worker.
3. Disable access logging on the `stats.aistack.dev` route to honor the
   no-IP-logging promise.
4. `wrangler deploy worker.js`.
5. Smoke test with:
   ```bash
   curl -X POST https://stats.aistack.dev/v1/events \
     -H 'content-type: application/json' \
     -d '{"events":[{"type":"agent.spawned","timestamp":"2026-05-28T10:00:00Z","aistackVersion":"1.5.3","nodeVersion":"20","osFamily":"linux"}]}'
   ```
6. Update the README to swap the `<!-- M0 followup -->` comment for the
   live shields.io endpoint badges.

---

## Audit & questions

The full telemetry client is ~150 lines in `src/telemetry/client.ts` and
the type union is in `src/telemetry/types.ts`. Test coverage lives in
`tests/unit/telemetry/client.test.ts`.

For privacy questions or to request additions/removals to the collected
event set, open an issue on
[GitHub](https://github.com/blackms/aistack/issues) or reach out on
[Discord](https://discord.gg/uQ6fDXDs7E).
