# Audit Log — Hash-Chained Immutable Trail (AIG-635)

aistack ships with an append-only, cryptographically-chained audit log designed
to satisfy SOC2 Type II, ISO 27001, and HIPAA evidence requirements **without
relying on a cloud trust anchor**. Every audited event is hashed into a chain
so that any tampering — modification, deletion, reordering — becomes
detectable when the chain is verified.

This document describes the schema, API, CLI, threat model, and how to produce
an evidence pack for an external auditor.

---

## TL;DR

```bash
# Enable in aistack.config.json
{ "audit": { "enabled": true } }

# (Recommended) provide an HMAC key out-of-band via env var
export AISTACK_AUDIT_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# Operate
aistack audit status
aistack audit export --since=2026-01-01T00:00:00Z --format=jsonl -o evidence.jsonl
aistack audit verify
```

The audit chain lives in its own SQLite file (default
`<memory.path>.audit.db`), separate from the main application DB. UPDATE and
DELETE are blocked at the storage layer by triggers; hash chaining catches
anything that bypasses them (e.g. raw file edits).

---

## Schema

Migration: [`migrations/005_audit_log_chain.sql`](../migrations/005_audit_log_chain.sql)

```sql
CREATE TABLE audit_log_chain (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  prev_hash TEXT NOT NULL,     -- 64-hex SHA-256 of previous entry; genesis = 64 zeros
  hash TEXT NOT NULL,          -- 64-hex SHA-256 of this entry's pre-image
  event_type TEXT NOT NULL,    -- e.g. agent.spawn, task.complete, identity.retire
  payload_json TEXT NOT NULL,  -- canonical JSON (sorted keys), redacted, <= 64KB
  signature TEXT,              -- 64-hex HMAC-SHA256 of `hash`, optional
  signature_alg TEXT,          -- "HMAC-SHA256" or NULL
  created_at INTEGER NOT NULL  -- Unix ms
);
```

Indexes: `(event_type, created_at)`, `(created_at DESC)`.

Triggers: `BEFORE UPDATE` and `BEFORE DELETE` both `RAISE(ABORT)`. Anyone with
write access to the SQLite file can drop these triggers, but the hash chain
will detect the resulting tampering on verify.

---

## Hash computation

Each entry's hash is computed as:

```
SHA-256(
  "aistack/audit-log-chain/v1" || "\n" ||
  prev_hash || "\n" ||
  created_at_ms || "\n" ||
  event_type || "\n" ||
  canonical_json(payload)
)
```

Where `canonical_json` is the JSON serialization with **recursively sorted
keys** — this makes the hash insensitive to JSON-object key ordering, so an
exported evidence pack re-imported on a different machine (or different
language runtime) re-hashes to the same value.

The leading domain-separator string (`aistack/audit-log-chain/v1`) prevents
cross-protocol collision attacks: a payload hash from another system cannot be
confused with an audit-chain hash.

The `prev_hash` of the first ever entry is the all-zero string (64 hex `0`s)
so the hashing routine is symmetric for every entry.

---

## Events emitted

| Event type            | Emitted from                              | Payload (top-level keys, after redaction)                              |
|-----------------------|-------------------------------------------|------------------------------------------------------------------------|
| `agent.spawn`         | `src/agents/spawner.ts`                   | `agentId, type, name, identityId, sessionId`                           |
| `agent.stop`          | `src/agents/spawner.ts`                   | `agentId, name, identityId`                                            |
| `agent.error`         | `src/agents/spawner.ts` (executeAgent)    | `agentId, type, error`                                                 |
| `task.create`         | `src/memory/index.ts` (MemoryManager)     | `taskId, agentType, sessionId, riskLevel, parentTaskId, depth`         |
| `task.assign`         | `src/memory/index.ts` (status -> running) | `taskId, status`                                                       |
| `task.complete`       | `src/memory/index.ts` (status -> done)    | `taskId, status`                                                       |
| `task.fail`           | `src/memory/index.ts` (status -> failed)  | `taskId, status`                                                       |
| `consensus.decision`  | `src/tasks/consensus-service.ts`          | `checkpointId, taskId, approved, reviewedBy, reviewerType`             |
| `identity.create`     | `src/agents/identity-service.ts`          | `agentId, agentType, displayName, autoActivate`                        |
| `identity.activated`  | `src/agents/identity-service.ts`          | `agentId, previousStatus, newStatus, reason, actorId`                  |
| `identity.deactivated`| `src/agents/identity-service.ts`          | `agentId, previousStatus, newStatus, reason, actorId`                  |
| `identity.retire`     | `src/agents/identity-service.ts`          | `agentId, previousStatus, reason, actorId`                             |
| `identity.update`     | `src/agents/identity-service.ts`          | `agentId, updatedFields, actorId`                                      |
| `memory.write`        | `src/memory/index.ts` (store/storeShared) | `entryId, key, namespace, agentId, shared`                             |
| `memory.delete`       | `src/memory/index.ts` (delete)            | `key, namespace`                                                       |

**Memory reads are intentionally *not* audited** to keep the trail bounded;
the threat model targets write operations and lifecycle transitions. If your
compliance regime requires read auditing, do so at a higher layer (the MCP
tool boundary) — out of scope here.

Payloads are filtered through `config.audit.redactFields` before hashing, so
sensitive content (e.g. `content`, `apiKey`) never enters the chain.

---

## Configuration

```jsonc
{
  "audit": {
    "enabled": true,
    // Path override; default is `<memory.path>.audit.db`
    "path": "./data/aistack.audit.db",
    // PREFER the AISTACK_AUDIT_KEY env var over inlining the key here.
    // Inline only if you are storing the config in a secrets manager.
    "signatureKey": "${AISTACK_AUDIT_KEY}",
    // Informational. The chain itself is append-only and never auto-pruned.
    "retentionDays": 2555,
    // Top-level payload keys that will be replaced with "[REDACTED]".
    "redactFields": ["content", "apiKey", "password", "token"]
  }
}
```

### Key management

- Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Distribute via the same channel you already use for `ANTHROPIC_API_KEY`
  (env var, sealed secret, vault).
- **Never commit the key**. The `${AISTACK_AUDIT_KEY}` interpolation in
  config is resolved from `process.env` at load time.
- Rotating the key invalidates HMAC verification for all entries signed under
  the old key. Treat the key as long-lived; if rotation is unavoidable, export
  + verify under the old key first, archive the signed export as evidence,
  then re-key.

### Unsigned mode

If `enabled: true` but no key is found, the chain still runs and still
detects tampering via the hash chain — you just lose the cryptographic
*attribution* layer. A warning is logged once at startup.

---

## CLI

```bash
# Summary
aistack audit status

# Export as JSONL (default) for archiving
aistack audit export --since=2026-01-01T00:00:00Z --until=2026-06-01T00:00:00Z -o audit-q1.jsonl

# Export as CSV for spreadsheet review
aistack audit export --format=csv -o audit-q1.csv

# Verify end-to-end (exit 0 = OK, 2 = chain broken)
aistack audit verify

# Verify a slice
aistack audit verify --from-seq=1000 --to-seq=2000
```

Exit codes for `verify`:

| Exit | Meaning                                                              |
|------|----------------------------------------------------------------------|
| 0    | Chain valid (and signed entries verified, if a key is configured)    |
| 1    | Audit disabled or wrong CLI invocation                               |
| 2    | Chain broken — `stderr` reports the first broken `seq` and reason    |

---

## Threat model

### What the audit chain protects against

| Threat                                         | Mechanism                                                        |
|------------------------------------------------|------------------------------------------------------------------|
| Modification of a single past entry            | Hash chain — `verify` reports the broken `seq`                   |
| Deletion of past entries                       | `prev_hash` mismatch on the next entry                           |
| Reordering of entries                          | Hash chain depends on `prev_hash` → reordering breaks linkage    |
| Insertion of a forged entry mid-chain          | Same — `prev_hash` chain breaks                                  |
| Bypassing UPDATE/DELETE via SQL                | `BEFORE UPDATE/DELETE` triggers + chain hash fallback            |
| Replay of an old payload as a "new" event      | `created_at` + `seq` are both part of the hash                   |
| Cross-protocol confusion with other hashes     | Domain-separator string `aistack/audit-log-chain/v1` in pre-image|
| Forgery by a process without the HMAC key      | HMAC-SHA256 signature on every entry (when signed mode is on)    |

### What the audit chain does NOT protect against

| Out of scope                                       | Why / how to mitigate                                              |
|----------------------------------------------------|--------------------------------------------------------------------|
| Compromise of the HMAC key                         | Treat the key as a Tier-0 secret; use a vault; rotate on incident  |
| Adversary writing to the DB *before* events occur  | Audit captures actions, not intent; pair with OS file ACLs         |
| Adversary deleting the entire audit DB file        | Mirror to append-only object storage (S3 Object Lock, etc.)        |
| Plaintext disclosure of payloads                   | Use `redactFields`; payloads are *not* encrypted at rest           |
| Clock skew leading to wrong `created_at`           | Use NTP; verify only checks monotonicity via `seq`, not wall time  |
| Code path that fails to call `audit(...)`          | Coverage is by code review + the table above; add tests for new ones|

The chain provides **tamper evidence**, not tamper resistance. Combine with
filesystem-level controls (`chmod 0600`, `chattr +a` on Linux, S3 Object
Lock for shipped copies) to prevent destruction.

---

## Evidence pack for SOC2 auditors

For an evidence request like *"prove no agent acted on production data
between 2026-01-01 and 2026-03-31 without a consensus checkpoint"*:

```bash
#!/usr/bin/env bash
set -euo pipefail

PERIOD_START="2026-01-01T00:00:00Z"
PERIOD_END="2026-03-31T23:59:59Z"
OUT_DIR="evidence-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

# 1. Verify the live chain before exporting.
aistack audit verify > "$OUT_DIR/verify-live.txt"

# 2. Export the slice.
aistack audit export \
  --since="$PERIOD_START" \
  --until="$PERIOD_END" \
  --format=jsonl \
  -o "$OUT_DIR/audit.jsonl"

# 3. Hash + sign the export for chain-of-custody.
sha256sum "$OUT_DIR/audit.jsonl" > "$OUT_DIR/audit.jsonl.sha256"

# 4. Capture the auditor-readable summary.
aistack audit status > "$OUT_DIR/status.txt"

# 5. Snapshot the schema migration so the auditor can audit our audit.
cp migrations/005_audit_log_chain.sql "$OUT_DIR/"
cp docs/AUDIT.md "$OUT_DIR/"

# 6. Bundle.
tar -czf "$OUT_DIR.tar.gz" "$OUT_DIR"
sha256sum "$OUT_DIR.tar.gz" > "$OUT_DIR.tar.gz.sha256"
echo "Evidence pack: $OUT_DIR.tar.gz"
```

The auditor can independently verify by importing `audit.jsonl` rows back into
a fresh `audit_log_chain` table (same schema) and running
`aistack audit verify` against it — given the HMAC key, the verification is
end-to-end re-runnable on their machine.

---

## API (TypeScript)

```ts
import { audit, getAuditChain, AuditChain } from '@blackms/aistack';
import { getConfig } from '@blackms/aistack/utils/config';

const config = getConfig();

// Fire-and-forget call-site usage (never throws):
audit(config, 'agent.spawn', { agentId, type: 'coder' });

// Direct chain access (CLI, tests):
const chain = getAuditChain(config);
if (chain) {
  const { seq, hash } = chain.append('task.create', { taskId });
  const result = chain.verify();
  for await (const entry of chain.export({ sinceMs: Date.now() - 86_400_000 })) {
    console.log(entry.seq, entry.eventType);
  }
}
```

See [`src/audit/chain.ts`](../src/audit/chain.ts) for the full reference.

---

## Implementation notes

- **Separate DB file**: the audit chain uses its own SQLite handle and its own
  file, so audit writes never interleave with application transactions and a
  corrupted main DB does not corrupt the audit. The cost is two file handles
  and a small amount of duplicated WAL infrastructure.
- **Atomicity**: each `append` runs inside a SQLite `IMMEDIATE` transaction
  so two concurrent appenders cannot read the same `prev_hash` and produce a
  fork.
- **Failure mode**: `audit(...)` swallows errors and logs a warning. Lifecycle
  events must never be blocked by audit failures. If you need fail-loud
  semantics (e.g. for compliance gates), call `getAuditChain().append(...)`
  directly and handle the throw.
- **Payload size cap**: 64 KB per entry, enforced at append. Log a reference
  (`{ entryId, path }`) instead of full content for large data.
