---
description: Bootstrap aistack in the current project — create config, data dir, and wire the aistack MCP server into Claude Code.
argument-hint: "[--force]"
---

# /aistack-init

Bootstrap aistack orchestration in the **current project**. Run this once per repo.

## What this does

1. Creates `aistack.config.json` with sensible defaults (providers, memory, plugins).
2. Creates a local `data/` directory (SQLite store for memory, tasks, sessions) with a `.gitignore` so the DB is not committed.
3. Confirms the aistack MCP server is reachable via the bundled plugin server (or prints the manual `claude mcp add` command).

## Steps to run

Run the bootstrap. If `aistack.config.json` already exists, pass `--force` to overwrite:

```bash
npx @blackms/aistack init
```

`$ARGUMENTS` is forwarded to the CLI, so `/aistack-init --force` runs `npx @blackms/aistack init --force`.

After init, verify the orchestration tools are available:

```bash
npx @blackms/aistack mcp tools
```

This lists the MCP tools the server exposes (agent_*, memory_*, task_*, consensus_*, session_*, system_*, github_*).

## MCP server

This plugin already declares the `aistack` MCP server (it starts automatically when the plugin is enabled). If you instead want it registered as a standalone user/project MCP server outside the plugin, run:

```bash
claude mcp add aistack -- npx @blackms/aistack mcp start
```

## Next steps

- Configure providers and secrets in `aistack.config.json` / `.env` (see `.env.example` in the aistack repo).
- Export aistack agents as native Claude Code subagents (optional): `npx @blackms/aistack export-agents`.
- Use `/aistack-pm` to run the autonomous backlog loop, or `/aistack-review` for an adversarial review pass.

> Docs: https://github.com/blackms/aistack
