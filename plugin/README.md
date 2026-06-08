# aistack — Claude Code plugin

Clean **multi-agent orchestration** for Claude Code. This plugin bundles the
aistack MCP server together with ready-to-use slash commands and skills, so you
can spawn specialized agents, share memory across them, gate risky actions
behind human approval, and drive an autonomous backlog loop — all from inside
Claude Code.

This plugin is a thin packaging wrapper around the
[`@blackms/aistack`](https://github.com/blackms/aistack) core. The MCP server is
launched on demand via `npx @blackms/aistack mcp start`; the plugin version is
kept in sync with the core package version.

- Repo: https://github.com/blackms/aistack
- License: MIT
- Author: blackms

## Requirements

- Claude Code with the plugin system enabled.
- Node.js >= 20 on PATH (the MCP server runs via `npx`).
- First run downloads `@blackms/aistack` via `npx` (or install it globally:
  `npm install -g @blackms/aistack`).

## Install (one command flow)

Add the marketplace, then install the plugin:

```text
/plugin marketplace add blackms/aistack
/plugin install aistack
```

> `blackms/aistack` resolves to this GitHub repository. The marketplace catalog
> lives at the repo root in `.claude-plugin/marketplace.json`. If that catalog
> has not been published yet, you can point Claude Code straight at the bundle
> for local testing:
>
> ```bash
> claude --plugin-dir ./plugin
> ```

When the plugin is enabled, the bundled `aistack` MCP server starts
automatically — no separate `claude mcp add` step is required. To register the
server standalone instead (outside the plugin), run:

```bash
claude mcp add aistack -- npx @blackms/aistack mcp start
```

## What's in the bundle

### MCP server

| Server | Start command | Tools |
|---|---|---|
| `aistack` | `npx @blackms/aistack mcp start` (stdio) | agent_*, identity_*, memory_*, task_*, consensus_*, session_*, system_*, github_* |

List the live tool set any time with `npx @blackms/aistack mcp tools`.

### Slash commands (`commands/`)

| Command | What it does |
|---|---|
| `/aistack-init` | Bootstrap aistack config + data dir in the current project |
| `/aistack-pm` | Autonomous PM/PgM backlog loop (one issue per tick; pairs with `/loop`) |
| `/aistack-review` | Adversarial review loop over the current diff (critic + steelman + verdict) |

### Skills (`skills/`)

| Skill | What it does |
|---|---|
| `aistack-orchestrate` | Decompose a task and route parts to specialized agents |
| `aistack-memory` | Store / search / recall shared agent memory across sessions |
| `aistack-consensus` | Human-in-the-loop approval gates before risky actions |

## Examples

**Bootstrap a project and confirm the tools are live:**

```text
/aistack-init
```
```bash
npx @blackms/aistack mcp tools
```

**Orchestrate a multi-agent change** — ask Claude:

> "Use aistack to orchestrate this: have an architect propose the design, a
> coder implement it, then an adversarial agent review the diff."

The `aistack-orchestrate` skill maps each part to an agent type and spawns it
via the `aistack` MCP server (`agent_spawn`).

**Run an autonomous backlog tick on an interval:**

```text
/loop 5m /aistack-pm
```

**Review a branch before merging:**

```text
/aistack-review branch
```

**Gate a deploy behind approval** — ask Claude:

> "Before deploying, open an aistack consensus checkpoint and wait for my
> approval."

The `aistack-consensus` skill calls `consensus_check` and pauses until
`consensus_approve`.

## Versioning

The plugin `version` in `.claude-plugin/plugin.json` tracks the `@blackms/aistack`
core package version. Bump them together on each release.

## Links

- aistack core + full docs: https://github.com/blackms/aistack
- Marketplace submission draft: [`marketplace/cline-submission.md`](./marketplace/cline-submission.md)
