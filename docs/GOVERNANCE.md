# Cost Governance (AIG-867)

A cost-governance layer on top of the existing OpenTelemetry usage signal
(`src/observability/tracing.ts`) and multi-tenancy (`src/multitenancy/`). It
derives spend (tokens + estimated USD) from each LLM call, attributes it per
tenant / workspace / project / agent-pattern, and enforces optional budget caps
with a two-stage kill-switch (warn -> block).

## Security default: opt-in, observe-only first

The whole module is **disabled by default**:

```jsonc
// aistack.config.json (defaults shown)
{
  "governance": {
    "enabled": false,          // master switch — module is a no-op when false
    "enforce": {
      "block": false,          // hard kill-switch — OFF by default (observe-only)
      "warnThresholdPercent": 80
    },
    "window": "month"
  }
}
```

- `enabled: false` makes every entry point a no-op (mirrors guardrails AIG-868,
  audit AIG-635, tracing — all off by default).
- `enforce.block: false` means that even with governance **enabled** and a budget
  defined, an over-budget call is **never blocked** — it is only accounted and a
  `cost.budget.warn` / `cost.budget.block` audit event is emitted. This is the
  recommended initial rollout (dry-run / observe-only).
- Hard blocking at 100% requires **explicitly** setting `enforce.block: true`.

This is intentional: a mis-configured budget can never take agents offline unless
an operator opts into blocking.

## Design decisions

| Aspect | Choice |
| --- | --- |
| Unit of cost | Tokens (input/output separately); USD estimated via a configurable price-table. |
| Pricing | Per `(provider, model)` glob, USD per 1M tokens. Unknown model -> **USD 0** (fail-open) but tokens are still aggregated + a warn is logged. Pricing is never a reason to block. |
| Budget scope | Hierarchical: tenant/workspace + project + `agentPattern` (glob on agent type, e.g. `coder`, `review-*`, `*`). Most specific match wins; no budget = unlimited. |
| Kill-switch | Two stages: `warn` at `warnThresholdPercent` (default 80%) -> `block` at 100%. Block throws `CostBudgetExceededError` **before** the LLM call (only when `enforce.block`). Warn/block audit events are idempotent per budget+window. |
| Persistence | Append-only `cost_ledger` table on the shared SQLite store (`config.memory.path`), one row per LLM call, indexed by `(tenant, workspace, ts)` etc. Schema bootstrap is inline + idempotent. |
| Window | Configurable: `day` (calendar), `week` (rolling 7d), `month` (calendar), `total` (all-time). Default `month`. |
| Audit | Kill-switch events go to the existing hash-chained audit log via `audit(config, 'cost.budget.warn'|'cost.budget.block', payload)` (fire-and-forget, no-op when audit disabled). |
| Interface | REST primary (`/api/v1/governance/*`) + a minimal `aistack governance` CLI. |

## Spend attribution

Spend is recorded at the single point where token usage is known — the agent
spawner, right after the `aistack.llm.chat` span:

```
src/agents/spawner.ts  executeAgentInternal()
  ├─ getGovernanceService(config)?.checkBudget({...})   // pre-call (may block)
  ├─ traceAsync('aistack.llm.chat', ...)                // the LLM call
  └─ getGovernanceService(config)?.recordSpend({...})   // post-call accounting
```

Tenant/workspace are read from the agent metadata folded in at spawn
(`tenantId` / `workspaceId`, AIG-649). `project` is an optional free-form label
passed via spawn metadata. In single-tenant mode the spend lands under the
`__default__` bucket and tenant-scoped budgets do not apply.

Recording **only** at this site avoids double counting from the review-loop /
consensus spans (which do not carry `llm.usage.*`). An optional
`GovernanceSpanProcessor` (`src/governance/span-adapter.ts`) is provided for
deployments that wire an in-process OTel SpanProcessor; it must be **mutually
exclusive** with the in-code path to avoid double counting, and is **not** wired
by default.

## Price table

Defaults live in `src/governance/price-table.ts` (`DEFAULT_PRICE_TABLE`) and are
approximate public list prices. Override per-deployment:

```jsonc
{
  "governance": {
    "enabled": true,
    "priceTable": {
      "anthropic": {
        "claude-3-5-sonnet*": { "inputPerMTok": 3, "outputPerMTok": 15 }
      }
    }
  }
}
```

Overrides are merged per provider over the defaults, so you can replace a single
model entry without restating the whole table. Prices **will drift** from real
provider pricing — treat USD as an estimate, tokens as the source of truth.

## Budgets

```jsonc
{
  "governance": {
    "enabled": true,
    "enforce": { "block": true, "warnThresholdPercent": 80 },
    "budgets": [
      { "id": "org-monthly", "limitUsd": 1000, "window": "month" },
      { "id": "tenant-a", "scope": { "tenant": "<tenant-id>" }, "limitUsd": 200 },
      { "id": "coders", "scope": { "agentPattern": "coder" }, "limitTokens": 50000000 }
    ]
  }
}
```

- `scope.tenant` / `scope.workspace` are **ids**, not slugs.
- `agentPattern` is a glob against the concrete agent type.
- Set `limitUsd` and/or `limitTokens`; whichever trips first wins.

## REST endpoints

All read-only (governance is configured via config, not the API). When disabled
they return `{ "enabled": false, ... }` rather than an error.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/governance/status` | Module enabled/block state + ledger summary. |
| GET | `/api/v1/governance/budgets` | Configured budgets. |
| GET | `/api/v1/governance/spend?dimension=tenant\|workspace\|project\|agent&from&to&tenantId&workspaceId&project` | Grouped spend report. `from`/`to` accept epoch-ms or ISO-8601. |

## CLI

Modelled on `aistack audit`:

```bash
aistack governance status
aistack governance budgets [--format table|json]
aistack governance report --dimension tenant|workspace|project|agent \
    [--from <ts>] [--to <ts>] [--format table|json]
```

## Limitations & follow-ups

- **Soft cap, not an atomic quota**: between the pre-call check and the post-call
  record, concurrent calls can slightly overrun a limit. Acceptable for a soft
  budget; documented, not fixed here.
- **Usage-bearing providers only**: spend is tracked only for providers that
  return `chatResponse.usage` (Anthropic / OpenAI / Ollama). CLI providers
  (ClaudeCode / Gemini / Codex) that don't populate usage are not tracked.
- **Ledger growth**: `cost_ledger` is append-only. Retention / rollup is a
  follow-up; rows are indexed by `(tenant, workspace, ts)` for now.

## CI note

These changes add unit tests under `tests/unit/governance/` and an integration
test `tests/integration/governance.test.ts`. They run under the existing
`vitest` suites — no new CI step is required, and `.github/workflows/ci.yml` is
intentionally left untouched (changed in parallel by another branch).
