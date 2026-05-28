/**
 * SQLite-backed pending-state store for OIDC `/login` → `/callback`.
 *
 * AIG-646 follow-up: an in-process Map cannot work across multi-process /
 * multi-instance deploys (worker A creates the state, worker B receives the
 * callback). Persisting to the shared memory-manager SQLite makes the state
 * available to any process pointing at the same DB file.
 *
 * Stores: txId → OidcAuthState (state, nonce, codeVerifier, createdAt).
 * TTL: 10 minutes; sweep on every access; entries are single-use (deleted on get).
 *
 * The table is created on first construction so no new migration file is needed.
 */

import type Database from 'better-sqlite3';
import type { OidcAuthState } from './oidc.js';

/** TTL aligned with the OIDC state cookie Max-Age. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface OidcPendingStateStore {
  set(txId: string, state: OidcAuthState): void;
  /** Returns the state and atomically deletes it (single-use). */
  takeAndDelete(txId: string): OidcAuthState | undefined;
  /** Test/shutdown hook. */
  sweep(): void;
}

export class SqliteOidcPendingStateStore implements OidcPendingStateStore {
  private readonly db: Database.Database;
  private readonly ttlMs: number;

  constructor(db: Database.Database, ttlMs: number = DEFAULT_TTL_MS) {
    this.db = db;
    this.ttlMs = ttlMs;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sso_oidc_pending (
        tx_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sso_oidc_pending_expires
        ON sso_oidc_pending(expires_at);
    `);
  }

  set(txId: string, state: OidcAuthState): void {
    const now = Date.now();
    const expiresAt = new Date(now + this.ttlMs).toISOString();
    const createdAt = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sso_oidc_pending (tx_id, state_json, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(txId, JSON.stringify(state), expiresAt, createdAt);
  }

  takeAndDelete(txId: string): OidcAuthState | undefined {
    const now = Date.now();
    // Atomic read+delete inside a transaction; sweep expired rows opportunistically.
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT state_json, expires_at FROM sso_oidc_pending WHERE tx_id = ?')
        .get(txId) as { state_json: string; expires_at: string } | undefined;

      this.db.prepare('DELETE FROM sso_oidc_pending WHERE tx_id = ?').run(txId);

      if (!row) return undefined;
      if (Date.parse(row.expires_at) <= now) return undefined;
      return JSON.parse(row.state_json) as OidcAuthState;
    });
    const state = tx();
    // Best-effort sweep of other expired rows.
    this.db
      .prepare('DELETE FROM sso_oidc_pending WHERE expires_at <= ?')
      .run(new Date(now).toISOString());
    return state;
  }

  sweep(): void {
    this.db
      .prepare('DELETE FROM sso_oidc_pending WHERE expires_at <= ?')
      .run(new Date().toISOString());
  }
}
