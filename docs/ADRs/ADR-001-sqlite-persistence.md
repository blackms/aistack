# ADR-001: SQLite for Persistence

## Status

Accepted

## Context

AgentStack needs a persistent storage layer for:
- Memory entries (key-value with metadata)
- Session tracking
- Task audit trail
- Optional vector embeddings

Requirements:
- Zero external dependencies (no separate database server)
- Full-text search capability
- Cross-platform compatibility
- Single-file deployment
- Concurrent read access

## Decision

Use SQLite via the `better-sqlite3` library for all persistence needs.

### Key Implementation Details

1. **Database location**: Configurable via `memory.path` (default: `./data/aistack.db`)

2. **FTS5 Integration**: Use SQLite's FTS5 extension for full-text search with:
   - Porter stemming tokenizer
   - Unicode61 support
   - BM25 ranking

3. **Trigger-based sync**: Automatic FTS index updates via INSERT/UPDATE/DELETE triggers

4. **Synchronous API**: Use `better-sqlite3`'s synchronous API for simplicity and reliability

5. **Embedding storage**: Store vector embeddings as BLOBs (Float32Array serialized)

### Schema

```sql
CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  namespace TEXT DEFAULT 'default',
  content TEXT NOT NULL,
  embedding BLOB,
  metadata TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(namespace, key)
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  key, content, namespace,
  content=memory,
  content_rowid=rowid,
  tokenize='porter unicode61'
);
```

## Alternatives Considered

### 1. PostgreSQL

**Pros**: Robust, pg_vector extension, concurrent writes
**Cons**: External dependency, complex deployment, overkill for single-user

### 2. LevelDB / RocksDB

**Pros**: Fast key-value access, embedded
**Cons**: No built-in FTS, no SQL queries, less tooling

### 3. In-memory with file serialization

**Pros**: Simple, fast
**Cons**: No FTS, memory constraints, crash vulnerability

### 4. MongoDB (embedded mode)

**Pros**: Document model fits well
**Cons**: Large footprint, complex embedding

## Consequences

### Positive

- **Zero dependencies**: No external database server required
- **Single file**: Easy backup and migration
- **Built-in FTS**: No need for separate search engine
- **ACID compliance**: Reliable transactions
- **Tooling**: sqlite3 CLI for debugging and inspection
- **Cross-platform**: Works on all Node.js platforms

### Negative

- **Single writer**: Only one process can write at a time
- **No native vector search**: Must implement cosine similarity in code
- **Synchronous blocking**: Large operations block event loop
- **File locking**: Potential issues with network filesystems

### Mitigations

- Single-process design (MCP server is sole writer)
- Implement vector search in JavaScript with in-memory filtering
- Keep operations small; use pagination
- Recommend local filesystem for database

## References

- [better-sqlite3 documentation](https://github.com/WiseLibs/better-sqlite3)
- [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html)
- [src/memory/sqlite-store.ts](../../src/memory/sqlite-store.ts)
