# Battle Pack: Top-5 MCP Server Integrations

aistack's 46 built-in MCP tools cover **internal orchestration** (agents,
memory, identity, tasks, consensus, sessions). The **battle pack** wires the 5
most-adopted community MCP servers so aistack-driven agents can reach the
outside world without bespoke glue.

## What's included

| Provider | Package | What it gives you |
|---|---|---|
| Postgres | `@modelcontextprotocol/server-postgres` | Read-only SQL queries against any Postgres DB |
| GitHub remote | `ghcr.io/github/github-mcp-server` (docker) | Repos, issues, PRs, code search, actions |
| Sentry | `@sentry/mcp-server` | Errors, events, releases — for incident response |
| Playwright | `@playwright/mcp` (Microsoft) | Real-browser automation for E2E + visual tests |
| Slack | `@modelcontextprotocol/server-slack` | Channels, messages, search — bidirectional |

## How it works

aistack does **not** spawn MCP server processes directly. Instead it generates
a `.mcp.json` at your project root from the `integrations` section of
`aistack.config.json`. Claude Code reads that file and spawns the server on
demand. This keeps aistack's process surface small and lets you continue to
use `claude mcp list`, `claude mcp logs`, etc.

```
aistack.config.json  ──►  aistack mcp-bridge sync  ──►  .mcp.json
                                                            │
                                                            ▼
                                                     Claude Code spawns
                                                     MCP servers per session
```

## Setup

### 1. Add the `integrations` section to `aistack.config.json`

```json
{
  "integrations": {
    "postgres": {
      "connectionString": "postgres://user:pass@host:5432/db"
    },
    "githubRemote": {
      "toolsets": ["repos", "issues", "pull_requests"]
    },
    "sentry": {
      "organization": "my-org"
    },
    "playwright": {
      "browser": "chromium",
      "headless": true
    },
    "slack": {
      "channelIds": ["C0123456789"]
    }
  }
}
```

Any field can be `${ENV_VAR}` and will be substituted at load time. Secrets
should always come from env vars — never commit tokens.

### 2. Export the required env vars

| Provider | Required env vars |
|---|---|
| Postgres | `DATABASE_URL` (only if `connectionString` is omitted) |
| GitHub remote | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| Sentry | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` |
| Playwright | _(none — but you need `npx` and a browser installed)_ |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` |

### 3. Generate `.mcp.json`

```bash
aistack mcp-bridge sync
```

Useful flags:

- `--out <path>` — write somewhere other than `./.mcp.json`
- `--dry-run` — print to stdout instead of writing
- `--merge` — preserve existing entries in `.mcp.json` not managed by aistack
- `--skip-missing-env` — skip providers whose required env vars are unset

### 4. Inspect what's wired up

```bash
aistack mcp-bridge list      # adapters + required env vars
aistack mcp-bridge status    # configured vs ready
```

## Example agents

The battle pack ships with two reference agents that demonstrate cross-provider
workflows. Both are auto-registered.

### `incident-responder`

Triages production errors end to end:

1. **Sentry MCP** → fetches the failing event + stack trace
2. **GitHub MCP** → searches for an open issue, opens a new one if needed
3. **Slack MCP** → posts the triage summary to the on-call channel

Spawn it after a Sentry alert fires:

```bash
aistack agent spawn --type incident-responder --task "Triage Sentry issue PROJ-1234"
```

### `browser-tester`

Drives a real browser via Playwright to verify user-facing behavior:

```bash
aistack agent spawn --type browser-tester --task "Verify the signup flow on staging.example.com"
```

## E2E flow: Sentry webhook → triage → GitHub issue

End-to-end smoke test for the `incident-responder` flow:

```bash
# 1. Configure: aistack.config.json has sentry + githubRemote + slack
# 2. Export env: SENTRY_AUTH_TOKEN, SENTRY_ORG, GITHUB_PERSONAL_ACCESS_TOKEN,
#    SLACK_BOT_TOKEN, SLACK_TEAM_ID
# 3. Sync the bridge
aistack mcp-bridge sync

# 4. Trigger the agent (Claude Code spawns Sentry/GitHub/Slack MCP servers on demand)
aistack agent spawn --type incident-responder \
  --task "New Sentry issue: NullPointerException in checkout.ts"

# 5. Verify
#    - GitHub repo has a new issue with severity + Sentry link
#    - Slack on-call channel has a summary
#    - aistack task log shows tool calls to all 3 MCP servers
```

In CI, point a Sentry webhook at a small adapter that POSTs to `aistack web`
and dispatches an `incident-responder` task.

## Troubleshooting

- **`npx` not found** — make sure Node 18+ is on `PATH`; the npm-published
  MCP servers are spawned via `npx -y`.
- **Playwright fails to launch** — run `npx playwright install` once to
  provision browsers.
- **GitHub MCP server: connection refused** — make sure Docker daemon is
  running. To use a non-Docker install, set `integrations.githubRemote.image`
  to a custom value or override `packageName`.
- **Permissions denied on Slack** — the bot token needs the right scopes:
  `channels:read`, `chat:write`, `users:read`, `groups:read`.

## Extending

To add a 6th provider, write a `src/integrations/<provider>.ts` that exports
a `BattlePackAdapter` and register it in `src/integrations/index.ts`'s
`REGISTRY` array. Tests in `tests/unit/integrations/battle-pack.test.ts`
cover the registry contract.
