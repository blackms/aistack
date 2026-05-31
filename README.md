<div align="center">

# aistack

## The adversarial layer where AI code survives review

### A durable, governed control plane for Claude Code multi-agent work — built on top of the natives, not around them

[![npm version](https://img.shields.io/npm/v/@blackms/aistack?style=for-the-badge&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@blackms/aistack)
[![npm downloads](https://img.shields.io/npm/dw/@blackms/aistack?style=for-the-badge&color=CB3837&logo=npm&logoColor=white&label=downloads%2Fweek)](https://www.npmjs.com/package/@blackms/aistack)
[![GitHub stars](https://img.shields.io/github/stars/blackms/aistack?style=for-the-badge&logo=github&logoColor=white)](https://github.com/blackms/aistack/stargazers)
[![CI](https://img.shields.io/github/actions/workflow/status/blackms/aistack/ci.yml?style=for-the-badge&logo=github&logoColor=white)](https://github.com/blackms/aistack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

**Adversarial review loops, consensus gates, durable state, audit trails, and self-host deployment for local-first Claude Code agents.**

<br/>

[Quick Start](#-quick-start) · [Why aistack](#why-aistack) · [Features](#-features) · [Comparison](#-comparison) · [Architecture](#-architecture) · [Docs](#-documentation)

<br/>

```text
11 agents · 46 registered MCP tools · 6 LLM providers · SQLite + FTS5 · OS-style memory tiers
Adversarial review loop · Consensus gates · HITL interrupts · Hash-chained audit log
SSO (SAML/OIDC) + SCIM · Docker + Helm · A2A · Multi-tenancy · Federation (opt-in) · OpenTelemetry
```

</div>

**Three pillars:**

- **Adversarial code review** — a dedicated adversarial agent attacks the coder's output in a structured loop (`createReviewLoop`) until it survives review or is rejected; consensus checkpoints and per-agent resource limits keep autonomy governable.
- **Local-first Claude Code orchestration** — runs as an NPM package on your machine: a stdio MCP server (46 MCP tools), SQLite memory, REST/web API, and a dashboard. No hosted control plane.
- **Governable autonomy** — consensus checkpoints, a hash-chained audit log, and per-agent resource limits gate every high-risk step.

---

## What it is

aistack is a **local-first orchestration layer for Claude Code agents**. One agent writes code, an adversarial agent attacks it, a review loop iterates until the work is approved or rejected, consensus gates hold high-risk actions for human or different-model sign-off, and everything is recorded in a tamper-evident audit log and persistent memory.

It runs as an NPM package on your machine: a stdio MCP server, a SQLite-backed memory store, a REST/WebSocket API, and a web dashboard. No hosted control plane is required.

```text
You ask Claude Code: "Create a login API endpoint with tests"

aistack:
1. Coder writes the endpoint
2. Adversarial agent attacks auth and error paths
3. Coder fixes concrete findings
4. Review loop iterates until APPROVED or REJECTED (default max 3 rounds)
5. Consensus gate (if enabled) holds high-risk steps for approval
6. Audit log + memory capture the outcome for the next session
```

---

## Why aistack

Claude Code in 2026 is no longer just a CLI — it is a full agentic runtime (CLI + IDE + Agent SDK + cloud). Many features that historically justified an external orchestrator are now **native**, and aistack does **not** try to re-implement them. Specifically, Claude Code already covers well:

- **Subagents** — context-isolated delegation and fan-out of independent tasks.
- **Agent Teams** — single-machine multi-agent collaboration with a shared task list, peer messaging, and a dependency graph.
- **Agent View / background agents** — dispatch and monitoring of parallel local sessions, with automatic git worktrees.
- **Hooks** — deterministic, event-driven policy and quality gates across the session lifecycle.
- **Skills + Plugins + Marketplace** — packaging and distribution of reusable workflows.
- **MCP client, Plan Mode, checkpointing, IDE UX, per-repo memory, and cloud scheduling (Routines).**

Where aistack adds value is in the gaps Claude Code **explicitly does not cover**, and that it leaves to whoever builds on the Agent SDK:

1. **Adversarial validation as a first-class primitive** — a dedicated agent attacks the coder's output in a structured loop until APPROVED/REJECTED. Native subagents return text and do not enforce a critic gate.
2. **Consensus / risk gating** — high-risk task spawns can require human or different-model approval, with a full lifecycle and audit trail.
3. **Durable orchestration state** — review loops, tasks, checkpoints, and memory persist in SQLite and replay deterministically, rather than living only for the duration of a session.
4. **Tamper-evident audit** — an append-only, hash-chained log built as evidence material for SOC 2 / ISO 27001 / HIPAA reviews.
5. **Enterprise identity & deployment** — SSO (SAML/OIDC), SCIM provisioning, multi-tenancy, and Docker/Helm packaging for on-prem and air-gapped installs.
6. **Cross-machine federation (opt-in)** — coordinate agents over more than one host, which every native primitive is documented as *not* supporting.

If your workflow lives inside Claude Code and you want adversarial review, consensus governance, persistent state, and self-host deployment — without adopting a hosted agent platform — aistack is built for you. We stay honest about what is shipped today versus what is partial or on the roadmap; gaps are marked explicitly throughout this README.

---

## Who should use aistack

- You work inside Claude Code and want **adversarial review, consensus gating, durable state, and self-host deployment** without adopting a hosted agent platform.
- You need orchestration state that **survives across sessions or machines** (checkpointer, federation) or **enterprise governance** (SSO/SCIM, hash-chained audit, multi-tenancy).
- You want to run agents **on-prem or air-gapped** via Docker + Helm.

## Who should NOT use aistack

- You work **single-machine, single-session, single-repo**: native Claude Code (subagents, Agent Teams, Agent View, hooks, skills) is enough and often better — there is no reason to add aistack.
- You want a managed SaaS control plane: aistack is local-first and self-hosted only.
- You expect features still in development (guardrails wired by default, SWE-bench scores, JetBrains extension): see the partial / roadmap table below.

## 🚀 Quick Start

### Install

```bash
npm install @blackms/aistack
```

### Initialize & connect to Claude Code

```bash
# Initialize project structure (creates aistack.config.json, ./data, etc.)
npx aistack init

# Register the stdio MCP server with Claude Code
claude mcp add aistack -- npx aistack mcp start

# Verify installation
npx aistack status
```

### Run a review loop

```bash
# Programmatic / REST path — start the web server first
npx aistack web start            # serves API + dashboard on http://localhost:3001

curl -X POST http://localhost:3001/api/v1/review-loops \
  -H 'Content-Type: application/json' \
  -d '{"codeInput":"Create REST API for user authentication","maxIterations":3}'
```

### Use the agents without the MCP server

aistack ships its 11 expert agents as **native Claude Code subagent definitions** (`.claude/agents/aistack-*.md`). Once exported, Claude Code invokes them directly (`@aistack-coder`, `@aistack-adversarial`, …) — no MCP server, no running process required.

```bash
npx aistack export-agents --project   # writes .claude/agents/aistack-*.md
npx aistack export-agents --user      # installs into ~/.claude/agents/
```

Each markdown file is standalone (full system prompt + tool whitelist inline), so you can commit it and use it on machines without aistack installed. The MCP server remains optional and adds memory, orchestration, consensus, and the dashboard on top.

---

## ✨ Features

Each feature below links to the real module that implements it. Status is labeled honestly: **Stable**, **Base layer**, **Optional**, **Partial**, or **In development / roadmap**.

### 🔄 Adversarial review loop — *Stable*

A dedicated adversarial agent attacks the coder's output, iterating until `APPROVED`/`REJECTED` or `maxIterations` (default 3), with a concurrency semaphore.
`src/coordination/review-loop.ts` · exposed via the TypeScript API (`createReviewLoop`) and REST/web routes.

> **Note:** the review loop is intentionally **not** registered as an MCP tool. Use the TypeScript API, REST/web API, or a DSL workflow template.

### 🤝 Consensus checkpoints — *Stable*

Require validation before high-risk tasks spawn subtasks. Configurable risk gating, reviewer strategies (`adversarial` / `different-model` / `human`), `maxDepth`, and a `pending → approved/rejected/expired` lifecycle with audit integration.
`src/tasks/consensus-service.ts` · 5 MCP tools (`consensus_check`, `consensus_list_pending`, `consensus_get`, `consensus_approve`, `consensus_reject`).

### 🧑‍⚖️ Human-in-the-loop interrupts — *Stable*

Promise-based pause/resume of `async/await` workflows. Editable state snapshots, schema/Zod validation, pluggable persistence on the checkpointer, console/Slack notify channels, and CLI + web + REST resume paths.
`src/coordination/interrupt.ts` · `aistack workflow resume-interrupt`, dashboard `/interrupts`, `POST /api/v1/interrupts`.

### 🧠 OS-style memory tiers — *Stable*

Three-tier memory (working / recall / archival) with SQL CHECK constraints, gzip compression for the archival tier, and automatic paging. On top of standard SQLite + FTS5 full-text memory.
`src/memory/tiers/` (`tier-manager.ts`, `auto-pager.ts`, `archival.ts`) · migration `009_memory_tiers.sql`.

### 🔐 Tamper-evident audit log — *Stable*

Append-only, hash-chained (SHA-256, genesis block, domain separator, HMAC, 64 KB max payload). Integrated into consensus, identity, and memory flows. Built as evidence material for SOC 2 / ISO 27001 / HIPAA reviews.
`src/audit/chain.ts` · migration `005_audit_log_chain.sql` · [`docs/AUDIT.md`](./docs/AUDIT.md).

> The audit log is the only compliance-related component shipped today. A full SOC 2 readiness pack (control mapping, policies, evidence CLI) is **in development** and not yet in `main`.

### 🪪 Agent identity & lifecycle — *Stable*

Persistent agent identities with stable UUIDs, lifecycle states (`created → active → dormant → retired`), capability versioning, full audit trail, and agent-scoped memory namespaces.
8 identity MCP tools · `src/agents/`.

### 🔑 SSO (SAML/OIDC) + SCIM provisioning — *Stable*

Hardened SAML (replay cache, preflight XXE protection, assertion signing), OIDC with PKCE/state/nonce, and SCIM 2.0 (RFC 7644 subset: bearer auth, mutation rate limits, 409 conflict handling). Plus JWT auth, BCrypt hashing, and RBAC (Admin/Developer/Viewer).
`src/auth/sso/` (`saml.ts`, `oidc.ts`, `scim.ts`) · migration `006_sso_provisioning.sql` · [`docs/SSO.md`](./docs/SSO.md).

### 🚢 Docker + Helm on-prem deployment — *Stable*

Multistage `Dockerfile` (node:20-alpine, target < 200 MB), `docker-compose.yml`/`.dev.yml`, and a complete Helm chart (`charts/aistack`, 11 templates: deployment, service, configmap, secret, PVC, ingress, network policy, PDB, service account, NOTES, helpers). Air-gapped export documented.
[`docs/DEPLOY.md`](./docs/DEPLOY.md).

### 🔗 A2A protocol interop — *Stable*

Expose aistack agents to other agent runtimes. Agent card at `/.well-known/a2a-agent-card.json`, message endpoint, scoped exposure, and CLI serve/call/card.
`src/a2a/` · `aistack a2a serve | call | card`.

### 🏢 Multi-tenancy — *Base layer*

Tenant + workspace + membership/RBAC model. Opt-in (disabled by default so 1.x single-tenant installs keep working), with a migration helper and workspace-aware memory/spawning.
`src/multitenancy/service.ts` · migration `008_multitenant.sql` · `aistack tenant migrate | create`.

### 🧩 MCP battle pack — *Stable*

Bridge integration for the top-5 external MCP servers (Postgres, GitHub, Sentry, Playwright, Slack). A `bridge-sync` generates `.mcp.json` rather than spawning processes.
`src/integrations/index.ts` · `aistack` MCP bridge CLI.

### 📦 Portable agent file — *Stable*

`.aistack-agent` format with schema, bundling, and export to `.claude/agents/*.md`.
`src/agents/portable.ts`, `portable-schema.ts`, `portable-bundle.ts`, `exporter.ts` · [`docs/AGENT_FILE_SPEC.md`](./docs/AGENT_FILE_SPEC.md).

### 📈 OpenTelemetry tracing — *Stable (backend not bundled)*

Opt-in spans for agent execution, LLM calls, MCP tools, memory ops, consensus gates, and review-loop phases. OTLP/HTTP export plus a console exporter. Privacy-by-default: prompts, generated code, memory content, and secrets are never put in span attributes.
`src/observability/tracing.ts` · [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md).

> A trace backend (Jaeger, Honeycomb, Datadog Agent, Phoenix, or an OpenTelemetry Collector) must be run separately — none is bundled.

### 🌐 Multi-machine federation — *Stable (opt-in)*

P2P, opt-in coordination across hosts. mDNS/static/registry discovery with a beacon signer, mTLS transport (CN/SAN pinning, bearer fallback) and egress sanitization (only task metadata is delegated — no code or memory leaves the node).
`src/federation/` (`discovery.ts`, `transport.ts`, `routing.ts`, `server.ts`).

### 🧰 Sandboxed execution — *Stable*

Run model-generated code off the host. Docker adapter (read-only root FS, dropped capabilities, resource limits, optional network) plus managed E2B and Daytona adapters. Default provider is `none` — opt in explicitly.
`src/sandbox/` · [`docs/SANDBOX.md`](./docs/SANDBOX.md).

### ⏯️ Durable execution & checkpointing — *Stable*

Gzip-compressed checkpointer with deterministic replay, backing HITL persistence and workflow resume.
`src/persistence/checkpointer.ts` · migration 004 · [`docs/DURABLE_EXECUTION.md`](./docs/DURABLE_EXECUTION.md).

### 🛰️ Background runner & webhooks — *Stable*

Headless operation for CI/CD, cron, or external systems. Daemon with on-disk queue state, signed webhook ingestion (`POST /v1/tasks`), a file watcher, and async CLI.
`src/daemon/` · `aistack daemon start`, `aistack watch`, `aistack run --async` · [`docs/DAEMON.md`](./docs/DAEMON.md).

### 🔁 Issue-to-PR automation — *Stable*

Turn GitHub/GitLab issues into reviewed draft PRs. CLI ingestion, webhook dispatch, a draft description that includes the plan + adversarial review log + audit link, and configurable lifecycle labels.
`src/github/` · `aistack ingest issue <url>` · [`docs/GITHUB_INTEGRATION.md`](./docs/GITHUB_INTEGRATION.md).

### 🎯 Semantic drift & resource-exhaustion monitoring — *Stable*

Embedding-based drift detection across task ancestors (`warn`/`prevent`), and per-agent resource tracking (files, API calls, subtasks, tokens) with a `normal → warning → intervention → termination` progression and Slack alerts.
`src/tasks/` (drift) · `src/monitoring/` (resource exhaustion).

### 🌙 Additional shipped components — *Stable*

Dreaming memory consolidation (`src/memory/dreaming.ts`), Workflow DSL (YAML) + rubric grading (`src/workflows/dsl/`, `src/workflows/rubric/`), and anonymous opt-in telemetry, disabled by default (`src/telemetry/client.ts`).

### 🌐 Web dashboard — *Stable*

React 18 + Material-UI: agent management, memory browser, task queue, tenant switcher, live WebSocket updates, dark mode.

### 🔌 6 LLM providers — *Stable*

Anthropic (Claude, recommended), OpenAI, Ollama (local), Claude Code CLI, Gemini CLI, Codex.

---

### ⚠️ Partial / optional / in development

These exist but are **not** complete — do not treat them as finished:

| Component | Status | Reality |
|---|---|---|
| **Vector / WASM embeddings** | *Optional* | WASM embedder on `@xenova/transformers` (MiniLM ONNX, lazy load, SHA-256 model pinning) + HNSW index. Works only if the optional dependencies (`@xenova/transformers`, `sqlite-vec`) are installed; the declared WASM heap cap is not yet enforced at runtime. `src/memory/embedding/wasm/`. |
| **Guardrails framework** | *In development (not wired)* | The engine (parallel validators, kill-switch, 200 ms budget, builtin PII / prompt-injection / secrets / Zod validators) is implemented and tested in `src/guardrails/`, but is **not** yet integrated into the review loop or spawner, nor exported from the public package surface. Treat as a standalone library, not a live runtime gate. |
| **VS Code extension** | *Partial* | Real TypeScript extension (activation, spawn/memory/review-loop commands, sidebar, SecretStorage) under `extensions/vscode/`. No automated tests yet. |
| **JetBrains extension** | *Scaffold only* | Gradle/Kotlin scaffold under `extensions/jetbrains/`; no substantial Kotlin implementation yet. |
| **SWE-bench harness** | *Stub* | Reproducible structure under `benchmarks/swe-bench/` (`run.ts`, `baseline.ts`, `aggregate.ts`, Dockerfile), but the aistack-side glue self-declares STUB status and there are no real runs — only `EXAMPLE_OUTPUT.json`. No SWE-bench score is claimed. [`docs/BENCHMARK.md`](./docs/BENCHMARK.md). |
| **SOC 2 readiness pack** | *Roadmap (not in `main`)* | Only the hash-chained audit log ships today. Control mapping, policies, and an evidence CLI exist on an unmerged branch and are **not** in the released package. |
| **Claude Code marketplace plugin bundle** | *Roadmap (not in `main`)* | aistack has an internal plugin **system** (`src/plugins/`), but a distributable Claude Code marketplace bundle (manifest, skills, commands) is on an unmerged branch and not yet shipped. |

---

## 📊 Comparison

Compared along the dimensions that actually differentiate this market — adversarial review/consensus, verifiable benchmarks, enterprise identity, compliance, and self-host deployment — against **Claude Code natively** and three representative competitors.

### vs Claude Code native

| Capability | Claude Code (native) | aistack adds |
|---|---|---|
| Subagents / context isolation | ✅ built-in | Reuses it — exports agents as native subagent files |
| Multi-agent on one machine | ✅ Agent Teams (shared task list, messaging) | Does not duplicate; layers governance on top |
| Parallel session dispatch/monitor | ✅ Agent View + worktrees | Does not duplicate |
| Event-driven policy gates | ✅ Hooks | Should be used via hooks, not re-implemented |
| MCP client, Plan Mode, scheduling | ✅ native | Reuses them |
| **Adversarial review loop** | ❌ subagents return text, no critic gate | ✅ structured coder↔adversarial loop |
| **Consensus / risk gating** | ❌ | ✅ risk-gated, human/different-model, audited |
| **Durable orchestration state** | ❌ team/session state is ephemeral | ✅ SQLite + deterministic replay |
| **Tamper-evident audit log** | ❌ | ✅ hash-chained |
| **SSO (SAML/OIDC) + SCIM** | ❌ | ✅ |
| **Multi-tenancy** | ❌ | ✅ base layer |
| **Cross-machine federation** | ❌ all natives are single-machine | ✅ opt-in, mTLS |
| **Docker / Helm self-host** | ❌ | ✅ chart + air-gapped path |

### vs other orchestrators

| Dimension | aistack | claude-flow / Ruflo | Factory (Droids) | OpenHands |
|---|---|---|---|---|
| **Adversarial review / consensus gate** | ✅ review loop + consensus, audited | Claimed; enforcement publicly contested | Droid Review (PR) | ✅ real critic model |
| **SWE-bench Verified** | Not claimed (harness is a stub) | claimed (self-reported), non verificato | claimed (self-reported), non verificato | claimed (self-reported), non verificato |
| **SSO (SAML/OIDC) + SCIM** | ✅ | ❌ | ✅ | ✅ (enterprise) |
| **Compliance (SOC 2 / ISO)** | Audit log only; SOC 2 pack on roadmap | non dichiarato | claimed (self-reported), non verificato | claimed (self-reported), non verificato |
| **Self-host (Docker/Helm/VPC/air-gap)** | ✅ Docker + Helm, air-gapped path | Docker/K8s OSS, not managed | Airgapped / on-prem / single-tenant VPC | ✅ Helm / K8s / VPC |
| **Persistent memory** | SQLite + FTS5 + OS-style tiers + optional vectors | SQLite + HNSW | DevinDB-style (proprietary) | Microagents |
| **Federation (multi-machine)** | ✅ opt-in, mTLS | Claimed | — | — |
| **Model** | OSS (MIT), local-first NPM | OSS (MIT) | Commercial SaaS | OSS core + source-available enterprise |

> ⚠️ **I dati dei concorrenti sono di terzi, raccolti da fonti pubbliche (leaderboard e blog dei vendor) e NON sono stati verificati in modo indipendente.** Sono in larga parte autodichiarati (self-reported), possono non essere direttamente comparabili e possono cambiare. Il numero SWE-bench attribuito altrove a claude-flow (≈84.8%) è self-reported e pubblicamente contestato. L'unica riga verificata sull'inventario del repository è quella di aistack, che **non** pubblica alcun numero SWE-bench perché il suo harness è ancora uno stub. PR benvenute per correggere eventuali inesattezze.

→ See [`docs/COMPARISON.md`](./docs/COMPARISON.md) for the extended analysis.

---

## 🏗️ Architecture

```text
                         Claude Code (CLI · IDE · Agent SDK)
                                        │
                       MCP (stdio) · REST · WebSocket · A2A
                                        │
┌───────────────────────────────────────────────────────────────────────────┐
│                                  aistack                                     │
│                                                                             │
│  Orchestration                Governance               Interop / Deploy      │
│  ─────────────                ──────────               ─────────────────     │
│  review-loop (coder↔adv)      consensus gates          A2A server/client     │
│  task queue + message bus     HITL interrupts          MCP battle pack       │
│  workflow DSL + rubric        hash-chained audit       daemon + webhooks     │
│  drift + resource monitor     SSO (SAML/OIDC) + SCIM   issue-to-PR (GH/GL)   │
│                               multi-tenancy            Docker + Helm chart   │
│                                                        federation (opt-in)   │
│                                                                             │
│  State & memory                          Execution                           │
│  ──────────────                          ─────────                           │
│  SQLite + FTS5 + memory tiers            sandbox (Docker / E2B / Daytona)     │
│  durable checkpointer (gzip, replay)     6 LLM providers                      │
│  migrations 004–009                      OpenTelemetry tracing (opt-in)       │
└───────────────────────────────────────────────────────────────────────────┘
```

```text
aistack/
├── src/
│   ├── a2a/            # A2A agent card, server, client
│   ├── agents/         # 11 agent types + identity + portable agent file
│   ├── audit/          # Hash-chained audit log
│   ├── auth/           # JWT, RBAC, SAML/OIDC SSO, SCIM
│   ├── coordination/   # Review loop, task queue, message bus, HITL interrupt
│   ├── daemon/         # Background runner + queue runtime
│   ├── federation/     # Opt-in multi-machine discovery/transport/routing
│   ├── github/         # GitHub/GitLab issues, PRs, webhooks
│   ├── guardrails/     # Validators engine (not yet wired into the core loop)
│   ├── integrations/   # MCP battle pack (Postgres/GitHub/Sentry/Playwright/Slack)
│   ├── mcp/            # MCP server + tool sets
│   ├── memory/         # SQLite + FTS5, tiers, dreaming, optional WASM embeddings
│   ├── multitenancy/   # Tenants, workspaces, memberships, migration
│   ├── observability/  # OpenTelemetry tracing
│   ├── persistence/    # Durable checkpointer
│   ├── plugins/        # Internal plugin system
│   ├── providers/      # 6 LLM provider integrations
│   ├── sandbox/        # Docker / E2B / Daytona execution adapters
│   ├── tasks/          # Consensus service + drift detection
│   ├── telemetry/      # Anonymous opt-in telemetry (disabled by default)
│   ├── web/            # REST API + WebSocket + identity/tenant routes
│   ├── workflows/      # DSL + rubric grading
│   └── cli/            # Command-line interface
│
├── web/                # React 18 + Material-UI dashboard
├── charts/aistack/     # Helm chart for on-prem Kubernetes
├── migrations/         # SQL migrations (004–009)
├── benchmarks/         # SWE-bench harness (stub)
├── extensions/         # VS Code (partial) + JetBrains (scaffold)
├── Dockerfile          # Service container image (multistage)
└── docker-compose.yml  # Single-host deployment
```

---

## 📦 MCP tools

The MCP server registers **7 tool sets** for Claude Code:

| Set | Count | Tools |
|---|---|---|
| Agent | 6 | `agent_spawn`, `agent_list`, `agent_stop`, `agent_status`, `agent_types`, `agent_update_status` |
| Identity | 8 | `identity_create/get/list/update/activate/deactivate/retire/audit` |
| Memory | 5 | `memory_store/search/get/list/delete` (agent-scoped support) |
| Task | 13 | `task_create/assign/complete/list/get/check_drift/get_relationships/drift_metrics` + 5 consensus tools |
| Session | 4 | `session_start/end/status/active` |
| System | 3 | `system_status/health/config` |
| GitHub | 7 | `github_issue_*`, `github_pr_*`, `github_repo_info` |

**Total: 46 registered MCP tools.** The adversarial review loop is intentionally available only via the TypeScript API (`createReviewLoop`), REST/web API, and DSL templates — **not** as an MCP tool.

---

## 💻 Programmatic API

```typescript
import {
  spawnAgent,
  getMemoryManager,
  startMCPServer,
  getConfig,
  createReviewLoop,
  interrupt,
  initializeTracing,
} from '@blackms/aistack';

// Adversarial review loop
const review = await createReviewLoop(
  'Write a secure authentication function',
  getConfig(),
  { maxIterations: 3 }
);
console.log(review.finalVerdict); // APPROVED | REJECTED
console.log(review.currentCode);
console.log(review.reviews);      // findings per round

// Persistent memory with FTS5
const memory = getMemoryManager(getConfig());
await memory.store('architecture:pattern', 'Use dependency injection', {
  namespace: 'best-practices',
});
const hits = await memory.search('dependency injection');

// HITL interrupt
const target = await interrupt<string>({
  sessionId: 'deploy-2026-05-31',
  prompt: 'Choose deployment target',
  schema: { type: 'enum', enum: ['staging', 'production'] },
  notify: ['console', 'slack'],
});

// MCP server
const server = await startMCPServer(getConfig());
```

Submodule entry points: `@blackms/aistack/memory`, `@blackms/aistack/agents`, `@blackms/aistack/mcp`.

---

## ⚙️ Configuration

Create `aistack.config.json` in your project root (everything below is opt-in / disabled by default unless noted):

```json
{
  "version": "1.6.1",
  "providers": {
    "default": "anthropic",
    "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}", "model": "claude-sonnet-4-20250514" }
  },
  "memory": { "path": "./data/aistack.db", "vectorSearch": { "enabled": false, "provider": "openai" } },
  "consensus": {
    "enabled": false,
    "requireForRiskLevels": ["high", "medium"],
    "reviewerStrategy": "adversarial",
    "maxDepth": 5
  },
  "multitenancy": { "enabled": false, "defaultTenantSlug": "default", "defaultWorkspaceSlug": "default" },
  "sandbox": { "provider": "none", "memoryMb": 512, "cpus": 1, "network": false },
  "observability": { "otel": { "enabled": false, "endpoint": "http://localhost:4318/v1/traces" } },
  "a2a": { "enabled": false, "port": 8788, "bearerToken": "${AISTACK_A2A_TOKEN}", "exposedAgents": ["coder", "reviewer", "tester"] },
  "daemon": { "enabled": false, "queueBackend": "file", "maxConcurrent": 4 },
  "github": { "enabled": false, "useGhCli": true, "token": "${GITHUB_TOKEN}" }
}
```

See the [Quick Start configuration docs](./docs) for the full reference (drift detection, resource-exhaustion thresholds, Slack, SSO, webhook HMAC).

---

## 🧪 Development & testing

```bash
npm install
npm run build             # tsc → dist/
npm test                  # unit + integration
npm run test:unit
npm run test:integration
npm run test:coverage
npm run typecheck
npm run lint
npm run dev:web           # Vite dev server for the dashboard
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, build, and a coverage job on `main`.

---

## ⚠️ What aistack does NOT include

To set accurate expectations, these are **explicitly not implemented**:

- ❌ **GraphQL API** (REST + WebSocket only)
- ❌ **Managed SaaS control plane** (self-hosted / local-first package only)
- ❌ **Provider-specific IaC modules** (no Terraform / CDK / Pulumi templates)
- ❌ **Turnkey distributed scheduler/worker cluster** (daemon defaults to a local file-backed queue)
- ❌ **External queue backend** (Redis/SQS/NATS/Kafka not bundled; Redis queue is a documented stub)
- ⚠️ **No bundled observability backend** — OTel tracing is built in, but Jaeger/Grafana/Phoenix/Datadog/Honeycomb/Collector run separately
- ⚠️ **Guardrails not wired into the runtime**, **SWE-bench harness is a stub**, **JetBrains extension is a scaffold**, **SOC 2 pack and marketplace bundle are on roadmap** (see the partial/optional table above)

aistack does **not** re-implement Claude Code natives (subagents, Agent Teams, Agent View, hooks, skills, MCP client, plan mode, checkpointing, cloud scheduling). It builds on top of them.

---

## 📚 Documentation

- [API.md](./docs/API.md) · [ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [COMPARISON.md](./docs/COMPARISON.md)
- [A2A.md](./docs/A2A.md) · [DAEMON.md](./docs/DAEMON.md) · [DATA.md](./docs/DATA.md)
- [DEPLOY.md](./docs/DEPLOY.md) · [DURABLE_EXECUTION.md](./docs/DURABLE_EXECUTION.md)
- [AUDIT.md](./docs/AUDIT.md) · [SSO.md](./docs/SSO.md) · [SECURITY.md](./docs/SECURITY.md)
- [HITL.md](./docs/HITL.md) · [MULTITENANT.md](./docs/MULTITENANT.md) · [SANDBOX.md](./docs/SANDBOX.md)
- [OBSERVABILITY.md](./docs/OBSERVABILITY.md) · [AGENT_FILE_SPEC.md](./docs/AGENT_FILE_SPEC.md)
- [GITHUB_INTEGRATION.md](./docs/GITHUB_INTEGRATION.md) · [WORKFLOW_DSL.md](./docs/WORKFLOW_DSL.md)
- [BENCHMARK.md](./docs/BENCHMARK.md) · [ONBOARDING.md](./docs/ONBOARDING.md)
- **[GitHub Wiki](https://github.com/blackms/aistack/wiki)** — full user guide

---

## 🤝 Contributing

1. Fork and branch (`git checkout -b feature/amazing`)
2. Keep tests, lint, typecheck, and build green
3. Open a PR

PR requirements: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all pass; coverage maintained or improved.

---

## 📄 Changelog & license

- **Changelog:** [CHANGELOG.md](./CHANGELOG.md)
- **License:** [MIT](LICENSE)

---

<div align="center">

**[Wiki](https://github.com/blackms/aistack/wiki)** · **[Docs](./docs)** · **[Issues](https://github.com/blackms/aistack/issues)** · **[Discussions](https://github.com/blackms/aistack/discussions)** · **[NPM](https://www.npmjs.com/package/@blackms/aistack)**

<sub>Built on the Claude Agent SDK · local-first · MIT · README verified against codebase v1.6.1</sub>

</div>
