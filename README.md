<div align="center">

# aistack

## Claude Code's adversarial layer for code that survives review

[![npm version](https://img.shields.io/npm/v/@blackms/aistack?style=for-the-badge&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@blackms/aistack)
[![npm downloads](https://img.shields.io/npm/dw/@blackms/aistack?style=for-the-badge&color=CB3837&logo=npm&logoColor=white&label=downloads%2Fweek)](https://www.npmjs.com/package/@blackms/aistack)
[![GitHub stars](https://img.shields.io/github/stars/blackms/aistack?style=for-the-badge&logo=github&logoColor=white)](https://github.com/blackms/aistack/stargazers)
[![GitHub contributors](https://img.shields.io/github/contributors/blackms/aistack?style=for-the-badge&logo=github&logoColor=white)](https://github.com/blackms/aistack/graphs/contributors)
[![CI](https://img.shields.io/github/actions/workflow/status/blackms/aistack/ci.yml?style=for-the-badge&logo=github&logoColor=white)](https://github.com/blackms/aistack/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/blackms/aistack?style=for-the-badge&logo=codecov&logoColor=white)](https://codecov.io/gh/blackms/aistack)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/uQ6fDXDs7E)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
<!-- M0 followup AIG-655: live counters from stats.aistack.dev once endpoint deployed (review loops run, agents spawned, bugs caught). Will use https://img.shields.io/endpoint?url=https://stats.aistack.dev/loops.json once available. See docs/TELEMETRY.md. -->
<!-- Note: "bugs caught" metric requires a test fixture / reproducible claim — tracked as separate followup. -->

<br/>

**Spawn specialized local agents that write, attack, fix, and gate code before it reaches your PR.**

<br/>

<table>
<tr>
<td align="left" width="33%">
<b>Adversarial code review</b><br/>
Coder and adversarial agents iterate until approval or max rounds.<br/>
<sub>Proof: <code>createReviewLoop</code> plus REST/web review-loop routes.</sub>
</td>
<td align="left" width="33%">
<b>Local-first Claude Code orchestration</b><br/>
Run the NPM package, stdio MCP server, and SQLite memory on your machine.<br/>
<sub>Proof: 46 MCP tools wired into Claude Code.</sub>
</td>
<td align="left" width="33%">
<b>Governable autonomy</b><br/>
Keep agents bounded with consensus checkpoints, drift checks, and resource limits.<br/>
<sub>Proof: risk gates, audit trails, and resource exhaustion monitoring.</sub>
</td>
</tr>
</table>

<br/>

[Quick Start](#-quick-start) · [Who should use](#who-should-use-aistack) · [Features](#-features) · [Documentation](#-documentation)

<br/>

```text
11 agents · 46 MCP tools · 6 LLM providers · SQLite + FTS5 · Web dashboard · HITL Interrupts · A2A · Multi-Tenancy · Issue-to-PR Automation
```

</div>

---

## What It Does

aistack turns Claude Code into a local multi-agent delivery loop: one agent writes, another attacks the result, tests gate the change, and the outcome is captured for the next run.

Use it when a task needs more than one model role:
- **Ship reviewed code** - Coder, tester, reviewer, and adversarial agents iterate until the work is approved or rejected with concrete findings.
- **Keep local control** - The NPM package runs from your machine with a stdio MCP server, SQLite memory, and no hosted control plane requirement.
- **Bound agent autonomy** - Consensus checkpoints, HITL interrupts, semantic drift detection, sandboxed execution, and resource exhaustion monitoring keep risky or runaway work visible.
- **Carry context forward** - Persistent memory stores patterns, decisions, and implementation notes for later Claude Code sessions.
- **Bridge agent runtimes** - Expose aistack agents over A2A, run a background daemon, and ingest GitHub/GitLab issues into draft PR workflows.

### Example workflow

```text
You ask: "Create a login API endpoint with tests"

aistack:
1. Coder writes the endpoint
2. Tester creates and runs focused tests
3. Adversarial tries to break authentication and error paths
4. Coder fixes concrete findings
5. Reviewer gates the final patch
6. Memory stores the project pattern for future work
```

---

## Who should use aistack

- Claude Code users who want local multi-agent coding workflows.
- TypeScript/Node teams that want coder, tester, reviewer, and adversarial agents coordinating through MCP/API.
- Teams that want review loops, persistent SQLite memory, consensus gates, HITL pauses, tenant/workspace controls, and resource monitoring without adopting a hosted agent platform.

## Who should NOT use aistack

- Python-first teams that want LangGraph/CrewAI-style ecosystems.
- Teams that need a managed SaaS control plane or horizontally distributed orchestration today.
- Teams that require managed observability hosting or externally managed queue backends as hard requirements today.

---

## Why aistack

aistack occupies a specific niche: a **Claude Code-native, local-first multi-agent orchestrator** with adversarial validation and consensus checkpoints baked into the core loop. We are not trying to be a general-purpose agent framework (LangGraph, Mastra), nor a hosted product (Letta, LangSmith), nor a thin SDK wrapper (Claude Agent SDK). If your workflow lives inside Claude Code and you want multiple specialized agents reviewing each other's work with persistent memory, aistack is built for you.

We try to stay honest about what is shipped today versus what is on the roadmap — gaps are explicitly marked.

### Comparison vs other agent orchestrators

| Feature | aistack | claude-flow | Claude Agent SDK | Mastra | LangGraph |
|---|---|---|---|---|---|
| Orchestration model | Multi-agent + message bus | Multi-agent (swarm) | Single agent (loop) | Graph + workflows | Graph (state machine) |
| Memory persistence | SQLite + FTS5 + optional vectors | SQLite | None (BYO) | LibSQL / Postgres | Checkpointer (Postgres / SQLite / Redis) |
| Observability | Built-in metrics + web dashboard + opt-in OpenTelemetry tracing | Limited | Tracing via Anthropic API | OTel native + AI tracing | LangSmith (hosted) / OTel |
| Sandboxed execution | ✅ Docker / E2B / Daytona adapters | Via hooks | Bash tool (host) | Via tools | Via tools |
| OSS license | MIT | MIT | MIT | Elastic License 2.0 | MIT |
| Distribution | NPM | NPM | NPM / PyPI | NPM | PyPI / NPM (JS port) |
| Claude Code-native (MCP server built-in) | ✅ 46 MCP tools | ✅ | ✅ (it *is* the SDK) | ❌ (MCP client only) | ❌ |
| Adversarial review built-in | ✅ dedicated agent + loop | ❌ | ❌ | ❌ | ❌ (DIY in graph) |
| Consensus checkpoints | ✅ risk-gated, configurable | ❌ | ❌ | ❌ | ❌ (interrupt-based DIY) |
| Background runner | ✅ daemon + webhook/file triggers | ✅ | ❌ | ✅ workflows | ✅ |

Feature claims for third-party projects reflect public documentation at time of writing; PRs welcome to correct inaccuracies.

**What is uniquely aistack:**
- **Adversarial review loop** as a first-class primitive — a dedicated agent attacks the coder's output up to N iterations until APPROVED.
- **Consensus checkpoints** — high-risk task spawns can require human or different-model approval before proceeding, with full audit trail.
- **Human-in-the-loop interrupts** — workflows can pause, expose editable state, and resume from CLI, web UI, or REST.
- **A2A + issue-to-PR automation** — aistack agents can be exposed to other runtimes and can turn GitHub/GitLab issues into draft PRs.
- **46 MCP tools** wired directly into Claude Code, including memory, identity, drift detection, and consensus management.

→ See [docs/COMPARISON.md](./docs/COMPARISON.md) for the extended analysis including CrewAI, AutoGen, and Letta.

---

## Tech Stack

<table>
<tr>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/nodedotjs/339933" width="64" height="64" alt="Node.js" />
<br/><b>Node.js 20+</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/typescript/3178C6" width="64" height="64" alt="TypeScript" />
<br/><b>TypeScript</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/sqlite/003B57" width="64" height="64" alt="SQLite" />
<br/><b>SQLite + FTS5</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/vitest/6E9F18" width="64" height="64" alt="Vitest" />
<br/><b>Vitest</b>
</td>
</tr>
<tr>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/react/61DAFB" width="64" height="64" alt="React" />
<br/><b>React 18</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/mui/007FFF" width="64" height="64" alt="Material-UI" />
<br/><b>Material-UI</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/vite/646CFF" width="64" height="64" alt="Vite" />
<br/><b>Vite</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/anthropic/191919" width="64" height="64" alt="Anthropic" />
<br/><b>Anthropic</b>
</td>
</tr>
<tr>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/openai/412991" width="64" height="64" alt="OpenAI" />
<br/><b>OpenAI</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/ollama/000000" width="64" height="64" alt="Ollama" />
<br/><b>Ollama</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/github/181717" width="64" height="64" alt="GitHub" />
<br/><b>GitHub Actions</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/npm/CB3837" width="64" height="64" alt="NPM" />
<br/><b>NPM Package</b>
</td>
</tr>
</table>

---

## ✨ Features

### 🤖 11 Specialized Agent Types

Each agent has specific expertise and capabilities:

- **Coder** - Write, edit, and refactor code
- **Researcher** - Search and analyze codebases, gather information
- **Tester** - Write and run tests, coverage analysis
- **Reviewer** - Code review and best practices
- **Adversarial** - Attack code to find vulnerabilities (used in review loops)
- **Architect** - System design and technical decisions
- **Coordinator** - Orchestrate multiple agents for complex tasks
- **Analyst** - Data analysis and performance profiling
- **DevOps** - Deployment, infrastructure, monitoring
- **Documentation** - Generate and maintain documentation
- **Security Auditor** - Security audits, compliance, threat modeling

### 💾 Persistent Memory System

Knowledge that survives across sessions:

- **SQLite with FTS5** - Fast full-text search across all memory
- **Vector Embeddings** - Optional semantic search (OpenAI/Ollama)
- **Namespaces & Tags** - Organize memory by project, topic, or team
- **Version History** - Track changes and rollback if needed
- **Memory Relationships** - Link related concepts together

### 🔄 Adversarial Review Loop

Automatic code improvement through iterative feedback:

1. Coder agent generates code
2. Adversarial agent reviews and tries to break it
3. Coder fixes issues
4. Repeat up to 3 times until approved

Result: More robust, secure code with fewer bugs.

### 🪪 Agent Identity v1

Persistent agent identities with lifecycle management:

- **Stable UUIDs** - Agents have persistent `agent_id` across executions
- **Lifecycle States** - `created` → `active` → `dormant` → `retired`
- **Capabilities Tracking** - Store and version agent capabilities
- **Full Audit Trail** - Every identity change is logged
- **Agent-Scoped Memory** - Memory namespaces owned by specific agents

### 🎯 Semantic Drift Detection

Detect when task descriptions are semantically similar to ancestors:

- **Embedding-based Similarity** - Uses OpenAI or Ollama embeddings
- **Configurable Thresholds** - `threshold` (block/warn) and `warningThreshold` (warn only)
- **Two Behaviors** - `warn` (log and allow) or `prevent` (block creation)
- **Task Relationships** - Track `parent_of`, `derived_from`, `depends_on`, `supersedes`
- **Metrics & Events** - Full logging for drift detection analysis

### 🛡️ Resource Exhaustion Monitoring

Detect and prevent runaway agents consuming excessive resources:

- **Per-Agent Tracking** - Track files accessed, API calls, subtasks spawned, tokens consumed
- **Phase Progression** - `normal` → `warning` → `intervention` → `termination`
- **Configurable Thresholds** - Set limits for each resource type
- **Pause/Resume Control** - Automatically pause agents exceeding thresholds
- **Deliverable Checkpoints** - Reset time-based tracking when agents produce results
- **Slack Notifications** - Alert on warnings, interventions, and terminations

### 🤝 Consensus Checkpoints

Require validation before high-risk tasks can spawn subtasks:

- **Risk-Based Gating** - Configure which risk levels (high, medium, low) require consensus
- **Reviewer Strategies** - Choose from `adversarial`, `different-model`, or `human` reviewers
- **Configurable Risk Estimation** - Define high/medium risk agent types and keyword patterns
- **Task Depth Tracking** - Prevent unbounded task recursion with `maxDepth` limits
- **Checkpoint Lifecycle** - `pending` → `approved`/`rejected`/`expired` with audit trail
- **Timeout & Auto-Expiry** - Checkpoints expire after configurable timeout

### 🧑‍⚖️ Human-In-The-Loop Interrupts

Pause workflows for operator input without rewriting them as callbacks:
- **Promise-Based Pause/Resume** - `interrupt()` suspends normal `async/await` flow until a reviewer supplies input
- **Editable State Snapshots** - Operators can inspect and patch captured workflow state before resuming
- **CLI, Web, and REST Paths** - Resume through `workflow resume-interrupt`, dashboard `/interrupts`, or `/api/v1/interrupts`
- **Validation** - Lightweight schemas or Zod validators reopen invalid resumes for correction

### 🧰 Sandboxed Code Execution

Run model-generated code away from the host machine:
- **Docker Adapter** - Read-only root filesystem, no host volumes, dropped capabilities, resource limits, optional network
- **Managed Adapters** - E2B and Daytona integrations for teams that do not want local Docker
- **Opt-In Execution** - Default provider is `none`; choose a sandbox explicitly in config
- **Security Tests** - Docker argv and managed-provider secret handling are covered in unit tests

### 🕰️ Background Runner & Webhooks

Run aistack headlessly for CI/CD, cron, or external systems:
- **Daemon Mode** - `aistack daemon start` runs a long-lived worker with on-disk queue state
- **Webhook Ingestion** - `POST /v1/tasks` accepts signed task payloads
- **File Watcher** - `aistack watch` turns dropped files into queued agent tasks
- **Async CLI** - `aistack run --async` enqueues work without keeping the shell attached

### 🚢 On-Prem Deployment Packaging

Run the web/API service inside your own infrastructure:
- **Docker Image** - Root `Dockerfile` builds the aistack service image
- **Docker Compose** - Single-host deployment with optional Postgres and OpenTelemetry collector profiles
- **Helm Chart** - `charts/aistack` renders Kubernetes Deployment, Service, ConfigMap, Secret, PVC, ingress, and network policy resources
- **Air-Gapped Path** - Deployment docs cover image/chart export for disconnected environments

### 📈 Observability & Tracing

Instrument local and self-hosted runs without shipping task content to a hosted control plane:
- **OpenTelemetry Tracing** - Opt-in spans for agent execution, LLM calls, MCP tools, memory operations, consensus gates, and review-loop phases
- **OTLP/HTTP Export** - Send traces to Jaeger, Honeycomb, Datadog Agent, Phoenix, or an OpenTelemetry Collector
- **Console Exporter** - Validate spans locally without running a collector
- **Privacy Defaults** - Span attributes include operational metadata only; prompts, generated code, memory content, tool payloads, and secrets are excluded
- **Deployment Docs** - See [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) for collector examples and config details

### 🎯 46 MCP Tools for Claude Code

Control aistack directly from Claude Code IDE:
- 6 agent tools (spawn, list, stop, status, types, update)
- 8 identity tools (create, get, list, update, activate, deactivate, retire, audit)
- 5 memory tools (store, search, get, list, delete) — with agent-scoped memory support
- 13 task tools (create, assign, complete, list, get, check_drift, get_relationships, drift_metrics, + 5 consensus tools)
- 4 session tools (start, end, status, active)
- 3 system tools (status, health, config)
- 7 GitHub tools (issues, PRs, repo info)

### 🔗 A2A Protocol Interop

Expose aistack agents to other agent runtimes:
- **Agent Card** - Serves `/.well-known/a2a-agent-card.json` for capability discovery
- **Message Endpoint** - Accepts A2A v1 task messages at `/v1/a2a/message`
- **CLI Server/Client** - `aistack a2a serve`, `aistack a2a call`, and `aistack a2a card`
- **Scoped Exposure** - Limit advertised skills with `a2a.exposedAgents`

### 🌐 Web Dashboard

Real-time monitoring and control:
- Visual agent management
- Memory browser with search
- Task queue visualization
- Live WebSocket updates
- React 18 + Material-UI
- Dark mode support

### 🏢 Multi-Tenancy Base Layer

Model teams, projects, and RBAC boundaries:
- **Tenant + Workspace Model** - Tenants own one or more workspaces, with tenant-wide or workspace-scoped memberships
- **Opt-In Compatibility** - Disabled by default so existing 1.x single-tenant installs keep working
- **Migration Helper** - `aistack tenant migrate` creates a default tenant/workspace for existing databases
- **Workspace-Aware Flows** - Memory and agent spawning can scope namespaces through the active tenant context
- **REST + UI Hooks** - Tenant routes and `TenantSwitcher` support workspace-aware web flows

### 🔁 Issue-to-PR Automation

Turn GitHub or GitLab issues into reviewed draft PRs:
- **CLI Ingestion** - `aistack ingest issue <url>` fetches an issue and runs the autonomous workflow
- **Webhook Dispatch** - GitHub/GitLab issue events can trigger the same issue-to-PR path
- **Review Log** - Draft PR/MR descriptions include the plan, adversarial review log, and audit link
- **Lifecycle Labels** - Configurable labels mark claimed, in-progress, blocked, and done states

### 🔌 6 LLM Providers

Choose your preferred AI:
- **Anthropic** - Claude Sonnet 4 (recommended)
- **OpenAI** - GPT-4o + embeddings
- **Ollama** - Local models (llama3.2)
- **ClaudeCode CLI** - Direct Claude Code integration
- **Gemini CLI** - Google Gemini 2.0
- **Codex** - GitHub Codex

### 🔐 Security & Auth

Security controls:
- JWT authentication
- BCrypt password hashing
- Role-based access control (Admin, Developer, Viewer)
- Enterprise SSO via SAML 2.0 and OIDC
- SCIM v2 user/group provisioning with bearer-token auth and mutation rate limits
- Security Auditor agent for code review

### 📢 Slack Integration

Real-time notifications to your team:
- **Agent Events** - Spawning, stopping, errors
- **Workflow Updates** - Start, completion, failures
- **Review Loop Progress** - Iteration updates
- **Resource Alerts** - Warnings, interventions, terminations
- **Customizable** - Choose which events to notify

---

## 📚 Documentation

- **[GitHub Wiki](https://github.com/blackms/aistack/wiki)** - Comprehensive user guide (54 pages)
  - Getting Started tutorials
  - Agent guides for all 11 types
  - MCP tools reference
  - Practical recipes and examples
  - Advanced topics (plugins, custom agents, workflows)
  - Complete API reference

- **[Technical Docs](./docs)** - Architecture and implementation details
  - [API.md](./docs/API.md) - MCP tools and programmatic API
  - [ARCHITECTURE.md](./docs/ARCHITECTURE.md) - System architecture
  - [A2A.md](./docs/A2A.md) - Agent-to-Agent protocol server/client
  - [DAEMON.md](./docs/DAEMON.md) - Background runner, webhooks, file watcher
  - [DATA.md](./docs/DATA.md) - Database schemas
  - [DEPLOY.md](./docs/DEPLOY.md) - Docker, Helm, and air-gapped on-prem deployment
  - [DURABLE_EXECUTION.md](./docs/DURABLE_EXECUTION.md) - Checkpointing and resume
  - [GITHUB_INTEGRATION.md](./docs/GITHUB_INTEGRATION.md) - GitHub/GitLab issue-to-PR automation
  - [HITL.md](./docs/HITL.md) - Human-in-the-loop interrupts
  - [MULTITENANT.md](./docs/MULTITENANT.md) - Tenants, workspaces, scoping, and migration
  - [SANDBOX.md](./docs/SANDBOX.md) - Docker/E2B/Daytona sandbox execution
  - [SECURITY.md](./docs/SECURITY.md) - Security model
  - [SSO.md](./docs/SSO.md) - SAML/OIDC SSO and SCIM provisioning
  - [WORKFLOW_DSL.md](./docs/WORKFLOW_DSL.md) - YAML workflow templates
  - [ONBOARDING.md](./docs/ONBOARDING.md) - Developer guide
  - [BENCHMARK.md](./docs/BENCHMARK.md) - SWE-bench Verified plan + reproducible harness

---

## 🚀 Quick Start

### Installation

```bash
npm install @blackms/aistack
```

### Initialize & Connect to Claude Code

```bash
# Initialize project structure
npx @blackms/aistack init

# Add to Claude Code MCP
claude mcp add aistack -- npx @blackms/aistack mcp start

# Verify installation
npx @blackms/aistack status
```

### Start Web Dashboard

```bash
# Start backend + web dashboard
npx @blackms/aistack web start

# Open http://localhost:3001
```

## Use without NPM

aistack ships its 11 expert agents as **native Claude Code subagent definitions**
(`.claude/agents/aistack-*.md`). Once exported, Claude Code can invoke them
directly via `@aistack-coder`, `@aistack-architect`, etc. — no MCP server, no
running aistack process required.

### One-shot export (project-scoped)

```bash
# Generate .claude/agents/aistack-*.md in the current project
npx @blackms/aistack export-agents --project

# Or install for your user (~/.claude/agents/), available in every project
npx @blackms/aistack export-agents --user

# Or pick an explicit directory
npx @blackms/aistack export-agents -o ./my-team/.claude/agents
```

After export, restart Claude Code (or run `/agents` to refresh) and you'll see:

```
@aistack-coder              Write and modify code
@aistack-researcher         Research codebases and documentation
@aistack-tester             Write and run tests
@aistack-reviewer           Review code for quality and security
@aistack-adversarial        Aggressive critical code reviewer (opus)
@aistack-architect          Design system architecture (opus)
@aistack-coordinator        Orchestrate multi-agent workflows (opus)
@aistack-analyst            Analyze data, performance, metrics
@aistack-devops             CI/CD, containers, infrastructure
@aistack-documentation      API docs, guides, tutorials
@aistack-security-auditor   Vulnerability scanning & compliance (opus)
```

Each markdown file is **standalone** — it carries the full agent system prompt
and tool whitelist inline, so you can commit it to your repo and use it on
machines that don't have the aistack package installed. The aistack MCP server
remains optional and adds memory, orchestration, and the web dashboard on top.

### Configuration

Create `aistack.config.json` in your project root:

```json
{
  "version": "1.6.1",
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-sonnet-4-20250514"
    },
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4o"
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "model": "llama3.2"
    }
  },
  "memory": {
    "path": "./data/aistack.db",
    "vectorSearch": {
      "enabled": false,
      "provider": "openai"
    }
  },
  "daemon": {
    "enabled": false,
    "queueBackend": "file",
    "webhook": {
      "enabled": true,
      "port": 8787,
      "host": "127.0.0.1",
      "hmacSecret": "${AISTACK_DAEMON_HMAC_SECRET}"
    },
    "maxConcurrent": 4
  },
  "a2a": {
    "enabled": false,
    "port": 8788,
    "host": "127.0.0.1",
    "publicUrl": "http://127.0.0.1:8788",
    "bearerToken": "${AISTACK_A2A_TOKEN}",
    "exposedAgents": ["coder", "reviewer", "tester"]
  },
  "multitenancy": {
    "enabled": false,
    "defaultTenantSlug": "default",
    "defaultWorkspaceSlug": "default"
  },
  "sandbox": {
    "provider": "none",
    "timeout": 30000,
    "memoryMb": 512,
    "cpus": 1,
    "pidsLimit": 100,
    "network": false
  },
  "observability": {
    "otel": {
      "enabled": false,
      "serviceName": "aistack",
      "exporter": "otlp",
      "endpoint": "http://localhost:4318/v1/traces",
      "samplingRatio": 1
    }
  },
  "github": {
    "enabled": false,
    "useGhCli": true,
    "token": "${GITHUB_TOKEN}",
    "webhookSecret": "${GITHUB_WEBHOOK_SECRET}",
    "gitlabToken": "${GITLAB_TOKEN}",
    "gitlabWebhookSecret": "${GITLAB_WEBHOOK_SECRET}",
    "labels": {
      "claimed": "aistack-claimed",
      "inProgress": "aistack-in-progress",
      "blocked": "aistack-blocked-needs-human",
      "done": "aistack-done"
    }
  },
  "driftDetection": {
    "enabled": false,
    "threshold": 0.95,
    "warningThreshold": 0.8,
    "ancestorDepth": 3,
    "behavior": "warn",
    "asyncEmbedding": true
  },
  "resourceExhaustion": {
    "enabled": false,
    "thresholds": {
      "maxFilesAccessed": 50,
      "maxApiCalls": 100,
      "maxSubtasksSpawned": 20,
      "maxTimeWithoutDeliverableMs": 1800000,
      "maxTokensConsumed": 500000
    },
    "warningThresholdPercent": 0.7,
    "checkIntervalMs": 10000,
    "autoTerminate": false,
    "requireConfirmationOnIntervention": true,
    "pauseOnIntervention": true
  },
  "slack": {
    "enabled": false,
    "webhookUrl": "${SLACK_WEBHOOK_URL}",
    "channel": "#aistack-notifications",
    "notifyOnAgentSpawn": false,
    "notifyOnWorkflowComplete": true,
    "notifyOnErrors": true,
    "notifyOnReviewLoop": true,
    "notifyOnResourceWarning": true,
    "notifyOnResourceIntervention": true
  },
  "consensus": {
    "enabled": false,
    "requireForRiskLevels": ["high", "medium"],
    "reviewerStrategy": "adversarial",
    "timeout": 300000,
    "maxDepth": 5,
    "autoReject": false,
    "highRiskAgentTypes": ["coder", "devops", "security-auditor"],
    "mediumRiskAgentTypes": ["architect", "coordinator", "analyst"],
    "highRiskPatterns": ["delete", "remove", "drop", "deploy", "production", "credentials", "secret", "password", "token", "api key"],
    "mediumRiskPatterns": ["modify", "update", "change", "configure", "install"]
  }
}
```

---

## 💡 Usage Examples

### Example 1: Code Generation with Review

**Via TypeScript**:

```typescript
import { createReviewLoop, getConfig } from '@blackms/aistack';

const result = await createReviewLoop(
  'Create REST API for user authentication',
  getConfig(),
  { maxIterations: 3 }
);

console.log(result.finalVerdict); // APPROVED or REJECTED
console.log(result.currentCode);  // Reviewed code after the final iteration
console.log(result.reviews);      // Concrete findings from each review round
```

**Via REST/web API**:

```bash
# Start the web server first:
npx @blackms/aistack web start

curl -X POST http://localhost:3001/api/v1/review-loops \
  -H 'Content-Type: application/json' \
  -d '{"codeInput":"Create REST API for user authentication","maxIterations":3}'
```

Review loops are not registered as MCP tools yet. Use MCP for agents, memory, tasks,
identity, consensus, sessions, system status, and GitHub tools. Use TypeScript or
REST/web APIs when you want a programmatic review loop, and DSL templates when
you want a reusable workflow file.

**Via DSL template**:

```bash
npx @blackms/aistack workflow run templates/workflows/adversarial-review.yaml \
  --input='{"input":"Create REST API for user authentication"}'
```

### Example 2: Build Institutional Knowledge

**Store patterns as you learn**:
```bash
# Store a coding pattern
npx @blackms/aistack memory store \
  -k "api:error-handling" \
  -c "Always return { success: boolean, data?, error? } structure" \
  -n "best-practices"

# Store an architecture decision
npx @blackms/aistack memory store \
  -k "db:connection" \
  -c "Use connection pooling with max 10 connections" \
  -n "architecture"
```

**Search when you need it**:
```bash
# Find all patterns about error handling
npx @blackms/aistack memory search -q "error handling" -n "best-practices"

# Find architecture decisions about databases
npx @blackms/aistack memory search -q "database" -n "architecture"
```

**In Claude Code**:
```
You: "What's our pattern for API error handling?"
Claude uses memory_search tool: Returns your stored pattern
Claude: "Based on your team's pattern, use { success, data, error } structure"
```

### Example 3: Multi-Agent Collaboration

**Generate feature with tests and docs**:
```typescript
import { spawnAgent, getMemoryManager, getConfig } from '@blackms/aistack';

// 1. Coder writes the feature
const coder = spawnAgent('coder', { name: 'feature-coder' });
const code = await executeTask(coder, 'Create user profile API');

// 2. Tester writes tests
const tester = spawnAgent('tester', { name: 'test-writer' });
const tests = await executeTask(tester, 'Write tests for user profile API');

// 3. Documentation agent generates docs
const docs = spawnAgent('documentation', { name: 'doc-writer' });
const documentation = await executeTask(docs, 'Document user profile API');

// 4. Store the pattern for future use
const memory = getMemoryManager(getConfig());
await memory.store('pattern:user-api', 'User API pattern with tests and docs', {
  namespace: 'patterns',
  metadata: { code, tests, documentation }
});
```

### Example 4: Use in Claude Code

After installing the MCP server:
```bash
claude mcp add aistack -- npx @blackms/aistack mcp start
```

In Claude Code, you can:
```
"Spawn a researcher agent to analyze this codebase"
→ Uses agent_spawn tool

"Store this pattern in memory: Always validate user input"
→ Uses memory_store tool

"Search memory for authentication patterns"
→ Uses memory_search tool

"List all active agents"
→ Uses agent_list tool
```

Review loops are available through the TypeScript API (`createReviewLoop`) and REST/web API, not as MCP tools.

### Example 5: CLI Workflow

```bash
# 1. Start a session
npx @blackms/aistack session start --metadata '{"project": "myapp"}'

# 2. Spawn specialized agents
npx @blackms/aistack agent spawn -t coder -n backend-coder
npx @blackms/aistack agent spawn -t tester -n test-writer
npx @blackms/aistack agent spawn -t reviewer -n code-reviewer

# 3. Run tasks (agents process automatically)
npx @blackms/aistack agent run -t coder -p "Create login endpoint"
npx @blackms/aistack agent run -t tester -p "Test login endpoint"
npx @blackms/aistack agent run -t reviewer -p "Review login code"

# 4. Check system status
npx @blackms/aistack status

# 5. End session
npx @blackms/aistack session end
```

### Example 6: Web Dashboard

```bash
# Start the dashboard
npx @blackms/aistack web start
```

Then open http://localhost:3001 to:
- 👀 **Monitor** all active agents in real-time
- 🧠 **Browse** and search your memory database
- ✅ **Manage** tasks and workflows visually
- 📊 **View** system health and statistics
- 🔄 **Watch** adversarial review loops in progress

### Example 7: HITL Interrupt Review

```typescript
import { interrupt } from '@blackms/aistack';

const target = await interrupt<string>({
  sessionId: 'deploy-2026-05-29',
  prompt: 'Choose deployment target',
  schema: { type: 'enum', enum: ['staging', 'production'] },
  state: { branch: 'main', checks: 'green' },
  notify: ['console', 'slack'],
});

console.log(`Deploying to ${target}`);
```

```bash
npx @blackms/aistack workflow inspect deploy-2026-05-29
npx @blackms/aistack workflow resume-interrupt deploy-2026-05-29 --input='"staging"'
```

### Example 8: A2A Interop

```bash
# Expose local agents as A2A skills
export AISTACK_A2A_TOKEN="$(openssl rand -hex 32)"
npx @blackms/aistack a2a serve --port 8787

# From another shell or runtime, inspect and call the endpoint
npx @blackms/aistack a2a card http://127.0.0.1:8787
npx @blackms/aistack a2a call http://127.0.0.1:8787 "Review this migration plan" --skill reviewer
```

### Example 9: Background Runner

```bash
# Start a signed webhook task receiver
export AISTACK_DAEMON_HMAC_SECRET="$(openssl rand -hex 32)"
npx @blackms/aistack daemon start --port 8787 --detach

# Check queue state
npx @blackms/aistack daemon status

# Watch a folder and enqueue task files
npx @blackms/aistack watch ./inbox --pattern="*.task.json" --agent=coder --read-file
```

### Example 10: Issue-to-PR Automation

```bash
# Dry-run a GitHub issue ingestion
npx @blackms/aistack ingest issue https://github.com/blackms/aistack/issues/42 --dry-run --watch

# Create tenants/workspaces when multi-tenancy is enabled
npx @blackms/aistack tenant migrate
npx @blackms/aistack tenant create --name "Acme Corp" --slug acme --workspace main
```

---

## 📦 MCP Tools

### Agent Tools (6)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `agent_spawn` | Spawn a new agent | `{ type, name?, sessionId?, metadata? }` | `/src/mcp/tools/agent-tools.ts:45` |
| `agent_list` | List active agents | `{ sessionId? }` | `/src/mcp/tools/agent-tools.ts:90` |
| `agent_stop` | Stop an agent | `{ id?, name? }` | `/src/mcp/tools/agent-tools.ts:117` |
| `agent_status` | Get agent status | `{ id?, name? }` | `/src/mcp/tools/agent-tools.ts:144` |
| `agent_types` | List available agent types | `{}` | `/src/mcp/tools/agent-tools.ts:188` |
| `agent_update_status` | Update agent status | `{ id, status }` | `/src/mcp/tools/agent-tools.ts:214` |

### Memory Tools (5)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `memory_store` | Store memory entry | `{ key, content, namespace?, metadata?, agentId? }` | `/src/mcp/tools/memory-tools.ts:48` |
| `memory_search` | Search with FTS5 | `{ query, namespace?, limit?, agentId?, includeShared? }` | `/src/mcp/tools/memory-tools.ts:94` |
| `memory_get` | Get by key | `{ key, namespace? }` | `/src/mcp/tools/memory-tools.ts:145` |
| `memory_list` | List all entries | `{ namespace?, limit?, offset?, agentId?, includeShared? }` | `/src/mcp/tools/memory-tools.ts:182` |
| `memory_delete` | Delete entry | `{ key, namespace? }` | `/src/mcp/tools/memory-tools.ts:221` |

### Identity Tools (8)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `identity_create` | Create agent identity | `{ agentType, displayName?, capabilities?, metadata? }` | `/src/mcp/tools/identity-tools.ts:98` |
| `identity_get` | Get identity by ID or name | `{ agentId?, displayName? }` | `/src/mcp/tools/identity-tools.ts:155` |
| `identity_list` | List identities | `{ status?, agentType?, limit?, offset? }` | `/src/mcp/tools/identity-tools.ts:205` |
| `identity_update` | Update identity metadata | `{ agentId, displayName?, metadata?, capabilities? }` | `/src/mcp/tools/identity-tools.ts:247` |
| `identity_activate` | Activate identity | `{ agentId, actorId? }` | `/src/mcp/tools/identity-tools.ts:311` |
| `identity_deactivate` | Deactivate identity | `{ agentId, reason?, actorId? }` | `/src/mcp/tools/identity-tools.ts:342` |
| `identity_retire` | Retire identity (permanent) | `{ agentId, reason?, actorId? }` | `/src/mcp/tools/identity-tools.ts:378` |
| `identity_audit` | Get audit trail | `{ agentId, limit? }` | `/src/mcp/tools/identity-tools.ts:414` |

### Task Tools (8)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `task_create` | Create task with drift detection | `{ agentType, input?, sessionId?, parentTaskId?, riskLevel? }` | `/src/mcp/tools/task-tools.ts:50` |
| `task_assign` | Assign task to agent | `{ taskId, agentId }` | `/src/mcp/tools/task-tools.ts:138` |
| `task_complete` | Mark task complete | `{ taskId, output?, status? }` | `/src/mcp/tools/task-tools.ts:169` |
| `task_list` | List tasks | `{ sessionId?, status? }` | `/src/mcp/tools/task-tools.ts:206` |
| `task_get` | Get task details | `{ taskId }` | `/src/mcp/tools/task-tools.ts:236` |
| `task_check_drift` | Check for semantic drift | `{ taskInput, taskType, parentTaskId? }` | `/src/mcp/tools/task-tools.ts:273` |
| `task_get_relationships` | Get task relationships | `{ taskId, direction? }` | `/src/mcp/tools/task-tools.ts:328` |
| `task_drift_metrics` | Get drift detection metrics | `{ since? }` | `/src/mcp/tools/task-tools.ts:376` |

### Consensus Tools (5)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `consensus_check` | Check if consensus required | `{ agentType, input?, parentTaskId?, riskLevel? }` | `/src/mcp/tools/task-tools.ts:504` |
| `consensus_list_pending` | List pending checkpoints | `{ limit?, offset? }` | `/src/mcp/tools/task-tools.ts:560` |
| `consensus_get` | Get checkpoint details | `{ checkpointId }` | `/src/mcp/tools/task-tools.ts:610` |
| `consensus_approve` | Approve a checkpoint | `{ checkpointId, reviewedBy, feedback? }` | `/src/mcp/tools/task-tools.ts:670` |
| `consensus_reject` | Reject a checkpoint | `{ checkpointId, reviewedBy, feedback?, rejectedSubtaskIds? }` | `/src/mcp/tools/task-tools.ts:720` |

### Session Tools (4)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `session_start` | Start new session | `{ metadata? }` | `/src/mcp/tools/session-tools.ts:23` |
| `session_end` | End session | `{ sessionId }` | `/src/mcp/tools/session-tools.ts:56` |
| `session_status` | Get session status | `{ sessionId }` | `/src/mcp/tools/session-tools.ts:85` |
| `session_active` | List active sessions | `{}` | `/src/mcp/tools/session-tools.ts:138` |

### System Tools (3)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `system_status` | Get system status | `{}` | `/src/mcp/tools/system-tools.ts:12` |
| `system_health` | Health check | `{}` | `/src/mcp/tools/system-tools.ts:52` |
| `system_config` | Get config | `{}` | `/src/mcp/tools/system-tools.ts:131` |

### GitHub Tools (7)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `github_issue_create` | Create issue | `{ owner, repo, title, body }` | `/src/mcp/tools/github-tools.ts:94` |
| `github_issue_list` | List issues | `{ owner, repo, state? }` | `/src/mcp/tools/github-tools.ts:137` |
| `github_issue_get` | Get issue | `{ owner, repo, number }` | `/src/mcp/tools/github-tools.ts:170` |
| `github_pr_create` | Create PR | `{ owner, repo, title, body, head, base }` | `/src/mcp/tools/github-tools.ts:198` |
| `github_pr_list` | List PRs | `{ owner, repo, state? }` | `/src/mcp/tools/github-tools.ts:240` |
| `github_pr_get` | Get PR | `{ owner, repo, number }` | `/src/mcp/tools/github-tools.ts:273` |
| `github_repo_info` | Get repo info | `{ owner, repo }` | `/src/mcp/tools/github-tools.ts:301` |

**Total: 46 MCP Tools**

> **Note:** Review loop functionality is available via the programmatic API (`createReviewLoop`) and REST/web API, but not exposed as MCP tools.

---

## 💻 Programmatic API

### TypeScript SDK

```typescript
import {
  spawnAgent,
  getMemoryManager,
  startMCPServer,
  getConfig,
  createReviewLoop,
} from '@blackms/aistack';

// Spawn an agent
const agent = spawnAgent('coder', {
  name: 'my-coder',
  metadata: { project: 'awesome-app' }
});

// Use memory with FTS5 search
const memory = getMemoryManager(getConfig());
await memory.store('architecture:pattern', 'Use dependency injection', {
  namespace: 'best-practices',
  tags: ['architecture', 'patterns'],
});

const results = await memory.search('dependency injection');
console.log(results); // FTS5 ranked results

// Start adversarial review loop
const reviewState = await createReviewLoop(
  'Write a secure authentication function',
  getConfig(),
  { maxIterations: 3 }
);

console.log(reviewState.finalVerdict); // APPROVED or REJECTED
console.log(reviewState.currentCode);
console.log(reviewState.reviews); // All review rounds

// Start MCP server
const server = await startMCPServer(getConfig());
console.log('MCP server listening on stdio');
```

### Submodule Imports

```typescript
import { MemoryManager } from '@blackms/aistack/memory';
import { spawnAgent, listAgentTypes, pauseAgent, resumeAgent } from '@blackms/aistack/agents';
import { startMCPServer } from '@blackms/aistack/mcp';
import { getResourceExhaustionService } from '@blackms/aistack/monitoring';

// Direct imports for smaller bundles
const agentTypes = listAgentTypes();
// => ['coder', 'researcher', 'tester', 'reviewer', 'adversarial', 'architect', 'coordinator', 'analyst', 'devops', 'documentation', 'security-auditor']
```

---

## 📂 Project Structure

```
aistack/
├── src/
│   ├── a2a/             # A2A agent card, server, and client
│   ├── agents/          # 11 agent types with system prompts + identity service
│   ├── audit/           # Hash-chained audit log
│   ├── daemon/          # Background runner + queue runtime
│   ├── mcp/             # MCP server + 46 tools
│   ├── memory/          # SQLite + FTS5 + vector search
│   ├── multitenancy/    # Tenants, workspaces, memberships, migration
│   ├── sandbox/         # Docker, E2B, and Daytona execution adapters
│   ├── tasks/           # Drift detection service
│   ├── monitoring/      # Resource exhaustion, metrics, health
│   ├── coordination/    # Task queue, message bus, review loop
│   ├── web/             # REST API + WebSocket server + identity/tenant routes
│   ├── providers/       # 6 LLM provider integrations
│   ├── workflows/       # Multi-phase workflow engine
│   ├── auth/            # JWT, RBAC, SAML/OIDC SSO, SCIM
│   ├── github/          # GitHub/GitLab issues, PRs, webhooks
│   ├── plugins/         # Plugin system
│   ├── hooks/           # Lifecycle hooks
│   └── cli/             # Command-line interface
│
├── web/                 # React 18 dashboard
│   └── src/
│       ├── pages/       # 11 dashboard pages
│       ├── components/  # React components
│       └── stores/      # Zustand state management
│
├── migrations/          # Database migrations
├── tests/               # Unit + integration tests
├── docs/                # Technical documentation
├── charts/aistack/      # Helm chart for on-prem Kubernetes
├── Dockerfile           # Service container image
├── docker-compose.yml   # Single-host deployment
└── .github/workflows/   # CI/CD pipeline
```

---

## 🧪 Development & Testing

### Build & Test

```bash
npm install               # Install dependencies
npm run build             # Build TypeScript to dist/
npm test                  # Run all tests (unit + integration)
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:coverage     # Generate coverage report
npm run typecheck         # Type check without emit
npm run lint              # ESLint
```

### CI/CD Pipeline

GitHub Actions workflow with **5 jobs**:

1. **Lint** - ESLint code quality checks
2. **Typecheck** - TypeScript type validation
3. **Test** - Unit + integration tests via `npm test`
4. **Build** - Production build verification
5. **Coverage** - `npm run test:coverage` on `main` push after tests pass

**Code Coverage:** Uploaded to Codecov after the `main` push coverage job completes

**Code:** `.github/workflows/ci.yml`

### Web Dashboard Development

```bash
npm run dev:web           # Start Vite dev server (hot reload)
npm run build:web         # Build for production
```

---

## ⚠️ What aistack Does NOT Include

To set accurate expectations, here are features **explicitly not implemented**:

- ❌ **GraphQL API** (REST + WebSocket only)
- ❌ **Managed SaaS control plane** (self-hosted/local-first package only)
- ❌ **Provider-specific IaC modules** (no Terraform/CDK/Pulumi templates for AWS, GCP, or Azure)
- ❌ **Turnkey horizontally distributed scheduler/worker cluster** (daemon defaults to local file-backed queue state)
- ⚠️ **No bundled observability backend** - OpenTelemetry tracing is built in, but Grafana, Jaeger, Phoenix, Datadog, Honeycomb, or an OpenTelemetry Collector must be run separately
- ❌ **External queue backend** (Redis/SQS/NATS/Kafka are not bundled; Redis queue is a documented stub)

aistack is **local-first by default** and ships self-host/on-prem packaging. It is not a managed hosted agent platform.

---

## 🗺️ Roadmap

aistack is feature-complete for its primary use case: local Claude Code integration with multi-agent orchestration.

**Current focus areas:**
- Stability and bug fixes
- Documentation improvements
- Community-requested features

**Have an idea?** [Open an issue](https://github.com/blackms/aistack/issues) or join our [Discord](https://discord.gg/uQ6fDXDs7E)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

**PR Requirements:**
- All tests pass (`npm test`)
- Code linted (`npm run lint`)
- Type checked (`npm run typecheck`)
- Build succeeds (`npm run build`)
- Code coverage maintained or improved

---

## 📄 License

[MIT](LICENSE) © 2024

---

<div align="center">

**[Wiki](https://github.com/blackms/aistack/wiki)** · **[Documentation](./docs)** · **[Issues](https://github.com/blackms/aistack/issues)** · **[Discussions](https://github.com/blackms/aistack/discussions)** · **[NPM Package](https://www.npmjs.com/package/@blackms/aistack)**

<sub>Built with TypeScript · Made for Claude Code · Distributed via NPM</sub>

<br/>

---

<br/>

<sub>✅ **README verified against codebase v1.6.1** - Claims reflect implemented code paths for Consensus Checkpoints, HITL Interrupts, A2A, Multi-Tenancy base layer, Sandboxed Execution, Daemon Runner, Issue-to-PR Automation, OpenTelemetry Tracing, On-Prem Packaging, and Session-based Memory Isolation.</sub>

</div>
