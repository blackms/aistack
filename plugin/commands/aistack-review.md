---
description: Adversarial review loop over the current diff — a critic agent hunts for correctness, security, and design defects; iterate until the change holds up or surface blocking findings.
argument-hint: "[target: staged | branch | <path>]"
---

# /aistack-review

Run an **adversarial review loop** over a change before it ships. The goal is to break the change on paper so it does not break in production. This mirrors aistack's `adversarial` and `reviewer` agents (model: opus for the critic).

`$ARGUMENTS` selects the review target:
- (default / `staged`) — the staged diff (`git diff --staged`).
- `branch` — the full diff of the current branch vs `main` (`git diff main...HEAD`).
- `<path>` — a specific file or directory.

## Loop

### Round 0 — Establish the contract
Read the change and its surrounding context. State, in one or two sentences, what the change is *supposed* to do (its contract). If you cannot, that is the first finding: the change lacks a clear, reviewable intent.

### Round 1 — Adversarial pass (critic hat)
Attack the change. For each category, list concrete findings with file:line and a short rationale. Do not pad — only real findings.

- **Correctness**: off-by-one, null/undefined, error paths, race conditions, incorrect assumptions about inputs.
- **Security**: injection (SQL/shell/path), unvalidated input, secrets in code, authz gaps, unsafe deserialization. Apply the OWASP Top 10 lens.
- **Edge cases**: empty/huge inputs, concurrency, timeouts, partial failure, idempotency.
- **Design / maintainability**: hidden coupling, leaky abstractions, duplicated logic, dead code, missing tests for the new behavior.
- **Regression risk**: what existing behavior could this silently change?

Classify each finding as **blocking**, **should-fix**, or **nit**.

### Round 2 — Steelman & verify
For each blocking/should-fix finding, try to *disprove* it: read the actual code path, run a targeted test or command if cheap. Drop findings that do not survive scrutiny. This prevents false-positive noise.

### Round 3 — Verdict
Emit a verdict:
- **PASS** — no blocking findings. List should-fix / nits as optional follow-ups.
- **CHANGES REQUESTED** — one or more blocking findings. List them first, each with a concrete suggested fix.

If the user asked to iterate and there are blocking findings you can safely fix, apply the fixes, then re-run the loop from Round 1 on the updated diff. Stop when you reach PASS or when a finding needs a human decision (then surface it clearly and stop).

## Constraints

- Read-only by default. Only modify files if the user explicitly asked to fix, and never push or open PRs.
- Quote exact file:line for every finding so it is actionable.
- Prefer fewer high-confidence findings over a long list of speculation.

> Pairs well with `/aistack-pm` (which dispatches work) and the bundled `aistack` MCP server's consensus tools for human-in-the-loop sign-off.
