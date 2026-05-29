# Cline MCP Marketplace — submission draft (NOT yet submitted)

Draft entry for submitting the aistack MCP server to
[cline/mcp-marketplace](https://github.com/cline/mcp-marketplace).

> Status: **DRAFT — local only.** Do not submit until the owner approves the
> one-liner, picks a category, and renders the 400x400 PNG logo. Submission is
> issue-based (open a new issue in `cline/mcp-marketplace`), not a pull request.

## Required submission fields

| Field | Value |
|---|---|
| Server name | aistack |
| GitHub repo URL | https://github.com/blackms/aistack |
| Logo | 400x400 PNG — render from `plugin/assets/logo.svg` (see "Logo" below). <!-- VERIFY: produce final PNG before submitting --> |
| Category | `// VERIFY: pick one of Cline's categories — likely "Developer Tools" or "Agents/Automation"` |
| Author | blackms |
| License | MIT |

## One-liner (for the listing)

> aistack — clean multi-agent orchestration for AI coding agents: spawn
> specialized agents (coder, architect, reviewer, adversarial, security-auditor,
> ...), share searchable memory across them, and gate risky actions behind
> human-in-the-loop consensus checkpoints.

`// VERIFY: confirm final one-liner with owner before submitting.`

## Why this server is useful to Cline users (pitch)

aistack turns a single AI coding agent into a coordinated team. Instead of one
generalist context doing design, implementation, testing, and review in one
thread, aistack lets you decompose work and route each part to a specialized
agent, with:

- **Specialized agents** with sensible model/tool defaults (opus for judgment-heavy
  roles like architect/adversarial/security-auditor; sonnet for execution roles).
- **Shared, searchable memory** (SQLite, optional vector index) so agents hand
  off context instead of re-deriving it, and knowledge survives across sessions.
- **Consensus checkpoints** for human-in-the-loop approval before irreversible
  actions (deploys, migrations, mass edits).
- **GitHub workflow tools** (issues + PRs) to close the loop from task to change.

It is MIT-licensed, installable with one `npx` command, and exposes a single
stdio MCP server.

## Install command (what Cline/agents should run)

The server starts over stdio with:

```bash
npx @blackms/aistack mcp start
```

Standard MCP client config entry:

```json
{
  "mcpServers": {
    "aistack": {
      "command": "npx",
      "args": ["@blackms/aistack", "mcp", "start"]
    }
  }
}
```

Requirements: Node.js >= 20 on PATH. No API key is required to start the server;
provider credentials are configured per project in `aistack.config.json` / `.env`
for agent execution.

## Logo

Cline requires a **400x400 PNG**. The repo ships a typographic placeholder SVG at
`plugin/assets/logo.svg` (400x400 canvas). Render it to PNG before submitting,
e.g.:

```bash
# with rsvg-convert
rsvg-convert -w 400 -h 400 plugin/assets/logo.svg -o aistack-logo-400.png
# or with ImageMagick / Inkscape equivalents
```

`// VERIFY: replace the placeholder with a designed mark if available before submission.`

## Pre-submission checklist (per Cline's README)

- [ ] Repo has a README with clear install instructions (root `README.md` +
      `plugin/README.md` both document the `npx @blackms/aistack mcp start` flow).
- [ ] Tested handing Cline only the README and confirmed it can set up the server
      unattended. `// VERIFY: run this test before submitting — Cline rejects servers it cannot set up from the README.`
- [ ] (Optional) Add a root `llms-install.md` if setup needs extra agent guidance
      (env vars / keys). Likely not required since `npx ... mcp start` is zero-config.
- [ ] 400x400 PNG logo produced.
- [ ] Category and one-liner finalized with owner.

## Submission steps (when approved — DO NOT run yet)

1. Open a new issue in https://github.com/cline/mcp-marketplace using their
   "Server Submission" template.
2. Fill: GitHub repo URL, 400x400 PNG logo, the pitch above, and confirm the
   README-only setup test passed.
3. Await review (Cline team typically reviews within a couple of days).
