# `.aistack-agent` — Portable Agent File Format

> Status: **v1.0** (Stable). Breaking changes bump the major version
> (`format_version` field). Additive changes bump the minor version and
> remain backward-compatible.

A `.aistack-agent` file is a self-contained, JSON-encoded snapshot of a
single aistack agent. It is designed to be:

- **Portable**: a file produced on one machine imports cleanly on another.
- **Diff-friendly**: stable key ordering and 2-space indentation so file
  bumps show up nicely in git review.
- **Marketplace-ready**: a single artifact can be published, downloaded,
  inspected, and imported without any side-channel metadata.
- **Letta-`.af`-aware**: a converter best-effort imports
  [Letta Agent File](https://www.letta.com/blog/our-next-phase) snapshots.

## File envelope

| Field            | Type    | Required | Description                                          |
|------------------|---------|----------|------------------------------------------------------|
| `magic`          | string  | yes      | Always the literal `"aistack-agent"`.               |
| `format_version` | string  | yes      | `"<major>.<minor>"`, e.g. `"1.0"`.                   |
| `agent`          | object  | yes      | See [Agent section](#agent-section).                 |
| `memory_snapshot`| object  | yes      | See [Memory snapshot](#memory-snapshot).             |
| `metadata`       | object  | yes      | See [Metadata section](#metadata-section).           |

The schema is enforced via zod in `src/agents/portable-schema.ts` with
`.strict()` on every object — **unknown keys cause validation failure**.

### Agent section

| Field                     | Type       | Required | Description                                                |
|---------------------------|------------|----------|------------------------------------------------------------|
| `type`                    | string     | yes      | Must match a registered aistack agent type (e.g. `coder`). |
| `name`                    | string     | yes      | Display name. Not unique.                                  |
| `identity_id`             | uuid       | no       | Original identity UUID; consumer may reuse or regenerate.  |
| `system_prompt_override`  | string null| no       | If null/absent, registry default is used.                  |
| `tool_whitelist`          | string[]   | no       | Restricts what tools the agent may call.                   |
| `model`                   | string     | no       | Model alias suggestion (`sonnet`, `opus`, ...).            |
| `capabilities`            | string[]   | no       | Free-form tags shown in marketplaces.                      |
| `description`             | string     | no       | One-line summary.                                          |

### Memory snapshot

| Field           | Type     | Required | Description                                                                |
|-----------------|----------|----------|----------------------------------------------------------------------------|
| `format`        | literal  | yes      | Currently only `"json-entries"`.                                           |
| `entries_count` | integer  | yes      | Must equal `entries.length`.                                               |
| `entries`       | array    | yes      | Each entry has `key`, `namespace`, `content`, optional `tags`, `metadata`. |

A bundle exported with `--no-memory` has `entries_count: 0` and an empty
`entries` array. The format is JSON-only (not a raw SQLite dump) so that
the file is human-inspectable and cross-platform — there is no concept of
locking, WAL files, or SQLite engine version to worry about.

### Metadata section

| Field             | Type    | Required | Description                                                    |
|-------------------|---------|----------|----------------------------------------------------------------|
| `exported_at`     | ISO-8601| yes      | UTC timestamp.                                                 |
| `exporter`        | string  | yes      | Tool that produced the file (e.g. `aistack-cli`).              |
| `aistack_version` | string  | no       | Producer version string.                                       |
| `labels`          | string[]| no       | Free-form labels (warnings use `letta:warn:*` convention).     |
| `source`          | object  | no       | `{ tool, original_id? }` when the file was converted in.       |

## Example

See [`examples/shared-agents/coder-secure-default.aistack-agent`](../examples/shared-agents/coder-secure-default.aistack-agent)
for a complete, minimal, validatable bundle.

## On-disk formats

A `.aistack-agent` file is either:

1. **Plain UTF-8 JSON** (default). Recommended for files checked into git.
2. **Gzipped JSON** (`--format tgz`). Identical bytes, just gzip-encoded.
   The extension stays `.aistack-agent`; readers detect gzip via the magic
   bytes `0x1f 0x8b` and decompress transparently.

There is intentionally no `tar` involvement: a single-file bundle has no
need for archive concatenation, and avoiding `tar` keeps the dependency
graph at zero (we only use `node:zlib`, which ships with Node 20+).

## CLI

```bash
# Export a live identity (includes memory by default)
aistack agent-portable export --id <identity-uuid> --out my-agent.aistack-agent

# Export a built-in template (never includes memory)
aistack agent-portable export --type coder --out coder-template.aistack-agent

# Export and gzip
aistack agent-portable export --id <uuid> --out my-agent.aistack-agent --format tgz

# Inspect without importing
aistack agent-portable inspect my-agent.aistack-agent

# Import (allocates a fresh identity locally)
aistack agent-portable import my-agent.aistack-agent

# Import with rename and without memory entries
aistack agent-portable import my-agent.aistack-agent --rename my-imported --no-memory

# Convert a Letta .af on the fly
aistack agent-portable convert < incoming.af > incoming.aistack-agent
aistack agent-portable import incoming.aistack-agent
# or in one shot
aistack agent-portable import incoming.af --letta
```

## Security model

### Secrets are NEVER bundled

The exporter strips well-known secret-shaped metadata keys (`apiKey`,
`api_key`, `token`, `access_token`, `refresh_token`, `secret`, `password`,
`authorization`, `cookie`, `session_token`, `private_key`) at top level
and one level deep. **This is a best-effort floor, not a guarantee.**
Bundle authors MUST audit their own `metadata` fields before publishing.

API keys, OAuth tokens, and provider credentials live in environment
variables and are never serialised. To run an imported agent against a
specific provider, set the relevant `*_API_KEY` env var on the consumer.

### Memory content is plaintext

Memory entries are stored verbatim. If your agent has ingested sensitive
business logic, PII, or chat transcripts during normal operation, those
will appear in the bundle. The recommended workflow for sharing an agent
publicly is:

1. Spawn a fresh identity for the purpose of publishing
   (`aistack agent spawn -t coder -n publishable`).
2. Walk it through the workflow you want it to "remember".
3. Export with `--no-memory` if uncertain, or audit `entries[].content`
   before publishing.

### Imported agents land in an isolated namespace

Imported memory is stored under namespace `imported/<new-identity-id>` so
it cannot accidentally collide with — or shadow — the consumer's own
memory entries.

## Letta `.af` mapping

The `importLettaAf` function (and `aistack agent-portable import --letta`)
performs the following best-effort translation:

| Letta field                     | aistack field                          | Notes                                                       |
|---------------------------------|----------------------------------------|-------------------------------------------------------------|
| `agent_type` (`memgpt_agent`)   | `agent.type` (`coder`)                 | Fixed mapping table; unknown types fall back to `coder`.    |
| `agent_type` (`workflow_agent`) | `agent.type` (`coordinator`)           |                                                             |
| `agent_type` (`research_agent`) | `agent.type` (`researcher`)            |                                                             |
| `agent_type` (`reviewer_agent`) | `agent.type` (`reviewer`)              |                                                             |
| `name`                          | `agent.name`                           |                                                             |
| `system`                        | `agent.system_prompt_override`         |                                                             |
| `llm_config.model`              | `agent.model`                          |                                                             |
| `tools[].name`                  | `agent.tool_whitelist[]`               | Normalised via tool-name table (e.g. `send_message`->`Reply`). |
| `core_memory[].label/value`     | `memory_snapshot.entries[]` (ns: `letta-imported`) |                                                  |
| `id`                            | `metadata.source.original_id`          |                                                             |

Anything that does not map cleanly (recall agents, custom tool schemas,
LLM provider-specific config) is dropped and a `letta:warn:*` label is
appended to `metadata.labels` so the issue is visible in `inspect` output.

### Known limitations

- **Recall memory / archival memory volumes** are not migrated — Letta's
  archival store can be GB-scale; importing it 1:1 into aistack's
  per-session memory would be wrong.
- **Tool implementations** are not migrated — the whitelist names map to
  aistack's local registry; an imported agent runs with the consumer's
  tool implementations, not Letta's.
- **LLM provider config** is downgraded to just `agent.model`; provider
  selection happens at runtime via aistack's normal provider config.

## Round-trip guarantee

For any locally-owned identity `id`:

```
parse(serialize(exportAgent(id))) === exportAgent(id)
```

modulo `metadata.exported_at` (re-stamped on each export). The unit test
suite (`tests/unit/agents-portable.test.ts`) enforces this for both plain
JSON and gzip bundle formats.

## Versioning policy

- **Minor** (`1.0` -> `1.1`): adds optional fields. Old consumers ignore
  them.
- **Major** (`1.x` -> `2.0`): removes or renames fields, or changes
  validation in a way that rejects previously-valid files. The importer
  refuses major-mismatched files with a clear error.
