# Comparison: aistack vs other agent orchestrators

This document compares aistack to the most commonly evaluated alternatives in the multi-agent / agent-orchestration space. The goal is to give a prospective user an honest signal about **when aistack is the right tool** and when another project would serve them better.

Last updated: 2026-05.

> **Disclaimer.** Feature claims about third-party projects reflect public documentation at time of writing. If something here is inaccurate, please open an issue or PR — we would rather be corrected than mislead a reader.

## TL;DR

- Pick **aistack** if your workflow is in **Claude Code**, you want **multiple specialized agents** reviewing each other's work, and you value **adversarial validation + consensus checkpoints** as first-class primitives.
- Pick **claude-flow** if you want a Claude-Code-aligned multi-agent swarm with broader runtime features (background runner, hive-mind orchestration) and you are comfortable with a less opinionated review pipeline.
- Pick the **Claude Agent SDK** (official Anthropic) if you are building a single-agent app, want minimal abstractions, and intend to bring your own memory/orchestration.
- Pick **Mastra** if you want a TypeScript-native, workflow-graph framework with first-class OpenTelemetry tracing, and you are not tied to Claude Code.
- Pick **LangGraph** if you want a battle-tested state-machine / graph runtime, Python-first, with a large ecosystem (LangSmith, LangChain integrations).
- Pick **CrewAI** for role-based collaboration with a low-code feel; **AutoGen / Microsoft Agent Framework (MAF)** for research-leaning multi-agent conversation; **Letta (MemGPT)** if memory + identity is the dominant axis and you want a hosted option.

## Feature matrix

| Feature | aistack | claude-flow | Claude Agent SDK | Mastra | LangGraph | CrewAI | AutoGen / MAF | Letta |
|---|---|---|---|---|---|---|---|---|
| Primary language | TypeScript | TypeScript | TS + Python | TypeScript | Python (JS port) | Python | Python (.NET) | Python |
| Orchestration model | Multi-agent + message bus | Multi-agent swarm | Single-agent loop | Graph + workflows | Graph (state machine) | Role-based crews | Conversational multi-agent | Stateful agent server |
| Memory persistence | SQLite + FTS5 + optional vectors | SQLite | None (BYO) | LibSQL / Postgres | Checkpointer (Postgres / SQLite / Redis) | Short-term + RAG (BYO store) | BYO | First-class (core feature) |
| Built-in observability | Metrics + web dashboard. OTel: ⚠️ M1 roadmap ([AIG-632](https://linear.app/aigensolutionsit/issue/AIG-632)) | Limited | Tracing via Anthropic API | OTel native + AI tracing | LangSmith (hosted) / OTel | Limited | Limited | Hosted UI |
| Sandboxed execution | ⚠️ M1 roadmap ([AIG-634](https://linear.app/aigensolutionsit/issue/AIG-634)) | Via hooks | Bash tool runs on host | Via tools | Via tools | Via tools | Via tools | Via tools |
| OSS license | MIT | MIT | MIT | Elastic License 2.0 | MIT | MIT | MIT | Apache 2.0 |
| Distribution | NPM | NPM | NPM / PyPI | NPM | PyPI / NPM | PyPI | PyPI / NuGet | PyPI + hosted |
| Claude Code-native (MCP server built-in) | ✅ 46 MCP tools | ✅ | ✅ (it *is* the SDK) | ❌ (MCP client only) | ❌ | ❌ | ❌ | ❌ |
| Adversarial review built-in | ✅ dedicated agent + loop | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Consensus checkpoints | ✅ risk-gated, configurable | ❌ | ❌ | ❌ | ❌ (interrupt-based DIY) | ❌ | ❌ | ❌ |
| Background runner | ⚠️ M1 roadmap ([AIG-636](https://linear.app/aigensolutionsit/issue/AIG-636)) | ✅ | ❌ | ✅ workflows | ✅ | ❌ | ❌ | ✅ |
| Web dashboard (OSS) | ✅ React 18 + MUI | Partial | ❌ | ✅ playground | ❌ (LangSmith is hosted) | ❌ | ❌ | ✅ |

Legend: ✅ = built-in and documented · ❌ = not present · ⚠️ = planned, with linked roadmap issue.

## Honest gaps in aistack today

We mark known gaps explicitly so we cannot be accused of bait-and-switch:

- **Distributed tracing / OpenTelemetry** — partial. We expose Prometheus-style metrics and a health endpoint, but full OTel spans are scheduled for M1 ([AIG-632](https://linear.app/aigensolutionsit/issue/AIG-632)).
- **Sandboxed execution** — agents currently run tools on the host. Docker / E2B-style isolation is M1 ([AIG-634](https://linear.app/aigensolutionsit/issue/AIG-634)).
- **Background runner** — long-lived detached execution is M1 ([AIG-636](https://linear.app/aigensolutionsit/issue/AIG-636)). Today you run inside a session.
- **Cloud-native deployment** — no Docker / Helm / k8s manifests shipped. aistack is designed local-first and NPM-distributed.
- **Multi-tenancy** — single SQLite per deployment. No tenant isolation primitives.
- **Distributed coordination** — single-process EventEmitter bus; no Kafka / Redis Streams / cross-node messaging.

If any of the above is a hard requirement today, one of the alternatives below will fit better.

## Per-project notes

### claude-flow / Ruflo

A Claude-Code-aligned multi-agent runtime with a "swarm" / "hive-mind" model and a broader runtime feature set than aistack today (background daemon, more orchestration knobs). Where it differs philosophically: aistack treats **adversarial review and consensus checkpoints as core primitives** wired into the message bus, not as user-implemented patterns. If you want those out of the box, aistack. If you want the broadest available swarm features and you are comfortable composing your own review pipeline, claude-flow.

### Claude Agent SDK (official Anthropic)

The Claude Agent SDK is intentionally a **thin, low-abstraction loop**: prompt → tool call → result → repeat. It does not ship memory persistence, multi-agent coordination, drift detection, or consensus gating — those are deliberately left to the user or higher-level frameworks. aistack is one such higher-level framework that *uses* an Anthropic-compatible provider underneath and adds the missing pieces. If you want maximum control and minimal magic for a single-agent app, use the SDK directly. If you want a batteries-included multi-agent setup for Claude Code, use aistack.

### Mastra

Mastra is a TypeScript-native agent / workflow framework with strong opinions on **graph-based workflows** and **first-class OpenTelemetry tracing**. It has a polished local playground and clean DX. It is licensed under the Elastic License 2.0 (source-available, restricted for hosted-service competition) rather than a permissive OSI license. Choose Mastra when you want graph workflows in TypeScript with great observability and you do not need a Claude-Code-native MCP server.

### LangGraph

LangGraph is the de-facto Python state-machine runtime for agents, with first-class checkpointing (Postgres / SQLite / Redis), interrupts, time travel, and tight integration with LangSmith for tracing. It is the most battle-tested option for **graph-shaped agent workflows** and has the largest ecosystem. Choose LangGraph if you are Python-first, want a mature state-machine model with rich tooling, and adversarial review / consensus are something you are comfortable building on top.

### CrewAI

CrewAI emphasizes **role-based agent collaboration** ("crews" of agents with goals and backstories) and is popular for low-code multi-agent prototyping. Memory is short-term + BYO RAG. There is no built-in adversarial loop or consensus gate. Choose CrewAI for fast role-based prototyping.

### AutoGen / Microsoft Agent Framework

AutoGen pioneered the **conversational multi-agent** pattern (agents talking to each other in a chat) and has evolved into the Microsoft Agent Framework (MAF) with a stronger production posture and .NET support. Research-leaning. Choose MAF if you are in the Microsoft ecosystem or want the conversational-multi-agent paradigm.

### Letta (formerly MemGPT)

Letta is built around **memory as the central abstraction** — agents have core memory, recall memory, archival memory, and the system manages context windows for you. It ships a hosted server + UI. Choose Letta if memory architecture is the dominant axis of your problem and you are open to a hosted runtime.

## When to use aistack vs alternatives

**Use aistack when:**
- Your workflow lives in **Claude Code** (you want MCP integration without writing your own server).
- You want **multiple specialized agents** (coder + adversarial + reviewer + tester + ...) coordinating on a single task.
- You want **adversarial validation** baked in — code reviewed and attacked before it ships.
- You want **consensus checkpoints** for high-risk operations (deletes, deploys, secret access) with a configurable approval policy.
- You want a **local-first**, **NPM-distributed**, **MIT-licensed** package — no cloud account required.
- Persistent memory (SQLite + FTS5, optional vectors) is sufficient for your scale.

**Choose something else when:**
- You need **Python-first** (→ LangGraph, CrewAI, AutoGen/MAF, Letta).
- You need **production-grade distributed tracing today** (→ Mastra, LangGraph + LangSmith).
- You need **sandboxed code execution today** (→ wait for AIG-634, or use a runtime that wraps E2B / Daytona).
- You need **cloud-native, multi-tenant, horizontally-scalable** orchestration (→ none of these projects truly solves that out of the box; you will be building infra regardless).
- You want **memory as the central design axis** (→ Letta).
- You want a **graph / state-machine** mental model rather than a message-bus + agents model (→ LangGraph, Mastra).

## Contributing to this document

If you spot an inaccuracy about a third-party project — or believe aistack is being unfairly flattered — please open a PR. We would rather correct this page than have a prospective user discover the gap after install.
