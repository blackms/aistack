---
name: aistack-consensus
description: Gate risky agent actions behind a human-in-the-loop consensus checkpoint using aistack's consensus tools — propose an action, pause for approval, and only proceed once approved. Use before high-impact or irreversible operations (deploys, schema migrations, mass edits, external side effects), or when the user wants approval gates / sign-off before agents act.
---

# aistack: Consensus checkpoints (human-in-the-loop)

aistack lets agents pause before high-impact actions and request explicit approval. This prevents autonomous agents from taking irreversible or risky steps without a human (or a designated approver) signing off.

## When to use

- Before an **irreversible or high-blast-radius** action: production deploy, DB schema migration, deleting data, force-push, mass file rewrite, spending money, sending external messages.
- When the user wants approval gates, sign-off, or "ask me before doing X".
- In an autonomous loop (see `/aistack-pm`) where some steps must not run unattended.

For low-risk, easily reversible actions, do NOT add a checkpoint — it just adds friction.

## MCP tools (bundled `aistack` server)

| Tool | Purpose |
|---|---|
| `consensus_check` | Propose an action and create a pending checkpoint requiring approval |
| `consensus_list_pending` | List checkpoints awaiting a decision |
| `consensus_get` | Inspect a specific checkpoint |
| `consensus_approve` | Approve a pending checkpoint (the action may proceed) |
| `consensus_reject` | Reject a checkpoint (the action must not proceed) |

List exact schemas with `npx @blackms/aistack mcp tools`.

## Workflow

1. **Detect the gate**: classify the next action's risk. If it is irreversible / high-impact, do not execute it directly.
2. **Propose**: call `consensus_check` describing the exact action, its blast radius, and how to undo it (if possible). This creates a pending checkpoint.
3. **Pause & surface**: stop and tell the human what is pending and why, then wait. Do not proceed on assumption.
4. **Resolve**: on `consensus_approve`, perform the action. On `consensus_reject`, abort cleanly, report, and propose a safer alternative if one exists.
5. **Record**: store the decision and its rationale in aistack memory (see the `aistack-memory` skill) for an audit trail.

## Tips

- Make each proposal self-contained: a reviewer should be able to decide from the checkpoint text alone, without re-reading the whole session.
- Default to a checkpoint when uncertain whether an action is reversible. Over-gating is annoying; under-gating is dangerous.
- Combine with `/aistack-review` to run an adversarial pass *before* requesting approval, so the human reviews a vetted action.

> Reference: https://github.com/blackms/aistack
