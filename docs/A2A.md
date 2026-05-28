# A2A (Agent-to-Agent) Protocol Support

aistack speaks the [A2A protocol v1](https://a2a-protocol.org) so that aistack
agents can interoperate with agents written in **CrewAI 1.10**, **Microsoft
Agent Framework 1.0**, the **OpenAI Agents SDK**, **Mastra**, and **Letta**
(Agent File `.af`). This document covers the on-the-wire format, how to expose
your aistack agents as A2A endpoints, and how to call remote A2A agents from
your own code or workflows.

## Protocol overview

A2A is a small HTTP/JSON protocol with two compulsory surfaces:

| Surface | Method | Path | Purpose |
|--|--|--|--|
| Agent card | `GET` | `/.well-known/a2a-agent-card.json` | Capability discovery |
| Message  | `POST` | `/v1/a2a/message` | Send a task to the agent |

aistack implements v1.0 of the spec (`protocolVersion: "1.0"`). Streaming,
push notifications, and state-transition history are advertised as `false`
in the capabilities block; they will be added in a follow-up issue.

### Agent card schema

A canonical aistack agent card looks like:

```json
{
  "protocolVersion": "1.0",
  "name": "aistack",
  "description": "aistack multi-agent orchestrator exposed via the A2A protocol for cross-runtime interop.",
  "url": "http://127.0.0.1:8787",
  "version": "1.0.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "authentication": { "schemes": ["bearer"] },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "skills": [
    {
      "id": "coder",
      "name": "Coder",
      "description": "Writes code based on specifications",
      "inputModes": ["text"],
      "outputModes": ["text"],
      "tags": ["write-code", "refactor", "fix-bugs"]
    },
    {
      "id": "reviewer",
      "name": "Reviewer",
      "description": "Reviews code for correctness, quality, and best practices",
      "inputModes": ["text"],
      "outputModes": ["text"],
      "tags": ["code-review", "quality-check"]
    }
  ]
}
```

Each aistack agent type registered in the registry (`src/agents/registry.ts`)
becomes one A2A skill. Limit which agents are exposed by setting
`a2a.exposedAgents` in `aistack.config.json`.

### Message schema

Inbound (POST `/v1/a2a/message`):

```json
{
  "messageId": "11111111-2222-3333-4444-555555555555",
  "skillId": "coder",
  "role": "user",
  "parts": [{ "kind": "text", "text": "Fix the null pointer in src/foo.ts" }]
}
```

Successful response (HTTP 200):

```json
{
  "messageId": "66666666-7777-8888-9999-aaaaaaaaaaaa",
  "inReplyTo": "11111111-2222-3333-4444-555555555555",
  "role": "agent",
  "status": "completed",
  "parts": [{ "kind": "text", "text": "<agent output>" }],
  "metadata": { "skillId": "coder" }
}
```

Error responses (4xx/5xx) follow the shape:

```json
{ "error": "unauthorized", "message": "Missing or malformed Authorization header" }
```

## Server setup

The A2A server is **not a standalone HTTP server**. It registers two routes
onto the shared `WebhookServer` introduced by AIG-636 so that A2A,
GitHub webhooks (AIG-637), and any future webhook-driven feature live on the
same port without collision.

### CLI

```bash
# Bind to loopback on port 8787 with bearer auth from env var
export AISTACK_A2A_TOKEN="$(openssl rand -hex 32)"
aistack a2a serve --port 8787

# Public URL (e.g. behind reverse proxy)
aistack a2a serve --port 8787 --url https://agents.example.com

# Local-only with no auth (DEV ONLY)
aistack a2a serve --port 8787 --no-auth
```

### Programmatic

```ts
import { WebhookServer } from '@blackms/aistack/transport/webhook';
import { registerA2ARoutes } from '@blackms/aistack/a2a';
import { getConfig } from '@blackms/aistack';

const config = getConfig();
const server = new WebhookServer({ port: 8787, host: '127.0.0.1' });

registerA2ARoutes(server, {
  config,
  a2a: {
    url: 'https://agents.example.com',
    bearerToken: process.env.AISTACK_A2A_TOKEN,
    exposedAgents: ['coder', 'reviewer'], // optional allowlist
  },
});

await server.start();
```

> Once AIG-636 lands in `main`, the canonical `WebhookServer` will be served
> from `src/transport/webhook.ts`. This branch ships a forward-compatible stub
> so AIG-639 can be reviewed independently — the public API is identical.

### Configuration

`aistack.config.json` accepts an optional `a2a` block:

```json
{
  "a2a": {
    "enabled": true,
    "port": 8787,
    "host": "127.0.0.1",
    "publicUrl": "https://agents.example.com",
    "bearerToken": "${AISTACK_A2A_TOKEN}",
    "exposedAgents": ["coder", "reviewer"]
  }
}
```

`${ENV_VAR}` placeholders are interpolated by `loadConfig()`.

## Client usage

### CLI

```bash
# Call a remote A2A agent
export AISTACK_A2A_CLIENT_TOKEN="..."
aistack a2a call https://crew.example.com "Plan a sprint about onboarding"

# Specify the target skill
aistack a2a call https://crew.example.com "..." --skill planner

# Inspect a remote agent's card
aistack a2a card https://crew.example.com
```

### Programmatic

```ts
import { a2aCall, fetchAgentCard, textMessage } from '@blackms/aistack/a2a';

// Discover capabilities
const card = await fetchAgentCard('https://crew.example.com');
console.log(card.skills.map((s) => s.id));

// Call with auto-wrapped string
const r = await a2aCall('https://crew.example.com', 'plan my sprint', {
  bearerToken: process.env.CREW_TOKEN,
});

// Call with a fully-formed message
const r2 = await a2aCall(
  'https://crew.example.com',
  textMessage(crypto.randomUUID(), 'plan my sprint', 'planner'),
  { bearerToken: process.env.CREW_TOKEN, timeoutMs: 60_000, retries: 1 },
);
```

`a2aCall` retries on network failures and 5xx responses (default 2 retries
with exponential backoff). 4xx errors are surfaced immediately as
`A2AClientError` — they will not get better with retries.

## Security model

| Concern | Default | How to harden |
|--|--|--|
| Network exposure | `127.0.0.1` | Front with a reverse proxy + TLS |
| Authentication | Bearer token from `AISTACK_A2A_TOKEN` | Rotate with secrets manager; advertise `mtls` in card if required |
| Authorization | Allowlist via `exposedAgents` | Pin to least-privilege subset |
| Replay protection | None at protocol layer | Issue short-lived JWTs upstream |
| Audit | Standard logger output | Plug into existing aistack monitoring (`src/monitoring`) |

**Never hardcode bearer tokens.** The CLI reads them from
`AISTACK_A2A_TOKEN` (server) and `AISTACK_A2A_CLIENT_TOKEN` (client). The
config schema accepts `${ENV}` interpolation for the same reason. If no
token is configured the server logs a warning at startup and disables auth.

## Interop examples

### Calling a CrewAI 1.10 endpoint from aistack

```ts
import { a2aCall } from '@blackms/aistack/a2a';

const result = await a2aCall(
  'https://my-crew.example.com',
  'Generate Q3 OKRs for the platform team',
  { bearerToken: process.env.CREW_TOKEN, retries: 1 },
);
console.log(result.parts[0].text);
```

### Calling an aistack endpoint from CrewAI

From a CrewAI 1.10 process, register the aistack endpoint as an A2A peer
(using whatever A2A client wrapper your runtime exposes):

```python
from crewai.a2a import A2AClient

client = A2AClient("https://agents.example.com",
                   token=os.environ["AISTACK_TOKEN"])
card = client.fetch_card()
# Pick any aistack skill listed in card.skills
response = client.send_message(
    skill_id="coder",
    text="Refactor src/foo.ts to use async/await",
)
print(response.parts[0].text)
```

Replace `crewai.a2a.A2AClient` with the equivalent helper from Microsoft
Agent Framework, OpenAI Agents SDK, Mastra, or Letta — the wire protocol is
the same.

## Acceptance criteria checklist

- [x] Agent card JSON spec valid (A2A v1) — `generateAgentCard()` round-trips through Zod
- [x] Server endpoint functional — `registerA2ARoutes()` on `WebhookServer`
- [x] Client TS API `a2aCall(url, msg)` returns response — `src/a2a/client.ts`
- [x] E2E roundtrip aistack <-> CrewAI mock — `tests/integration/a2a-roundtrip.test.ts`
- [x] Documented — this file
- [x] CLI `aistack a2a serve` exposes the agent — `src/cli/commands/a2a.ts`
