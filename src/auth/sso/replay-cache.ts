/**
 * Replay-protection cache for SSO.
 *
 * AIG-646 security focus #3, #4: prevent SAML assertion replay (Assertion ID,
 * InResponseTo) and OIDC nonce replay.
 *
 * Backed by the `sso_replay_cache` SQLite table so replay protection survives
 * restarts and is shared across multi-process deployments. A small in-process
 * Map provides hot-path caching.
 *
 * Keys are namespaced as `${provider}:${scope}:${id}` to avoid collisions
 * between SAML assertions, OIDC nonces, and InResponseTo IDs.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import type { ReplayScope } from './types.js';

const log = logger.child('sso:replay-cache');

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SWEEP_INTERVAL_MS = 60 * 1000;

export class ReplayCache {
  private db: Database.Database;
  private memCache = new Map<string, number>(); // key → expiresAt epoch ms
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    this.startSweep();
  }

  /**
   * Check if an ID has been seen. Returns true if this is a replay (already in cache).
   * If not, records it with the given TTL and returns false.
   *
   * This is a single atomic check-and-set so concurrent requests cannot both pass.
   */
  checkAndRecord(
    provider: 'saml' | 'oidc',
    scope: ReplayScope,
    id: string,
    ttlMs: number = DEFAULT_TTL_MS
  ): boolean {
    if (!id) {
      // Empty IDs are a security anti-pattern; treat as replay to fail closed.
      log.warn('Replay check called with empty id, failing closed', { provider, scope });
      return true;
    }

    const key = `${provider}:${scope}:${id}`;
    const now = Date.now();
    const expiresAt = now + ttlMs;

    // Hot path: in-memory check.
    const memHit = this.memCache.get(key);
    if (memHit !== undefined && memHit > now) {
      log.warn('Replay attempt detected (memory)', { provider, scope });
      return true;
    }

    // Persistent check + insert in a single transaction (atomic per better-sqlite3).
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT expires_at FROM sso_replay_cache WHERE key = ?')
        .get(key) as { expires_at: string } | undefined;

      if (row) {
        const persistedExp = Date.parse(row.expires_at);
        if (persistedExp > now) {
          return true; // replay
        }
        // Expired row — overwrite.
        this.db.prepare('DELETE FROM sso_replay_cache WHERE key = ?').run(key);
      }

      this.db
        .prepare(
          'INSERT INTO sso_replay_cache (key, expires_at, created_at) VALUES (?, ?, ?)'
        )
        .run(key, new Date(expiresAt).toISOString(), new Date(now).toISOString());

      return false;
    });

    const isReplay = tx();
    if (isReplay) {
      log.warn('Replay attempt detected (persistent)', { provider, scope });
      return true;
    }

    this.memCache.set(key, expiresAt);
    return false;
  }

  /**
   * Periodic sweep of expired entries from both layers.
   */
  private startSweep(): void {
    this.sweepTimer = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        log.error('Replay cache sweep failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, SWEEP_INTERVAL_MS);
    // Don't block process exit.
    this.sweepTimer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    this.db.prepare('DELETE FROM sso_replay_cache WHERE expires_at < ?').run(nowIso);

    for (const [key, exp] of this.memCache) {
      if (exp <= now) this.memCache.delete(key);
    }
  }

  /** Stop background sweep (for tests / shutdown). */
  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
