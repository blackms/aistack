# aistack daemon (AIG-636)

Background / headless agent runner. Lets aistack live as a long-running
daemon so it can accept tasks from CI/CD, cron, webhooks, or file drops —
without requiring the CLI or web dashboard to be in the foreground.

## Quick start

```bash
# 1. start the daemon (foreground)
aistack daemon start --port=8787

# 2. or detach and run in the background
aistack daemon start --port=8787 --detach

# 3. report status (PID + queue depth, from on-disk state)
aistack daemon status

# 4. stop a running daemon
aistack daemon stop
```

Default data dir: `~/.aistack/daemon/`
- `queue/pending/`   — JSON tasks waiting for a worker
- `queue/inflight/`  — claimed but not yet completed
- `queue/done/`      — terminal state (completed or failed)
- `logs/tasks.log`   — append-only audit log, rotated at 5 MiB
- `daemon.pid`       — present only while the daemon is running

## Three task triggers

### 1. Webhook (HTTP)

```bash
# Configure an HMAC secret (recommended)
export AISTACK_DAEMON_HMAC_SECRET="$(openssl rand -hex 32)"
aistack daemon start --port=8787

# Post a signed task from any client (Node example shown):
node -e '
  const crypto = require("crypto");
  const body = JSON.stringify({ agentType: "coder", input: "refactor file X" });
  const sig = "sha256=" + crypto.createHmac("sha256", process.env.AISTACK_DAEMON_HMAC_SECRET)
    .update(body).digest("hex");
  fetch("http://127.0.0.1:8787/v1/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aistack-signature": sig },
    body,
  }).then(r => r.json()).then(console.log);
'
```

Endpoint contract:
- `POST /v1/tasks` — body `{ agentType: string, input: string, metadata?, id? }` → `202 { taskId, status: "pending" }`
- `GET  /health`   — `200 { status: "ok" }`
- Signature header: `X-Aistack-Signature: sha256=<hex>` (HMAC-SHA256 of the raw body). When `--hmac-secret` is unset, the endpoint is open — protect it at the network layer.

### 2. File watcher

```bash
aistack watch ./inbox --pattern="*.task.json" --agent=coder --read-file
```

Drop a file named `something.task.json` into `./inbox/` and a `coder` agent
task is enqueued with the file's contents as input. Patterns support `*`
and `?`. Use `--no-read-file` (default) to receive the absolute path
instead of the contents — useful for binary or huge payloads.

### 3. Async CLI

```bash
# Fire-and-forget: enqueue and exit. Requires a daemon to be running.
aistack run --agent=coder --input-file=task.json --async
# → { "taskId": "...", "status": "pending", "mode": "async" }

# Inline: starts an ephemeral runtime, waits for completion, prints result.
aistack run --agent=tester --input="run smoke tests"
```

## Configuration

Add a `daemon` section to `aistack.config.json` (all fields optional):

```json
{
  "daemon": {
    "enabled": true,
    "dataDir": "/var/lib/aistack/daemon",
    "queueBackend": "file",
    "webhook": {
      "enabled": true,
      "port": 8787,
      "host": "127.0.0.1",
      "hmacSecret": "${AISTACK_DAEMON_HMAC_SECRET}"
    },
    "maxConcurrent": 4,
    "pollIntervalMs": 500,
    "logRotationBytes": 5242880
  }
}
```

The `${ENV_VAR}` syntax is interpolated at load time — keep secrets in
env vars or a sealed file, never in version control.

## Service install

### Linux (systemd)

```bash
sudo cp templates/systemd/aistack-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aistack-daemon
sudo systemctl status aistack-daemon
```

Adjust `User=`, `WorkingDirectory=`, and `ExecStart=` for your layout.
Use the optional `EnvironmentFile=` directive to mount the HMAC secret.

### Windows (NSSM)

```powershell
# Run as Administrator
.\templates\windows-service\install.ps1 -Port 8787 -HmacSecret <secret>

# Uninstall
.\templates\windows-service\install.ps1 -Remove
```

The script registers an NSSM-managed service that runs
`aistack daemon start ...` on system boot with stdout/stderr rotated
log files under `%ProgramData%\aistack\daemon\logs\`.

## Graceful shutdown

`SIGTERM` (Unix) or stopping the Windows service triggers
`DaemonRuntime.stop()` which:
1. Stops polling for new tasks
2. Waits for all in-flight tasks to settle (`drain()`)
3. Removes the PID file
4. Exits cleanly

Tasks that were `inflight` at the moment of a hard crash are
automatically moved back to `pending/` on the next `start` so no work is
silently dropped.

## Queue backends

| Backend | Status              | Notes                                  |
| ------- | ------------------- | -------------------------------------- |
| `file`  | Default, supported  | Zero deps. Atomic via write-then-rename. |
| `redis` | Stub                | Throws on construction. Add `ioredis` and implement the `Queue` interface to wire it up. |

The `Queue` interface (in `src/daemon/runtime.ts`) is intentionally small
(four methods) so swapping in Redis, SQS, NATS, etc. is straightforward.

## Security notes

- Always set `--hmac-secret` (or `AISTACK_DAEMON_HMAC_SECRET`) before
  exposing the webhook beyond `localhost`.
- The HMAC check uses `crypto.timingSafeEqual` — constant-time compare.
- The webhook caps request bodies at 1 MiB; larger payloads receive
  `413 Payload Too Large`.
- The default bind host is `127.0.0.1`. Override only behind a TLS-
  terminating reverse proxy.
- File queue entries contain raw task input — restrict filesystem
  permissions on the data dir (`chmod 700 ~/.aistack/daemon`).

## Observability

`logs/tasks.log` records one JSON line per lifecycle event
(`enqueue`, `start`, `complete`, `failed`, `recover`). Each line carries
a UTC `ts`, the `taskId`, and event-specific fields, making it trivial to
feed into Loki, CloudWatch, or `jq`.

> OpenTelemetry instrumentation is **not** wired here — it lives under
> AIG-632. The daemon emits internal `EventEmitter` events
> (`task:enqueued`, `task:started`, `task:completed`, `task:failed`) so
> the OTel layer can subscribe without modifying daemon code.
