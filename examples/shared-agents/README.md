# Shared agents

This directory hosts portable agent files in the `.aistack-agent` format
(see [`docs/AGENT_FILE_SPEC.md`](../../docs/AGENT_FILE_SPEC.md) for the
specification).

Each file is a self-contained snapshot of an agent — type, capabilities,
optional system prompt override, optional memory entries — that can be
imported into any aistack installation.

## Importing one

```bash
aistack agent-portable import examples/shared-agents/coder-secure-default.aistack-agent
```

The command will print the freshly-allocated identity id and warn about
anything that did not round-trip cleanly.

## Inspecting one

```bash
aistack agent-portable inspect examples/shared-agents/coder-secure-default.aistack-agent
```

## Contributing your own

1. Export from a live identity (`aistack agent-portable export --id <uuid>`).
2. Open the resulting JSON and double-check there are no secrets in
   `memory_snapshot.entries[].metadata` (the exporter strips well-known
   keys but cannot reason about arbitrary structure).
3. Bump or set `metadata.labels` to describe what the agent is good at.
4. Open a PR adding the file to this directory and a short blurb here.

## Letta `.af` compatibility

Letta `.af` files can be converted on the fly:

```bash
aistack agent-portable convert < my-letta-agent.af > my-letta-agent.aistack-agent
```

See `docs/AGENT_FILE_SPEC.md` "Letta `.af` mapping" for the field-by-field
translation table and its known limitations.
