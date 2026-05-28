/**
 * HNSW-style vector index wrapper.
 *
 * Tries to back the index with the `sqlite-vec` extension (which uses an
 * HNSW-like structure under the hood for `vec0` virtual tables). If the
 * optional dependency is missing, falls back to a simple in-memory brute-force
 * cosine index so that callers always get a working — if slower — search.
 *
 * The fallback is *intentionally* not as fast as a real ANN index; it exists
 * so that tests and small workloads work out of the box without forcing users
 * to install a native extension.
 */

import { logger } from '../../utils/logger.js';
import { cosineSimilarity } from '../../utils/embeddings.js';

const log = logger.child('hnsw');

export interface HnswSearchResult {
  id: string;
  score: number;
}

export interface HnswBackend {
  upsert(id: string, vector: Float32Array | number[]): void;
  search(query: Float32Array | number[], k: number): HnswSearchResult[];
  remove(id: string): void;
  size(): number;
  backend: 'sqlite-vec' | 'in-memory';
}

interface SqliteVecModule {
  load: (db: unknown) => void;
}

interface BetterSqliteLike {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  exec: (sql: string) => void;
}

/**
 * In-memory brute-force fallback. O(N) per query, fine up to a few thousand
 * vectors; the WASM embedder is the bottleneck anyway in that regime.
 */
class InMemoryHnsw implements HnswBackend {
  readonly backend = 'in-memory' as const;
  private readonly vectors = new Map<string, number[]>();

  upsert(id: string, vector: Float32Array | number[]): void {
    this.vectors.set(id, vector instanceof Float32Array ? Array.from(vector) : vector);
  }

  remove(id: string): void {
    this.vectors.delete(id);
  }

  size(): number {
    return this.vectors.size;
  }

  search(query: Float32Array | number[], k: number): HnswSearchResult[] {
    const q = query instanceof Float32Array ? Array.from(query) : query;
    const scored: HnswSearchResult[] = [];
    for (const [id, vec] of this.vectors) {
      scored.push({ id, score: cosineSimilarity(q, vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}

/**
 * sqlite-vec backed index. Wraps a `vec0` virtual table whose only data
 * columns are `id` (TEXT primary key analogue stored in `rowid`+a lookup map)
 * and `embedding` (the vector of `dimensions` floats).
 *
 * sqlite-vec uses integer `rowid`s, so we keep a separate id<->rowid map.
 */
class SqliteVecHnsw implements HnswBackend {
  readonly backend = 'sqlite-vec' as const;
  private readonly db: BetterSqliteLike;
  private readonly table: string;
  private readonly idToRow = new Map<string, number>();
  private readonly rowToId = new Map<number, string>();
  private nextRow = 1;

  constructor(db: BetterSqliteLike, table: string, dimensions: number) {
    this.db = db;
    this.table = table;
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(embedding float[${dimensions}])`,
    );
  }

  upsert(id: string, vector: Float32Array | number[]): void {
    const buf = vector instanceof Float32Array ? vector : new Float32Array(vector);
    const existing = this.idToRow.get(id);
    if (existing !== undefined) {
      this.db.prepare(`DELETE FROM ${this.table} WHERE rowid = ?`).run(existing);
    }
    const row = this.nextRow++;
    this.db
      .prepare(`INSERT INTO ${this.table}(rowid, embedding) VALUES (?, ?)`)
      .run(row, buf.buffer);
    this.idToRow.set(id, row);
    this.rowToId.set(row, id);
  }

  remove(id: string): void {
    const row = this.idToRow.get(id);
    if (row === undefined) return;
    this.db.prepare(`DELETE FROM ${this.table} WHERE rowid = ?`).run(row);
    this.idToRow.delete(id);
    this.rowToId.delete(row);
  }

  size(): number {
    return this.idToRow.size;
  }

  search(query: Float32Array | number[], k: number): HnswSearchResult[] {
    const buf = query instanceof Float32Array ? query : new Float32Array(query);
    const rows = this.db
      .prepare(
        `SELECT rowid, distance FROM ${this.table} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(buf.buffer, k) as Array<{ rowid: number; distance: number }>;
    const out: HnswSearchResult[] = [];
    for (const r of rows) {
      const id = this.rowToId.get(r.rowid);
      if (id === undefined) continue;
      // sqlite-vec returns L2 distance for float vectors; convert to a
      // similarity score in [0, 1] so callers see a uniform metric.
      const score = 1 / (1 + r.distance);
      out.push({ id, score });
    }
    return out;
  }
}

export interface HnswIndexOptions {
  dimensions: number;
  /** Existing better-sqlite3 connection. If omitted, in-memory fallback only. */
  db?: BetterSqliteLike;
  /** Virtual table name. Defaults to `aistack_vec_idx`. */
  table?: string;
}

/**
 * Try to construct a sqlite-vec backed index, falling back to in-memory.
 *
 * Importing `sqlite-vec` is done dynamically so the absence of the optional
 * dependency does not break unrelated callers.
 */
export async function createHnswIndex(options: HnswIndexOptions): Promise<HnswBackend> {
  const { dimensions, db, table = 'aistack_vec_idx' } = options;
  if (!db) {
    log.debug('No SQLite connection provided; using in-memory HNSW fallback');
    return new InMemoryHnsw();
  }
  try {
    const mod = (await import('sqlite-vec')) as unknown as SqliteVecModule;
    mod.load(db);
    log.info('HNSW index using sqlite-vec backend', { table, dimensions });
    return new SqliteVecHnsw(db, table, dimensions);
  } catch (err) {
    log.warn('sqlite-vec not available; falling back to in-memory HNSW', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new InMemoryHnsw();
  }
}

export { InMemoryHnsw, SqliteVecHnsw };
