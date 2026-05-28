# Multi-Machine Federation (AIG-652)

Aistack ships an opt-in federation layer that lets multiple nodes
discover each other, advertise capabilities, and delegate task execution
across machines. Federation is **disabled by default** - enabling it does
not affect any other subsystem.

The implementation is intentionally small and isolated:

```
src/federation/
  types.ts        Public interfaces (NodeInfo, FederationConfig, ...)
  discovery.ts    StaticDiscovery / MdnsDiscovery / RegistryDiscovery
  routing.ts      TaskRouter (round-robin / least-loaded / capability-match)
  transport.ts    FederationClient + mTLS credential management + sanitizer
  server.ts       Minimal HTTP(S) server exposing the federation endpoints
  index.ts        FederationManager + createFederation factory
```

## Protocol

Federation speaks plain JSON over HTTPS. Two endpoints, both versioned
under `/v1/federation`:

### `GET /v1/federation/capabilities`

Returns this node's `NodeInfo`:

```json
{
  "nodeId": "9c0c…",
  "name": "aistack-prod-eu-1",
  "address": "https://10.0.1.4:8443",
  "scheme": "https",
  "capabilities": [
    { "name": "coder", "enabled": true, "maxConcurrent": 4 },
    { "name": "researcher", "enabled": true }
  ],
  "load": 0.31,
  "tags": ["eu-west", "gpu"],
  "version": "1.6.1"
}
```

The capabilities document does **not** contain task input, source code,
memory snippets, or any other sensitive material.

### `POST /v1/federation/task`

Body: a `TaskDelegation` (sanitized client-side):

```json
{
  "taskId": "abc-123",
  "agentType": "coder",
  "input": "Refactor the auth middleware to support OIDC",
  "hints": {
    "requiredCapabilities": ["coder"],
    "preferredTags": ["eu-west"],
    "estimatedTokens": 8000
  }
}
```

Response: a `TaskDelegationResult`:

```json
{
  "taskId": "abc-123",
  "status": "completed",
  "summary": "Patch applied in 3 files, 12 lines changed",
  "executedBy": "9c0c…"
}
```

Only the `taskId`, `agentType`, `input` (truncated to
`maxInputLength`, default 4096 chars) and `hints` are sent. Every other
key is stripped by `sanitizeDelegation`.

## Configuration

The federation slot is a sibling of the existing top-level slots in
`aistack.config.json`. Default values are safe:

```json
{
  "federation": {
    "enabled": true,
    "name": "aistack-prod-eu-1",
    "discoveryMethod": "mdns",
    "advertise": true,
    "peers": ["https://10.0.1.5:8443", "https://10.0.1.6:8443"],
    "registryUrl": "https://federation.example.com",
    "mdnsServiceType": "_aistack._tcp.local",
    "bindAddress": "0.0.0.0",
    "bindPort": 8443,
    "routingPolicy": "least-loaded",
    "maxInputLength": 4096,
    "requestTimeoutMs": 10000,
    "tls": {
      "certPath": "/etc/aistack/federation/node.crt",
      "keyPath":  "/etc/aistack/federation/node.key",
      "caPath":   "/etc/aistack/federation/ca.crt",
      "requireClientCert": true
    }
  }
}
```

### Discovery methods

| Method     | Use case                                 | Optional dep      |
|------------|------------------------------------------|-------------------|
| `static`   | Air-gapped, tests, small clusters        | none              |
| `mdns`     | LAN auto-discovery (Bonjour / zeroconf)  | `bonjour-service` |
| `registry` | Central HTTP registry, multi-DC          | none              |

When `mdns` is selected but `bonjour-service` is not installed, the
discovery silently degrades to no-op and logs a one-time warning -
aistack continues to run.

### Routing policies

`TaskRouter` ships three policies, all configurable per call:

- `round-robin` - cycles through candidates that advertise the
  requested capability.
- `least-loaded` - picks the lowest-load candidate; ties broken by
  round-robin.
- `capability-match` - +2 per matching `preferredTag`, +1 per matching
  hint key, tie-break by lower load.

## Security model

Federation transport defaults to **mutual TLS**. Each node loads:

- `certPath` - the node's own certificate (PEM)
- `keyPath`  - the node's private key (PEM)
- `caPath`   - the trusted CA bundle (PEM)

`requireClientCert` defaults to `true`. Connections from peers without a
valid client certificate are refused with HTTP 401.

If `tls.cert`/`tls.key` are absent, the server falls back to HTTP and
logs a loud warning. This is **only** acceptable for local development
and integration tests.

A bearer-token fallback (`tls.bearerToken`) is provided for environments
where PKI is not available. Bearer mode also logs a warning at startup
and should not be used in production.

### Key rotation

Federation certificates can be rotated by:

1. Issuing a new cert from your internal CA.
2. Writing the new files to `certPath` / `keyPath`.
3. Sending SIGINT to the `aistack federation join` process and
   restarting it. There is no hot-reload by design - federation is a
   control-plane service and the restart blip is acceptable.

Short-lived certs (24-72 h) are recommended; pair with cert-manager or
SPIRE for automation.

### No-egress of sensitive data

The federation protocol carries only **task metadata**: id, agent type,
sanitized input, and routing hints. The transport layer enforces this in
two ways:

1. `sanitizeDelegation()` runs on every outbound `submitTask` and uses
   an allowlist of keys. Unknown keys (`secrets`, `filePayload`, …) are
   dropped before serialization.
2. `maxInputLength` truncates oversized inputs (default 4096 chars).

Memory entries, hook context, agent prompts, and source code are **never**
serialized by the federation transport. If you need to share project
files between nodes, use a separate mechanism (git, a shared object
store, etc.) - federation is not a file transfer layer.

## CLI

```
aistack federation status            Show current federation state
aistack federation peers             List statically configured peers
aistack federation join [--port N]   Start the node and join the cluster
aistack federation leave             Documents the SIGINT shutdown path
```

`join` runs in the foreground; press Ctrl+C to leave.

## Programmatic usage

```ts
import { createFederation } from '@blackms/aistack';

const fed = createFederation(config.federation);
fed.setLocalCapabilities([
  { name: 'coder', enabled: true, maxConcurrent: 4 },
]);
fed.setTaskHandler(async (task) => {
  // Hand off to the local coordinator / spawner
  const result = await runLocally(task);
  return { taskId: task.taskId, status: 'completed', summary: result.summary, executedBy: '' };
});
await fed.join();

// Opt-in delegation - call this from your coordinator when you want
// to spread work across the cluster.
const decision = fed.delegateTask(task, 'least-loaded');
if (decision.peer) {
  const remote = await fed.submitTask(decision.peer, task);
  console.log(remote.summary);
} else {
  // Run locally
}
```

## CRDT / state replication

State replication across nodes (memory, agent identities, projects) is
intentionally **out of scope for v1**. Each node keeps its own SQLite
store; only routing-relevant data is shared via the discovery layer.

A follow-up issue will introduce CRDT-based replication for agent
identities and shared memory namespaces (likely Yjs or Automerge). The
federation transport already carries an `executedBy` field so that
remote-produced artifacts can be traced once replication lands.

## Troubleshooting

| Symptom                                            | Likely cause / fix                                                    |
|----------------------------------------------------|-----------------------------------------------------------------------|
| `Federation transport is UNAUTHENTICATED`          | Set `federation.tls.certPath` / `keyPath` / `caPath`.                 |
| `bonjour-service package is not installed`         | `npm install bonjour-service` if you want mDNS discovery.             |
| `Federation submitTask 401`                        | Peer rejected our cert. Check that both nodes trust the same CA.      |
| `Federation submitTask 400 invalid_payload`        | Your task hint shape is wrong; see `TaskDelegation` in `types.ts`.    |
| `delegateTask` always returns `peer: null`         | No peer advertises the requested `agentType`. Check capability lists. |
| Peer never appears in `aistack federation status`  | Discovery method mismatch (mDNS vs registry) - both nodes must agree. |

## Test coverage

- `tests/unit/federation/routing.test.ts` - exhaustive policy tests
  (round-robin, least-loaded, capability-match, tie-break, capability
  filtering).
- `tests/integration/federation-3node.test.ts` - spins up three local
  nodes, verifies routing from node A to node B or C, and verifies that
  `sanitizeDelegation` strips unknown keys / truncates oversized input.
