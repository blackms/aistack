---
name: aistack-memory
description: Use aistack's shared agent memory — store, search, and recall facts, decisions, and artifacts across agents and sessions via the aistack MCP server's memory tools. Use when work needs to persist context between agents or across sessions, when the user asks to "remember", "recall", or "what did we decide about X", or to avoid re-deriving information already established earlier.
---

# aistack: Shared agent memory

aistack gives agents a persistent, searchable memory store (SQLite-backed, optionally vector-indexed). This is how specialized agents hand off context without stuffing everything into one prompt, and how knowledge survives across sessions.

## When to use

- You established a fact, decision, or artifact that a later agent or session will need.
- The user asks to "remember this", "recall what we decided", or "what's the context on X".
- You are about to re-derive something that was likely already computed earlier — search memory first.

## MCP tools (bundled `aistack` server)

| Tool | Purpose |
|---|---|
| `memory_store` | Persist a piece of knowledge (content + optional tags/metadata) |
| `memory_search` | Semantic / keyword search over stored memory |
| `memory_get` | Fetch a specific memory by id |
| `memory_list` | List recent memories |
| `memory_delete` | Remove a memory |

List the exact tool schemas with `npx @blackms/aistack mcp tools`.

## Workflow

### Before starting heavy work — recall
Call `memory_search` with the key terms of the task. If a relevant decision or artifact exists, reuse it instead of redoing the work.

### After establishing something durable — store
Call `memory_store` for:
- Architectural decisions and their rationale ("decided to use X because Y").
- Stable facts about the codebase (entry points, conventions, gotchas).
- Hand-off artifacts between agents (an API contract, a test plan, a research summary).

Write the content so a *future* agent with no context can act on it: be explicit, include file paths, avoid pronouns referring to the current conversation.

### Do NOT store
- Secrets, tokens, credentials.
- Large blobs better kept in files.
- Transient scratch state that will not matter next session.

## Tips

- Tag memories consistently (e.g. by component or issue id) so `memory_search` is precise.
- When orchestrating (see the `aistack-orchestrate` skill), have each agent store its output and the next agent recall it — that is the core handoff mechanism.

> Reference: https://github.com/blackms/aistack
