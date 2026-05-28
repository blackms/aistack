/**
 * Dreaming worker — background memory consolidation.
 *
 * Inspired by the Anthropic "Dreaming" pattern (memory consolidation across
 * sessions, mimicking hippocampal replay). The worker runs on a configurable
 * cadence, picks a batch of recent memory entries, groups them into clusters
 * of semantically related items, and stores a consolidated summary entry per
 * cluster. The summary is written back into the memory store with a dedicated
 * `dream` tag and a `derived_from` relationship to its sources, so downstream
 * agents can surface long-term knowledge without re-reading the raw history.
 *
 * Design constraints:
 *  - Zero new runtime dependencies. We rely on the existing vector search
 *    (when enabled) for similarity; otherwise we fall back to a lightweight
 *    keyword overlap heuristic so the worker remains useful in vector-less
 *    deployments.
 *  - The worker MUST NOT mutate or delete source entries. Consolidation is
 *    additive — operators decide when to prune.
 *  - All work is best-effort: failures are logged but never thrown out of the
 *    interval handler.
 */

import type { MemoryManager } from './index.js';
import type { MemoryEntry } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('dreaming');

export interface DreamingWorkerOptions {
  /** How often to run consolidation. Defaults to 30 minutes. */
  intervalMs?: number;
  /** Max number of entries to consider per cycle. Defaults to 50. */
  batchSize?: number;
  /** Minimum number of entries required to form a cluster. Defaults to 2. */
  minClusterSize?: number;
  /** Similarity threshold (0-1) when using vector search. Defaults to 0.75. */
  similarityThreshold?: number;
  /** Namespace to consolidate. When omitted, consolidates the default namespace. */
  namespace?: string;
  /** Namespace where consolidated summaries are stored. Defaults to `<namespace>:dreams`. */
  dreamNamespace?: string;
  /** Custom consolidator. Defaults to a deterministic header + bullet summary. */
  summarize?: (cluster: MemoryEntry[]) => string;
}

export interface DreamingCycleResult {
  scanned: number;
  clusters: number;
  consolidated: number;
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MIN_CLUSTER = 2;
const DEFAULT_SIM_THRESHOLD = 0.75;

export class DreamingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cycles = 0;

  constructor(
    private memory: MemoryManager,
    private options: DreamingWorkerOptions = {}
  ) {}

  isRunning(): boolean {
    return this.timer !== null;
  }

  cycleCount(): number {
    return this.cycles;
  }

  /**
   * Schedule periodic consolidation. Safe to call multiple times — extra calls
   * are no-ops while the worker is already running. Also installs SIGTERM /
   * SIGINT handlers so the interval is cleared on process shutdown — without
   * this the worker would keep ticking past graceful-shutdown signals.
   */
  start(): void {
    if (this.timer) {
      return;
    }
    const interval = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    log.info('Dreaming worker starting', { intervalMs: interval });
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    // Prevent the interval from keeping the process alive.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    this.installShutdownHandlers();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('Dreaming worker stopped');
    }
    this.removeShutdownHandlers();
  }

  // ---- Shutdown wiring ----------------------------------------------------

  private shutdownHandler: (() => void) | null = null;

  private installShutdownHandlers(): void {
    if (this.shutdownHandler) return;
    const handler = (): void => {
      try {
        this.stop();
      } catch {
        /* ignore — best-effort cleanup */
      }
    };
    this.shutdownHandler = handler;
    process.once('SIGTERM', handler);
    process.once('SIGINT', handler);
    process.once('beforeExit', handler);
  }

  private removeShutdownHandlers(): void {
    if (!this.shutdownHandler) return;
    const handler = this.shutdownHandler;
    this.shutdownHandler = null;
    process.off('SIGTERM', handler);
    process.off('SIGINT', handler);
    process.off('beforeExit', handler);
  }

  private async tick(): Promise<void> {
    if (this.running) {
      log.debug('Dreaming tick skipped: previous cycle still running');
      return;
    }
    this.running = true;
    try {
      const result = await this.consolidate();
      this.cycles++;
      log.info('Dreaming cycle completed', { ...result });
    } catch (err) {
      log.error('Dreaming cycle failed', { error: err instanceof Error ? err.message : err });
    } finally {
      this.running = false;
    }
  }

  /**
   * Run one consolidation cycle. Exposed for tests + ad-hoc invocation.
   */
  async consolidate(): Promise<DreamingCycleResult> {
    const batchSize = this.options.batchSize ?? DEFAULT_BATCH_SIZE;
    const minCluster = this.options.minClusterSize ?? DEFAULT_MIN_CLUSTER;
    const namespace = this.options.namespace;
    const dreamNamespace =
      this.options.dreamNamespace ?? `${namespace ?? 'default'}:dreams`;

    // Pull the most recent N entries from the chosen namespace.
    const entries = this.memory.list(namespace, batchSize);
    // Skip entries that are themselves consolidated summaries.
    const sourceEntries = entries.filter((e) => !this.isDream(e));

    // Dedupe: skip entries that have already been consolidated and whose
    // content hasn't changed since. Without this, the vector / Jaccard cluster
    // step happily re-runs over the same neighborhood every tick and produces
    // a fresh near-duplicate dream entry per cycle — both wasteful and noisy.
    // We snapshot the (sourceId -> consolidatedAtMs) pairs recorded on prior
    // dream entries and skip any candidate whose updatedAt <= the recorded
    // consolidation timestamp.
    const consolidatedAt = this.loadConsolidationIndex(dreamNamespace);
    const candidates = sourceEntries.filter((entry) => {
      const last = consolidatedAt.get(entry.id);
      if (last === undefined) return true; // never consolidated
      return entry.updatedAt.getTime() > last; // re-consolidate only if changed
    });

    if (candidates.length < minCluster) {
      return { scanned: candidates.length, clusters: 0, consolidated: 0 };
    }

    const clusters = await this.cluster(candidates);
    let consolidated = 0;
    for (const cluster of clusters) {
      if (cluster.length < minCluster) continue;
      const ok = await this.writeDream(cluster, dreamNamespace);
      if (ok) consolidated++;
    }
    return { scanned: candidates.length, clusters: clusters.length, consolidated };
  }

  /**
   * Build a map of `sourceEntryId -> mostRecentConsolidationTimestampMs`
   * by scanning existing dream entries' metadata. Returns an empty map if no
   * dreams exist or if the namespace is empty.
   *
   * Each dream records `consolidatedFrom: string[]` (source IDs) plus a
   * `consolidatedAt` ISO timestamp; we keep the most recent timestamp per
   * source ID so an updated source can still be re-consolidated.
   */
  private loadConsolidationIndex(dreamNamespace: string): Map<string, number> {
    const index = new Map<string, number>();
    // Bound the scan to a large but finite limit so a runaway dream namespace
    // can't make every tick O(N) over the entire history.
    let dreams: MemoryEntry[] = [];
    try {
      dreams = this.memory.list(dreamNamespace, 1000);
    } catch {
      return index;
    }
    for (const dream of dreams) {
      const meta = dream.metadata as Record<string, unknown> | undefined;
      if (!meta) continue;
      const sources = meta.consolidatedFrom;
      const atRaw = meta.consolidatedAt;
      if (!Array.isArray(sources)) continue;
      const atMs =
        typeof atRaw === 'string' ? Date.parse(atRaw) : Number.NaN;
      // Fallback: use the dream's own createdAt when the timestamp is missing
      // or malformed (older dream entries written before this field landed).
      const ts = Number.isFinite(atMs) ? atMs : dream.createdAt.getTime();
      for (const sourceId of sources) {
        if (typeof sourceId !== 'string') continue;
        const prev = index.get(sourceId);
        if (prev === undefined || ts > prev) {
          index.set(sourceId, ts);
        }
      }
    }
    return index;
  }

  private isDream(entry: MemoryEntry): boolean {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    return Boolean(meta && meta.kind === 'dream');
  }

  /**
   * Cluster candidates by similarity. Uses vector search if available, with a
   * keyword-overlap fallback. The output is a list of disjoint clusters; each
   * candidate appears in at most one cluster.
   */
  private async cluster(candidates: MemoryEntry[]): Promise<MemoryEntry[][]> {
    const threshold = this.options.similarityThreshold ?? DEFAULT_SIM_THRESHOLD;
    const stats = this.memory.getVectorStats(this.options.namespace);
    const vectorReady = stats.coverage > 0;

    const visited = new Set<string>();
    const clusters: MemoryEntry[][] = [];

    for (const seed of candidates) {
      if (visited.has(seed.id)) continue;
      visited.add(seed.id);
      const cluster: MemoryEntry[] = [seed];

      if (vectorReady) {
        // Use the seed content as the query — keep the cluster compact.
        const results = await this.memory.search(seed.content.slice(0, 500), {
          namespace: this.options.namespace,
          threshold,
          limit: 10,
          useVector: true,
        });
        for (const r of results) {
          if (visited.has(r.entry.id)) continue;
          if (this.isDream(r.entry)) continue;
          visited.add(r.entry.id);
          cluster.push(r.entry);
        }
      } else {
        // Keyword-overlap fallback: bag-of-words Jaccard similarity.
        const seedTokens = tokenize(seed.content);
        for (const other of candidates) {
          if (visited.has(other.id)) continue;
          const score = jaccard(seedTokens, tokenize(other.content));
          if (score >= threshold) {
            visited.add(other.id);
            cluster.push(other);
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  private async writeDream(cluster: MemoryEntry[], dreamNamespace: string): Promise<boolean> {
    const summarizer = this.options.summarize ?? defaultSummarize;
    const summary = summarizer(cluster);
    const sourceIds = cluster.map((e) => e.id);
    const sourceKeys = cluster.map((e) => e.key);
    const key = `dream:${Date.now().toString(36)}:${sourceIds[0].slice(0, 8)}`;
    try {
      const stored = await this.memory.store(key, summary, {
        namespace: dreamNamespace,
        metadata: {
          kind: 'dream',
          consolidatedFrom: sourceIds,
          consolidatedKeys: sourceKeys,
          consolidatedAt: new Date().toISOString(),
        },
      });
      // Best-effort relationship + tag — never let these block the dream itself.
      try {
        this.memory.addTag(stored.id, 'dream');
      } catch {
        /* ignore */
      }
      for (const sourceId of sourceIds) {
        try {
          this.memory.createRelationship(stored.id, sourceId, 'derived_from');
        } catch {
          /* ignore — schema may forbid cross-namespace refs */
        }
      }
      return true;
    } catch (err) {
      log.warn('Failed to write dream entry', {
        error: err instanceof Error ? err.message : err,
        size: cluster.length,
      });
      return false;
    }
  }
}

/**
 * Default summary: deterministic, no model call. The hosting application can
 * replace this with an LLM-backed summarizer via `options.summarize`.
 */
function defaultSummarize(cluster: MemoryEntry[]): string {
  const lines: string[] = [];
  lines.push(`# Consolidated memory (${cluster.length} entries)`);
  lines.push('');
  lines.push(`Generated at ${new Date().toISOString()} by the Dreaming worker.`);
  lines.push('');
  lines.push('## Sources');
  for (const entry of cluster) {
    lines.push(`- ${entry.namespace}/${entry.key} (id: ${entry.id})`);
  }
  lines.push('');
  lines.push('## Excerpts');
  for (const entry of cluster) {
    const excerpt = entry.content.slice(0, 240).replace(/\s+/g, ' ').trim();
    lines.push(`- **${entry.key}**: ${excerpt}${entry.content.length > 240 ? '…' : ''}`);
  }
  return lines.join('\n');
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
