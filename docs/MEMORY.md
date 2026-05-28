# Memory subsystem

The aistack memory subsystem stores agent context, task history, and learned
knowledge in a single SQLite database with FTS5 full-text search and optional
vector search. This document covers the **Anthropic Memory Tool integration**
added in AIG-640 (Code with Claude 2026 alignment).

## Overview

aistack memory is composed of three layers:

1. **SQLite store** (`src/memory/sqlite-store.ts`) — durable storage with FTS5,
   tags, relationships, versions, and per-agent scoping.
2. **Search** (`src/memory/fts-search.ts`, `src/memory/vector-search.ts`) —
   keyword and semantic retrieval.
3. **Access control** (`src/memory/access-control.ts`) — session/agent isolation.

On top of those layers AIG-640 added three opt-in modules:

| Module | File | Purpose |
| --- | --- | --- |
| Memory Tool adapter | `src/memory/tool-adapter.ts` | Expose aistack memory via the official Anthropic Memory Tool API |
| Dreaming worker | `src/memory/dreaming.ts` | Background memory consolidation (clustering + summarization) |
| Bidirectional sync | `src/memory/sync.ts` | Keep `~/.claude/agent-memory/` and aistack memory in step |

All three are disabled by default. Enable them via `aistack.config.json`.

## Anthropic Memory Tool integration

The Anthropic Memory Tool (Claude API + Claude Code v2.1.33+) models memory as
a small virtual filesystem rooted at `/memories`. Tool calls accept the
commands `view`, `create`, `str_replace`, `insert`, `delete`, and `rename`.

`MemoryToolAdapter` maps that surface onto aistack memory:

- The virtual root (`/memories` by default) maps to a configurable namespace
  (`agent-memory` by default).
- Each "file" is a memory entry keyed by its path relative to the root.
- Subdirectories are emulated through the `/` separator inside the key.

### Configuration

```json
{
  "memory": {
    "toolAdapter": {
      "enabled": true,
      "namespace": "agent-memory",
      "root": "/memories"
    }
  }
}
```

### Programmatic use

```ts
import { getMemoryManager, MemoryToolAdapter } from '@blackms/aistack/memory';

const adapter = new MemoryToolAdapter(getMemoryManager(config));

// Forward Anthropic tool_use input straight to the adapter.
const result = await adapter.handle({
  command: 'create',
  path: '/memories/notes/today.md',
  file_text: 'todo: ship AIG-640',
});
```

The adapter is storage-only — it does not orchestrate Claude API calls. Plug it
into your tool dispatcher (MCP server, SDK middleware, etc.) to expose it to
the model.

## Dreaming pattern

`DreamingWorker` periodically scans recent memory entries, groups them into
clusters of semantically related items, and writes a consolidated summary back
into a dedicated namespace (default `<namespace>:dreams`). The summary is
tagged `dream` and linked to its sources via `derived_from` relationships, so
agents can surface long-term knowledge without re-reading raw history.

The worker prefers the vector store when available (cosine similarity above
`similarityThreshold`). It falls back to Jaccard similarity over token bags
when vector search is disabled, keeping the feature useful in vector-less
deployments.

### Configuration

```json
{
  "memory": {
    "dreaming": {
      "enabled": true,
      "intervalMs": 1800000,
      "batchSize": 50,
      "minClusterSize": 2,
      "similarityThreshold": 0.75,
      "namespace": "default",
      "dreamNamespace": "default:dreams"
    }
  }
}
```

### Programmatic use

```ts
import { DreamingWorker, getMemoryManager } from '@blackms/aistack/memory';

const worker = new DreamingWorker(getMemoryManager(config), {
  intervalMs: 30 * 60 * 1000,
});
worker.start();
// Manual one-shot run:
const stats = await worker.consolidate();
```

The worker is purely additive: source entries are **never** modified or
deleted. Operators decide when to prune.

## Bidirectional filesystem sync

`BidirectionalSync` keeps a configured directory (default
`~/.claude/agent-memory/`) in step with the chosen aistack namespace. It runs
two passes on each tick:

1. **Disk -> memory**: every file under the watch path is imported (when its
   content hash differs from the stored entry).
2. **Memory -> disk**: every entry in the namespace is written to the
   corresponding path under the watch path (when its hash differs).

Conflict resolution: **last-writer-wins** at the file level. The side with the
larger timestamp (`mtime` on disk, `updatedAt` in memory) wins. This is a
simple, predictable policy; operators that need stricter guarantees should
disable one direction (`importEnabled` or `exportEnabled`).

### Configuration

```json
{
  "memory": {
    "sync": {
      "enabled": true,
      "watchPath": "~/.claude/agent-memory",
      "namespace": "agent-memory",
      "pollIntervalMs": 5000,
      "importEnabled": true,
      "exportEnabled": true
    }
  }
}
```

### Programmatic use

```ts
import { BidirectionalSync, getMemoryManager } from '@blackms/aistack/memory';

const sync = new BidirectionalSync(getMemoryManager(config), {
  watchPath: '~/.claude/agent-memory',
  namespace: 'agent-memory',
});
sync.start();
// Or call sync.tick() / sync.exportEntry(key) on demand from your hooks.
```

### Suggested deployment

A common setup chains all three pieces:

```text
Claude Code (Memory Tool)
   |
   v
~/.claude/agent-memory/    <-- BidirectionalSync -->    aistack memory (SQLite)
                                                                |
                                                                +-- MemoryToolAdapter
                                                                +-- DreamingWorker
```

Claude Code writes via its native Memory Tool; sync mirrors those writes into
the SQLite store. Other agents in the swarm read/write via the
`MemoryToolAdapter`, and the Dreaming worker consolidates the long-term
record.

## Caveats

- The Memory Tool adapter is storage-only; surface it through your own tool
  dispatcher (MCP, SDK middleware).
- The Dreaming default summarizer is deterministic (no model call). Provide a
  custom `summarize` callback to plug in an LLM-backed summary.
- The sync layer uses polling (`pollIntervalMs`) instead of `fs.watch` for
  cross-platform consistency. Set a small interval if you need near-real-time
  semantics, or call `tick()` from a write hook for push-style updates.
# Memory Subsystem

aistack stores all agent memory in a single SQLite database. This document
covers the runtime layout and — in particular — the hierarchical tiering
introduced in AIG-651.

## Backends

| Layer | Purpose | Code |
| --- | --- | --- |
| `SQLiteStore` | Durable row storage, sessions, tasks, projects | `src/memory/sqlite-store.ts` |
| `FTSSearch`   | SQLite FTS5 full-text search                    | `src/memory/fts-search.ts`   |
| `VectorSearch`| Optional embeddings + cosine ranking            | `src/memory/vector-search.ts`|
| `MemoryManager` | Thin facade used by agents & CLI              | `src/memory/index.ts`        |

The `MemoryManager` is the public entry point; all CLI commands and MCP tools
go through it.

## Hierarchical tiering (AIG-651)

### Concept

Inspired by MemGPT / Letta's OS-style memory hierarchy, every memory entry
lives in exactly one of three tiers:

| Tier      | Intent                                | Backed by                       |
| --------- | ------------------------------------- | ------------------------------- |
| `working` | Hot, in-context (~4k token budget)    | `memory` rows with `tier='working'` |
| `recall`  | Warm, FTS5 + vector indexed (default) | `memory` rows with `tier='recall'`  |
| `archival`| Cold, gzipped, optional LLM summary   | `memory` rows with `tier='archival'`, full payload in `archived_content` |

New writes default to `recall` — existing behavior is unchanged for any code
that hasn't opted in.

### Auto-paging

A background worker (`AutoPager` in `src/memory/tiers/auto-pager.ts`) runs
every `intervalMs` (default 5 minutes) and applies three rules in order:

1. **Promote hot recall -> working.** Recall entries with
   `access_count >= promoteToWorkingMinAccessCount` accessed within
   `recentAccessWindowMs` are promoted, respecting the working tier's cap.
2. **Demote working LRU -> recall.** If working exceeds its `maxEntries`
   cap, the LRU tail (oldest `last_accessed_at`) is demoted.
3. **Demote aged / overflow recall -> archival.** Recall entries older than
   `recallMaxAgeDays` OR beyond `recallMaxEntries` are demoted; their content
   is gzipped into `archived_content` and replaced with a short preview /
   summary in the `content` column so FTS can still surface them.

Each tick is bounded by `batchSize` (default 500 rows scanned) so paging
cost is predictable on 10k+ entry stores.

### Explicit API

```ts
import { TierManager, AutoPager, createTierStack } from '@blackms/aistack/memory';

const { tierManager, autoPager } = createTierStack(store, config);
autoPager.start();

// Manual control
tierManager.touch(entry.id);                       // mark as accessed
tierManager.promote(entry.id);                     // one step hotter
tierManager.demote(entry.id, undefined, {          // archive with summary
  summary: 'optional LLM summary'
});
tierManager.setTier(entry.id, 'archival');         // jump directly
tierManager.restoreContent(entry.id);              // read archived payload
tierManager.getStats();                            // { working, recall, archival, total }
```

`MemoryManager.store()` / `get()` / `search()` are NOT modified by this
module. Tiering is purely additive — call `touch()` from read paths if you
want the AutoPager to see access patterns.

### CLI

```bash
aistack memory promote <key> [--namespace ns] [--to working|recall]
aistack memory demote  <key> [--namespace ns] [--to recall|archival] [--summary "text"]
aistack memory tier-stats
```

### Configuration

`aistack.config.json`:

```json
{
  "memory": {
    "path": "./data/aistack.db",
    "tiering": {
      "enabled": true,
      "workingMaxEntries": 50,
      "recallMaxEntries": 5000,
      "recallMaxAgeDays": 30,
      "promoteToWorkingMinAccessCount": 3,
      "recentAccessWindowMs": 86400000,
      "archivalSummarize": false,
      "intervalMs": 300000,
      "batchSize": 500
    }
  }
}
```

All fields are optional — omitted values fall back to
`DEFAULT_PAGING_POLICY` (`src/memory/tiers/types.ts`).

### Schema

Migration `migrations/009_memory_tiers.sql` adds five columns to the existing
`memory` table:

| Column            | Type    | Default     | Meaning                                       |
| ----------------- | ------- | ----------- | --------------------------------------------- |
| `tier`            | TEXT    | `'recall'`  | Current tier.                                 |
| `access_count`    | INTEGER | `0`         | Bumped by `TierManager.touch()`.              |
| `last_accessed_at`| INTEGER | NULL        | Epoch ms of last `touch()`.                   |
| `summary`         | TEXT    | NULL        | Optional summary stored at archival time.     |
| `archived_content`| BLOB    | NULL        | gzip of original content (archival only).     |

Plus three supporting indexes: `idx_memory_tier`, `idx_memory_last_accessed`,
`idx_memory_tier_accessed`.

The `TierManager` constructor also applies these ALTERs idempotently on the
live SQLite connection so existing databases keep working without manual
migration steps.

## Concurrency with AIG-640 (Dreaming)

The Dreaming worker (AIG-640) performs **semantic consolidation** —
clustering similar entries and writing NEW summary rows. It does not touch
the `tier` column.

The TierManager / AutoPager (AIG-651) handle **access-frequency lifecycle** —
moving rows between tiers based on recency and access counts. They do not
delete or merge entries.

The two workers therefore operate on orthogonal dimensions and can run in
parallel. If a Dreaming-generated summary row needs to be kept hot, give it
a high initial `access_count` via `TierManager.touch()` after creation.

## Audit & isolation (AIG-635 interplay)

Tier transitions go through plain SQL `UPDATE` statements on the `memory`
table; they intentionally do NOT emit `audit.log('memory.write')` events so
they don't pollute the audit hash chain with system-driven movements. If
auditing tier changes becomes a requirement, instrument
`TierManager.applyTransition` directly — do not add the hook on the
`MemoryManager.store()` path.
