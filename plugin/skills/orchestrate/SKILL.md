---
name: aistack-orchestrate
description: Orchestrate a multi-agent run with aistack — pick the right specialized agent (coder, architect, reviewer, researcher, tester, security-auditor, etc.), spawn it via the aistack MCP server, and coordinate handoffs. Use when a task is large enough to benefit from decomposition across specialized agents, or when the user asks to "orchestrate", "spawn an agent", or "run a multi-agent workflow".
---

# aistack: Orchestrate a multi-agent run

aistack turns Claude Code into a multi-agent orchestrator. Instead of one generalist doing everything, you decompose work and route each part to a specialized agent backed by the bundled `aistack` MCP server.

## When to use

- A task spans distinct skills (design + implement + test + review).
- You want a dedicated critic (adversarial / reviewer) separate from the implementer.
- The user explicitly asks to orchestrate, spawn agents, or run a workflow.

For a small, single-step change, do not orchestrate — just do it directly.

## Available agent types

| Type | Best at | Default model |
|---|---|---|
| `coder` | Implement / refactor / debug | sonnet |
| `architect` | System design, trade-offs | opus |
| `reviewer` | Code review against conventions | sonnet |
| `adversarial` | Break the change, find defects | opus |
| `tester` | Write and run tests | sonnet |
| `researcher` | Investigate, gather sources | sonnet |
| `security-auditor` | OWASP-style security review | opus |
| `analyst` | Data / metrics analysis | sonnet |
| `devops` | CI/CD, infra, containers | sonnet |
| `documentation` | Docs and references | sonnet |
| `coordinator` | Plan and route across agents | opus |
| `grader` | Score outcomes against a rubric | sonnet |

## How to orchestrate

1. **Decompose**: break the task into 1–4 sub-tasks, each mapped to one agent type above.
2. **Discover tools**: the `aistack` MCP server exposes `agent_types`, `agent_spawn`, `agent_list`, `agent_status`, `agent_stop`, `task_create`, `task_assign`. List them with `npx @blackms/aistack mcp tools` if unsure.
3. **Spawn**: call `agent_spawn` with the chosen `type` and a focused prompt (include acceptance criteria and the relevant file paths). Spawn background where possible so you can fan out.
4. **Coordinate**: track progress with `agent_list` / `agent_status`. Pass artifacts between agents via shared memory (see the `aistack-memory` skill) rather than re-deriving them.
5. **Converge**: when sub-tasks finish, have a `reviewer` or `adversarial` agent validate the combined result before reporting back.

## Tips

- Keep each agent's prompt narrow — one responsibility. Broad prompts dilute the benefit of specialization.
- Prefer `opus`-backed agents (architect, adversarial, security-auditor, coordinator) for judgment-heavy steps; `sonnet` for execution.
- Export agents as native Claude Code subagents with `npx @blackms/aistack export-agents` if you want to `@`-mention them directly.

> Reference: https://github.com/blackms/aistack
