# aistack — JetBrains plugin

Spawn and orchestrate Claude Code sub-agents from any IntelliJ-platform IDE
(IntelliJ IDEA, PyCharm, WebStorm, GoLand, Rider, Android Studio, …).

## Features

- **aistack tool window** (right-anchored) — list of agents grouped by status,
  with refresh + stop selected.
- **Editor context-menu actions**
  - `aistack: Spawn Agent on Selection` — `Ctrl+Alt+Shift+A` / `Cmd+Alt+Shift+A`
  - `aistack: Run Review Loop on Selection` — `Ctrl+Alt+R` / `Cmd+Alt+R`
- **Settings panel** — `Settings → Tools → aistack` for daemon URL, optional
  token, refresh interval, request timeout, default agent type.

## Requirements

- aistack daemon running locally (default `http://localhost:3001`).
- IntelliJ 2024.1+ (`since-build = 241`).
- JDK 17+.

## Configuration

| Setting | Default | Notes |
| --- | --- | --- |
| Daemon URL | `http://localhost:3001` | |
| API token | _(empty)_ | Stored in the platform `PasswordSafe` (OS keychain). `AISTACK_API_TOKEN` env var wins over the stored value. |
| Refresh interval | `5000` ms | Tool window polling cadence. |
| Request timeout | `15000` ms | OkHttp connect/read/write timeout. |
| Default agent type | `coder` | Used by `Spawn Agent on Selection`. |

## Development

```bash
cd extensions/jetbrains
./gradlew runIde            # launches a sandboxed IntelliJ Community with the plugin
./gradlew buildPlugin       # produces build/distributions/aistack-jetbrains-<version>.zip
./gradlew verifyPlugin      # marketplace structural validation
```

Install the built zip into any IntelliJ-platform IDE via
`Settings → Plugins → ⚙ → Install Plugin from Disk…`.

## Screenshots

Not yet recorded. Placeholders to capture before marketplace submission:

- `screenshots/toolwindow.png` — tool window with 3+ agents.
- `screenshots/spawn-dialog.png` — `Spawn Agent on Selection` modal.
- `screenshots/settings.png` — `Settings → Tools → aistack`.

Recording instructions:

1. `./gradlew runIde` to launch a sandboxed IDE.
2. Boot the aistack daemon (`npm start` from the repo root).
3. Open a sample project, select code, trigger `Ctrl+Alt+Shift+A`.
4. Capture each screenshot at 1600x1000 with the default Darcula theme.
5. Save under `extensions/jetbrains/screenshots/` and reference them above.

## Publishing checklist (manual)

See [`../../docs/IDE_EXTENSIONS.md`](../../docs/IDE_EXTENSIONS.md) for the
full marketplace submission checklist (signing certificate, marketplace upload
form, JetBrains review SLA).

Quick summary:

1. `./gradlew verifyPlugin` — must pass with **0 errors**.
2. `./gradlew signPlugin` — requires `CERTIFICATE_CHAIN`, `PRIVATE_KEY`,
   `PRIVATE_KEY_PASSWORD` env vars from your JetBrains signing certificate.
3. `./gradlew publishPlugin` with `PUBLISH_TOKEN` env var
   (a token from [hub.jetbrains.com](https://hub.jetbrains.com/) — see docs).
4. Or: upload `build/distributions/aistack-jetbrains-<version>.zip` manually
   via the [JetBrains Marketplace](https://plugins.jetbrains.com/) web form.

## License

MIT.
