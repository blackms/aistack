# GitHub / GitLab issue → draft PR integration (AIG-637)

aistack can take an external issue (GitHub or GitLab), spawn a coordinator +
coder + adversarial-reviewer agent triad, and open a draft pull/merge request
with the plan, review log, and an audit link embedded in the description.

The same workflow is reachable two ways:

- **CLI** — `aistack ingest issue <url>` for manual runs and automation.
- **Webhook** — `POST /v1/github/webhook` (or `/v1/gitlab/webhook`) for the
  "issue assigned to bot" pattern popularised by Devin / Copilot Coding Agent.

## Configuration

Add to `aistack.config.json`:

```json
{
  "github": {
    "enabled": true,
    "token": "${GITHUB_TOKEN}",
    "webhookSecret": "${GITHUB_WEBHOOK_SECRET}",
    "gitlabToken": "${GITLAB_TOKEN}",
    "gitlabWebhookSecret": "${GITLAB_WEBHOOK_SECRET}",
    "labels": {
      "claimed": "aistack-claimed",
      "inProgress": "aistack-in-progress",
      "blocked": "aistack-blocked-needs-human",
      "done": "aistack-done"
    },
    "auditUrlTemplate": "https://aistack.example.com/audit/{provider}/{owner}/{repo}/{number}"
  }
}
```

Environment variables consumed when the corresponding config value is unset:

| Variable                 | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `GITHUB_TOKEN`           | PAT used for GitHub REST calls.                 |
| `GH_TOKEN`               | Fallback for `GITHUB_TOKEN`.                    |
| `GITLAB_TOKEN`           | PAT used for GitLab REST calls.                 |
| `GITHUB_WEBHOOK_SECRET`  | HMAC secret for `X-Hub-Signature-256`.          |
| `GITLAB_WEBHOOK_SECRET`  | Legacy shared token compared against `X-Gitlab-Token`. |

## CLI usage

```bash
# Run end-to-end against a GitHub issue
aistack ingest issue https://github.com/octocat/hello-world/issues/42

# Dry run — no PR, no label writes
aistack ingest issue https://github.com/octocat/hello-world/issues/42 --dry-run --no-labels

# GitLab works identically
aistack ingest issue https://gitlab.com/group/sub/proj/-/issues/9 --watch
```

Output reports the workflow status (`success`, `blocked`, `failed`), the
generated branch name, the number of review iterations, and the URL of the
draft PR/MR when one was created.

## Webhook setup (GitHub)

1. **Provision a bot account** and grant it write access to the target repo.
2. **Generate a PAT** with the `repo` scope and put it in `GITHUB_TOKEN`.
3. **Start the webhook listener** with an `IntegrationRouter`, then call
   `registerGitHubWebhook(server, config)` from your bootstrap module.
4. **Register the webhook** on the repo:
   - Payload URL: `https://your-host/v1/github/webhook`
   - Content type: `application/json`
   - Secret: same value used in `github.webhookSecret`
   - Events: `Issues`, `Pull requests`
5. **Trigger**: assign an issue to the bot account or apply the
   `aistack-claimed` label — the listener dispatches
   `runIssueToPRWorkflow()` and answers `202 { "dispatched": true }`.

## Webhook setup (GitLab)

1. Settings → Webhooks → URL: `https://your-host/v1/gitlab/webhook`
2. Secret token: same value used in `github.gitlabWebhookSecret`
3. Triggers: **Issues events**
4. Assign an issue to the bot user to dispatch the workflow.

The GitLab adapter currently supports the legacy shared-secret token echo
mode for `X-Gitlab-Token`. Terminate TLS at the edge and keep GitLab SSL
verification enabled. Group-level HMAC-style GitLab webhook verification is
not implemented in this adapter.

## Lifecycle labels

The coordinator writes the following labels on the source issue:

| Phase             | Default label                  |
| ----------------- | ------------------------------ |
| Claimed           | `aistack-claimed`              |
| In progress       | `aistack-in-progress`          |
| Blocked / failed  | `aistack-blocked-needs-human`  |
| Done              | `aistack-done`                 |

Override any of these via `github.labels.*`. Existing lifecycle labels from
this table are replaced atomically on each transition so the issue only
carries one phase label at a time; unrelated user labels are preserved.

## E2E test fixture

`tests/unit/github/webhook.test.ts` spins up a real `IntegrationRouter` on
a random port and exercises:

- HMAC verification (pass / fail).
- `ping` health-check response.
- Non-actionable events returning `202 dispatched=false`.

For full end-to-end coverage against a live GitHub repo set
`GITHUB_TOKEN` + `GITHUB_FIXTURE_REPO=<owner/repo>` and run the
`ingest issue <url>` CLI command against a throwaway issue.

## Known limitations

- The coordinator currently does **not** push a real git branch; the `head`
  branch name is generated but the actual code change is the responsibility
  of the spawned coder agent (which writes to the working tree). Layering
  on `simple-git` push is tracked separately.
- GitLab merge-request drafts use the `Draft:` title prefix because there
  is no boolean `draft` field on the v4 API.
- Audit URLs are rendered from a template; integration with the audit log
  (AIG-635) is left to whichever transport is configured.
