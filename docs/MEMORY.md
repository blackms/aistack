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
