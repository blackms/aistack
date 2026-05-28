/**
 * Hash-chained append-only audit log (AIG-635)
 *
 * Provides tamper-evident audit trail suitable for SOC2/ISO27001/HIPAA evidence
 * collection. Each entry stores a SHA-256 hash computed over the previous hash,
 * the entry payload, and metadata — forming a Merkle-style chain.
 *
 * Standalone module: depends only on `node:crypto` and `better-sqlite3` (already a
 * project dependency via SQLiteStore). Does not import other domain modules to
 * avoid coupling with the in-flight sandbox/durable-exec/OTel branches.
 *
 * Threat model: see docs/AUDIT.md.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Maximum size of the JSON-serialised payload, in bytes. Entries above this
 * limit are rejected (fail-loud) to keep audit storage bounded and avoid
 * accidental dumps of large blobs (e.g. full file contents) into the chain.
 */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Sentinel value used as `prev_hash` for the first (genesis) entry of the chain.
 * 64 zero hex chars matches SHA-256 digest length so the hashing routine treats
 * the first entry symmetrically with all subsequent ones.
 */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Domain separator embedded into the hash preimage. Prevents cross-protocol
 * collision attacks where a payload from another system could be reused.
 */
const HASH_DOMAIN = 'aistack/audit-log-chain/v1';

/**
 * Known audit event types. Open union (string) so plugins / future work can
 * emit new event kinds without modifying this file.
 */
export type AuditEventType =
  // Agent lifecycle
  | 'agent.spawn'
  | 'agent.stop'
  | 'agent.error'
  // Task lifecycle
  | 'task.create'
  | 'task.assign'
  | 'task.complete'
  | 'task.fail'
  // Consensus
  | 'consensus.decision'
  // Identity
  | 'identity.create'
  | 'identity.activate'
  | 'identity.deactivate'
  | 'identity.retire'
  | 'identity.update'
  // Memory (writes only — reads are intentionally not audited for performance)
  | 'memory.write'
  | 'memory.delete'
  // Generic
  | (string & {});

export interface AuditEntry {
  seq: number;
  prevHash: string;
  hash: string;
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  signature: string | null;
  signatureAlg: string | null;
  createdAt: Date;
}

export interface AuditAppendResult {
  seq: number;
  hash: string;
}

export interface VerifyResult {
  valid: boolean;
  /** Sequence number of the first broken entry, if any. */
  brokenAt?: number;
  /** Human-readable description of the failure, if any. */
  reason?: string;
  /** Number of entries successfully verified. */
  entriesChecked: number;
}

export interface AuditChainOptions {
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /**
   * HMAC-SHA256 key for entry signatures. Must be >= 32 bytes when present.
   * When omitted the chain runs in "unsigned mode" — hash integrity still
   * detects tampering but entries cannot be cryptographically attributed.
   */
  signatureKey?: Buffer | string;
  /**
   * Field names to redact from `payload` before hashing/storage. Useful for
   * PII / secret minimisation. Matched against top-level keys only.
   */
  redactFields?: string[];
  /**
   * If true, append() rejects payloads exceeding MAX_PAYLOAD_BYTES instead of
   * truncating. Defaults to true.
   */
  strictPayloadSize?: boolean;
}

interface ChainRow {
  seq: number;
  prev_hash: string;
  hash: string;
  event_type: string;
  payload_json: string;
  signature: string | null;
  signature_alg: string | null;
  created_at: number;
}

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS audit_log_chain (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature TEXT,
  signature_alg TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_chain_event_type ON audit_log_chain(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_chain_created_at ON audit_log_chain(created_at DESC);

CREATE TRIGGER IF NOT EXISTS audit_log_chain_no_update
  BEFORE UPDATE ON audit_log_chain
  FOR EACH ROW
  BEGIN
    SELECT RAISE(ABORT, 'audit_log_chain is append-only: UPDATE forbidden');
  END;

CREATE TRIGGER IF NOT EXISTS audit_log_chain_no_delete
  BEFORE DELETE ON audit_log_chain
  FOR EACH ROW
  BEGIN
    SELECT RAISE(ABORT, 'audit_log_chain is append-only: DELETE forbidden');
  END;
`;

/**
 * Stable canonical JSON serialisation: keys sorted recursively so the hash
 * computation is independent of object key insertion order. This matters for
 * cross-process / cross-machine verification (evidence packs).
 */
export function canonicalJSONStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSONStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJSONStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

/**
 * Compute the chain hash for a single entry.
 *
 * Pre-image format (newline-delimited, with explicit domain separator):
 *   <HASH_DOMAIN>\n<prev_hash>\n<created_at_ms>\n<event_type>\n<canonical_payload>
 *
 * Domain separation + explicit length-delimited fields prevent length-extension
 * and concatenation-collision attacks (e.g. an attacker cannot craft two payloads
 * that hash to the same value by shuffling field boundaries).
 */
export function computeEntryHash(args: {
  prevHash: string;
  createdAtMs: number;
  eventType: string;
  payload: unknown;
}): string {
  const canonical = canonicalJSONStringify(args.payload);
  const preimage = [
    HASH_DOMAIN,
    args.prevHash,
    String(args.createdAtMs),
    args.eventType,
    canonical,
  ].join('\n');
  return createHash('sha256').update(preimage, 'utf8').digest('hex');
}

function computeHmac(key: Buffer, hash: string): string {
  return createHmac('sha256', key).update(hash, 'utf8').digest('hex');
}

function redactPayload(
  payload: Record<string, unknown>,
  redactFields: readonly string[],
): Record<string, unknown> {
  if (redactFields.length === 0) return payload;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = redactFields.includes(k) ? '[REDACTED]' : v;
  }
  return out;
}

function normaliseKey(key: Buffer | string): Buffer {
  const buf = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
  if (buf.length < 32) {
    throw new Error(
      `AISTACK_AUDIT_KEY must be at least 32 bytes (got ${buf.length}). ` +
        `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return buf;
}

/**
 * Append-only audit chain backed by a dedicated SQLite database connection.
 *
 * The connection is separate from the main SQLiteStore so that audit writes
 * never interfere with application transactions and the audit module can be
 * imported/used independently in CLI tooling (e.g. `aistack audit verify` on
 * an evidence-pack DB).
 */
export class AuditChain {
  private db: Database.Database;
  private readonly signatureKey: Buffer | null;
  private readonly redactFields: readonly string[];
  private readonly strictPayloadSize: boolean;
  private readonly appendStmt: Database.Statement;

  constructor(options: AuditChainOptions) {
    const dir = dirname(options.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_DDL);

    this.signatureKey = options.signatureKey ? normaliseKey(options.signatureKey) : null;
    this.redactFields = options.redactFields ?? [];
    this.strictPayloadSize = options.strictPayloadSize ?? true;

    this.appendStmt = this.db.prepare(`
      INSERT INTO audit_log_chain (prev_hash, hash, event_type, payload_json, signature, signature_alg, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Append a new entry to the chain. Returns the assigned sequence number and
   * the computed hash. Throws if the payload exceeds MAX_PAYLOAD_BYTES in strict
   * mode.
   *
   * Atomicity: the read-of-last-hash + insert-of-new-entry runs inside a SQLite
   * IMMEDIATE transaction so concurrent appenders cannot interleave and break
   * the chain.
   */
  append(eventType: AuditEventType, payload: Record<string, unknown>): AuditAppendResult {
    const redacted = redactPayload(payload, this.redactFields);
    const payloadJson = canonicalJSONStringify(redacted);
    const byteLen = Buffer.byteLength(payloadJson, 'utf8');
    if (byteLen > MAX_PAYLOAD_BYTES) {
      if (this.strictPayloadSize) {
        throw new Error(
          `Audit payload too large: ${byteLen} bytes (max ${MAX_PAYLOAD_BYTES}). ` +
            `Log a reference (id, path) instead of full content.`,
        );
      }
    }

    const tx = this.db.transaction((): AuditAppendResult => {
      const last = this.db
        .prepare('SELECT hash FROM audit_log_chain ORDER BY seq DESC LIMIT 1')
        .get() as { hash: string } | undefined;
      const prevHash = last?.hash ?? GENESIS_PREV_HASH;
      const createdAt = Date.now();
      const hash = computeEntryHash({
        prevHash,
        createdAtMs: createdAt,
        eventType,
        payload: redacted,
      });
      const signature = this.signatureKey ? computeHmac(this.signatureKey, hash) : null;
      const signatureAlg = this.signatureKey ? 'HMAC-SHA256' : null;

      const result = this.appendStmt.run(
        prevHash,
        hash,
        eventType,
        payloadJson,
        signature,
        signatureAlg,
        createdAt,
      );

      return { seq: Number(result.lastInsertRowid), hash };
    });

    return tx.immediate();
  }

  /**
   * Verify the integrity of the chain in the given range (inclusive).
   * Recomputes each entry's hash, checks it matches the stored hash and the
   * `prev_hash` linkage, and verifies HMAC signatures if a key is configured.
   */
  verify(opts: { fromSeq?: number; toSeq?: number } = {}): VerifyResult {
    const fromSeq = opts.fromSeq ?? 1;
    const toSeq = opts.toSeq ?? Number.MAX_SAFE_INTEGER;

    // Establish the prev_hash that the first entry in range MUST link to.
    let expectedPrev: string;
    if (fromSeq <= 1) {
      expectedPrev = GENESIS_PREV_HASH;
    } else {
      const anchor = this.db
        .prepare('SELECT hash FROM audit_log_chain WHERE seq = ?')
        .get(fromSeq - 1) as { hash: string } | undefined;
      if (!anchor) {
        return {
          valid: false,
          reason: `Anchor entry seq=${fromSeq - 1} not found`,
          entriesChecked: 0,
        };
      }
      expectedPrev = anchor.hash;
    }

    const rows = this.db
      .prepare(
        'SELECT seq, prev_hash, hash, event_type, payload_json, signature, signature_alg, created_at ' +
          'FROM audit_log_chain WHERE seq >= ? AND seq <= ? ORDER BY seq ASC',
      )
      .all(fromSeq, toSeq) as ChainRow[];

    let entriesChecked = 0;
    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) {
        return {
          valid: false,
          brokenAt: row.seq,
          reason: `prev_hash mismatch at seq=${row.seq}: chain broken`,
          entriesChecked,
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch (err) {
        return {
          valid: false,
          brokenAt: row.seq,
          reason: `payload_json not valid JSON at seq=${row.seq}: ${(err as Error).message}`,
          entriesChecked,
        };
      }

      const recomputed = computeEntryHash({
        prevHash: row.prev_hash,
        createdAtMs: row.created_at,
        eventType: row.event_type,
        payload,
      });
      if (recomputed !== row.hash) {
        return {
          valid: false,
          brokenAt: row.seq,
          reason: `hash mismatch at seq=${row.seq}: entry tampered`,
          entriesChecked,
        };
      }

      if (this.signatureKey) {
        if (!row.signature || row.signature_alg !== 'HMAC-SHA256') {
          return {
            valid: false,
            brokenAt: row.seq,
            reason: `missing or unsupported signature at seq=${row.seq} (expected HMAC-SHA256)`,
            entriesChecked,
          };
        }
        const expected = computeHmac(this.signatureKey, row.hash);
        const a = Buffer.from(row.signature, 'hex');
        const b = Buffer.from(expected, 'hex');
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return {
            valid: false,
            brokenAt: row.seq,
            reason: `signature mismatch at seq=${row.seq}: key changed or entry forged`,
            entriesChecked,
          };
        }
      }

      expectedPrev = row.hash;
      entriesChecked += 1;
    }

    return { valid: true, entriesChecked };
  }

  /**
   * Export entries in the given range as an async iterable. Entries are
   * yielded in seq-ascending order so consumers can stream to a file without
   * loading everything into memory.
   */
  async *export(opts: { sinceMs?: number; untilMs?: number } = {}): AsyncIterable<AuditEntry> {
    const sinceMs = opts.sinceMs ?? 0;
    const untilMs = opts.untilMs ?? Number.MAX_SAFE_INTEGER;
    const rows = this.db
      .prepare(
        'SELECT seq, prev_hash, hash, event_type, payload_json, signature, signature_alg, created_at ' +
          'FROM audit_log_chain WHERE created_at >= ? AND created_at <= ? ORDER BY seq ASC',
      )
      .iterate(sinceMs, untilMs) as IterableIterator<ChainRow>;

    for (const row of rows) {
      yield {
        seq: row.seq,
        prevHash: row.prev_hash,
        hash: row.hash,
        eventType: row.event_type,
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        signature: row.signature,
        signatureAlg: row.signature_alg,
        createdAt: new Date(row.created_at),
      };
    }
  }

  /** Return the most recent entry, or null if the chain is empty. */
  latest(): AuditEntry | null {
    const row = this.db
      .prepare(
        'SELECT seq, prev_hash, hash, event_type, payload_json, signature, signature_alg, created_at ' +
          'FROM audit_log_chain ORDER BY seq DESC LIMIT 1',
      )
      .get() as ChainRow | undefined;
    if (!row) return null;
    return {
      seq: row.seq,
      prevHash: row.prev_hash,
      hash: row.hash,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      signature: row.signature,
      signatureAlg: row.signature_alg,
      createdAt: new Date(row.created_at),
    };
  }

  /** Count entries in the chain. */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM audit_log_chain').get() as { n: number };
    return row.n;
  }

  /** Whether the chain is configured to sign entries with HMAC. */
  isSigned(): boolean {
    return this.signatureKey !== null;
  }

  /** Close the underlying database handle. */
  close(): void {
    this.db.close();
  }
}
