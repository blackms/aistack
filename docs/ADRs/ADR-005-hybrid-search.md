# ADR-005: Hybrid FTS + Vector Search

## Status

Accepted

## Context

AgentStack's memory system needs search capabilities for:
- Finding relevant stored context
- Semantic similarity matching
- Keyword-based retrieval
- Supporting various query types

Requirements:
- Work without external services (local-first)
- Support both keyword and semantic queries
- Graceful degradation when embeddings unavailable
- Reasonable performance with moderate data sizes

## Decision

Implement a hybrid search strategy combining:
1. **FTS5**: SQLite full-text search with BM25 ranking
2. **Vector Search**: Optional embedding-based semantic search

### Search Priority

1. If vector search enabled and query has semantic intent:
   - Generate query embedding
   - Find entries with cosine similarity > threshold
   - Return vector results

2. If no vector results or vector disabled:
   - Fall back to FTS5 search
   - Use BM25 ranking

3. Merge and deduplicate results

### Implementation

```typescript
async search(query: string, options: MemorySearchOptions): Promise<MemorySearchResult[]> {
  const results: MemorySearchResult[] = [];

  // Try vector search first if enabled
  if (this.vectorSearch && options.useVector !== false) {
    const vectorResults = await this.vectorSearch.search(query, options);
    results.push(...vectorResults);
  }

  // Fall back to FTS if no vector results
  if (results.length === 0) {
    const ftsResults = this.ftsSearch.search(query, options);
    results.push(...ftsResults);
  }

  return this.mergeResults(results, options.limit);
}
```

### Vector Search Implementation

```typescript
async search(query: string, options: MemorySearchOptions): Promise<MemorySearchResult[]> {
  // Generate query embedding
  const queryEmbedding = await this.embedder.embed(query);

  // Load entries with embeddings
  const entries = this.store.listWithEmbeddings(options.namespace);

  // Calculate similarities
  const scored = entries.map(entry => ({
    entry,
    score: cosineSimilarity(queryEmbedding, entry.embedding!)
  }));

  // Filter and sort
  return scored
    .filter(r => r.score >= (options.threshold ?? 0.7))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 10)
    .map(r => ({ ...r, matchType: 'vector' as const }));
}
```

### FTS Search Implementation

```typescript
search(query: string, options: MemorySearchOptions): MemorySearchResult[] {
  const escaped = this.escapeQuery(query);

  const sql = `
    SELECT m.*, bm25(memory_fts) as score,
           snippet(memory_fts, 1, '<mark>', '</mark>', '...', 64) as snippet
    FROM memory_fts
    JOIN memory m ON memory_fts.rowid = m.rowid
    WHERE memory_fts MATCH ?
    ${options.namespace ? 'AND m.namespace = ?' : ''}
    ORDER BY bm25(memory_fts)
    LIMIT ?
  `;

  // Normalize BM25 scores to 0-1
  return results.map(r => ({
    entry: r,
    score: Math.max(0, Math.min(1, 1 - (r.score / -10))),
    matchType: 'fts' as const,
    snippet: r.snippet
  }));
}
```

## Alternatives Considered

### 1. Vector Search Only

**Pros**: Semantic understanding, handles synonyms
**Cons**: Requires embeddings for all entries, slower, API dependency

### 2. FTS Only

**Pros**: Fast, no external dependencies, keyword-precise
**Cons**: No semantic understanding, misses conceptual matches

### 3. External Search Engine (Elasticsearch, Meilisearch)

**Pros**: Feature-rich, scalable, hybrid built-in
**Cons**: External dependency, complex deployment

### 4. pgvector (PostgreSQL)

**Pros**: Native vector ops, SQL integration
**Cons**: Requires PostgreSQL, external dependency

## Consequences

### Positive

- **Best of both worlds**: Keyword precision + semantic understanding
- **Graceful degradation**: Works without embeddings
- **Local-first**: No external services required (with Ollama)
- **Configurable**: Users choose embedding provider

### Negative

- **Complexity**: Two search implementations to maintain
- **Memory usage**: Embeddings stored in database
- **Latency**: Vector search requires embedding generation
- **Cost**: API calls for embedding (if using OpenAI)

### Mitigations

- Clear configuration for enabling/disabling vector search
- Local embeddings via Ollama as cost-free option
- Threshold filtering to reduce false positives
- Namespace filtering to limit search scope

## Configuration

```json
{
  "memory": {
    "vectorSearch": {
      "enabled": true,
      "provider": "openai",  // or "ollama"
      "model": "text-embedding-3-small"
    }
  }
}
```

## Embedding Dimensions

| Provider | Model | Dimensions | Notes |
|----------|-------|------------|-------|
| OpenAI | text-embedding-3-small | 1536 | Fast, cost-effective |
| OpenAI | text-embedding-3-large | 3072 | Higher quality |
| Ollama | nomic-embed-text | 768 | Local, free |

## Search Options

```typescript
interface MemorySearchOptions {
  namespace?: string;      // Filter by namespace
  limit?: number;          // Max results (default: 10)
  threshold?: number;      // Vector similarity threshold (default: 0.7)
  useVector?: boolean;     // Force vector on/off
}
```

## References

- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [Ollama Embeddings](https://ollama.ai/library/nomic-embed-text)
- [src/memory/fts-search.ts](../../src/memory/fts-search.ts)
- [src/memory/vector-search.ts](../../src/memory/vector-search.ts)
