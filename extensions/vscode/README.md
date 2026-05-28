# aistack — VS Code extension

Spawn and orchestrate Claude Code sub-agents from VS Code. Talks to a locally
running [aistack](https://github.com/aigensolutions/aistack) daemon over REST.

## Features

- **Agent Activity sidebar** — live tree of all agents grouped by status, with
  per-agent stop action.
- **Command palette** — `aistack: Spawn Agent`, `View Memory Browser`,
  `Run Review Loop on Selection`, `Stop Agent`, …
- **Keybindings**
  - `Ctrl+Alt+A` / `Cmd+Alt+A` — spawn coder agent on the current selection
  - `Ctrl+Alt+R` / `Cmd+Alt+R` — run review loop on the current selection
- **Status bar** — shows the most recent review loop's iteration / status.
- **Memory webview** — browse stored memory entries with filter.

## Requirements

- aistack daemon running locally (default `http://localhost:3001`).
- VS Code 1.85+.
- Node 20+ (only required when building from source).

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `aistack.daemonUrl` | `http://localhost:3001` | Base URL of the aistack daemon REST API. |
| `aistack.apiToken` | `""` | Optional bearer token. **Prefer** the `AISTACK_API_TOKEN` env var. |
| `aistack.refreshIntervalMs` | `5000` | Polling interval for sidebar / status bar. |
| `aistack.defaultAgentType` | `coder` | Type used by `Spawn Coder Agent on Selection`. |
| `aistack.requestTimeoutMs` | `15000` | HTTP request timeout. |

## Development

```bash
cd extensions/vscode
npm install
npm run compile           # tsc -> out/
# Then: F5 in VS Code launches an Extension Development Host
```

Package locally without publishing:

```bash
npm run package           # produces aistack-vscode-<version>.vsix
code --install-extension aistack-vscode-<version>.vsix
```

## Screenshots

Screenshots are not yet recorded. Placeholders to capture before publishing:

- `media/screenshot-sidebar.png` — Agent Activity sidebar with 3+ agents running.
- `media/screenshot-spawn.png` — `aistack: Spawn Agent` QuickPick.
- `media/screenshot-review.png` — Status bar showing active review loop.
- `media/screenshot-memory.png` — Memory webview with sample entries.

Recording instructions:

1. Boot a local aistack daemon: `npm start` from repo root.
2. Open this extension in a dev host (F5).
3. Spawn 3 agents of different types via the command palette.
4. Trigger a review loop on a selection.
5. Capture each screenshot at 1600x1000 with the default Dark+ theme.
6. Save under `extensions/vscode/media/` and reference them above.

## Publishing checklist (manual)

See [`../../docs/IDE_EXTENSIONS.md`](../../docs/IDE_EXTENSIONS.md) for the
full marketplace-publishing checklist, including `vsce` setup, PAT scopes,
and the Microsoft Partner Center review SLA.

Quick summary:

1. `npm run compile && npm run package` to produce the `.vsix`.
2. Verify `package.json` `version`, `publisher`, `repository.url`, `icon`.
3. `vsce login <publisher>` using a Personal Access Token with
   `Marketplace (Manage)` scope from `dev.azure.com`.
4. `vsce publish` (or upload the `.vsix` via the Marketplace web UI).

## License

MIT.
