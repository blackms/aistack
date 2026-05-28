/**
 * AuditChain tests (AIG-635)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  AuditChain,
  GENESIS_PREV_HASH,
  MAX_PAYLOAD_BYTES,
  canonicalJSONStringify,
  computeEntryHash,
} from '../../src/audit/chain.js';

describe('AuditChain', () => {
  let tmpDir: string;
  let dbPath: string;
  let chain: AuditChain;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aistack-audit-test-'));
    dbPath = join(tmpDir, 'audit.db');
  });

  afterEach(() => {
    try {
      chain?.close();
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('canonicalJSONStringify', () => {
    it('produces stable output regardless of key order', () => {
      const a = { b: 1, a: 2, c: { y: 3, x: 4 } };
      const b = { c: { x: 4, y: 3 }, a: 2, b: 1 };
      expect(canonicalJSONStringify(a)).toBe(canonicalJSONStringify(b));
      expect(canonicalJSONStringify(a)).toBe('{"a":2,"b":1,"c":{"x":4,"y":3}}');
    });

    it('handles nested arrays and null', () => {
      const v = { items: [3, 1, 2], n: null };
      expect(canonicalJSONStringify(v)).toBe('{"items":[3,1,2],"n":null}');
    });
  });

  describe('computeEntryHash', () => {
    it('is deterministic for same inputs', () => {
      const args = {
        prevHash: GENESIS_PREV_HASH,
        createdAtMs: 1700000000000,
        eventType: 'agent.spawn',
        payload: { agentId: 'abc', type: 'coder' },
      };
      expect(computeEntryHash(args)).toBe(computeEntryHash(args));
    });

    it('changes when any field changes', () => {
      const base = {
        prevHash: GENESIS_PREV_HASH,
        createdAtMs: 1700000000000,
        eventType: 'agent.spawn',
        payload: { x: 1 },
      };
      const h0 = computeEntryHash(base);
      expect(computeEntryHash({ ...base, eventType: 'agent.stop' })).not.toBe(h0);
      expect(computeEntryHash({ ...base, createdAtMs: base.createdAtMs + 1 })).not.toBe(h0);
      expect(computeEntryHash({ ...base, payload: { x: 2 } })).not.toBe(h0);
      expect(computeEntryHash({ ...base, prevHash: 'f'.repeat(64) })).not.toBe(h0);
    });
  });

  describe('append + verify roundtrip', () => {
    it('appends and verifies an empty-then-populated chain', () => {
      chain = new AuditChain({ dbPath });
      expect(chain.count()).toBe(0);
      const r = chain.verify();
      expect(r.valid).toBe(true);
      expect(r.entriesChecked).toBe(0);

      const a = chain.append('agent.spawn', { agentId: 'a1', type: 'coder' });
      expect(a.seq).toBe(1);
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);

      const b = chain.append('agent.stop', { agentId: 'a1' });
      expect(b.seq).toBe(2);

      const verified = chain.verify();
      expect(verified.valid).toBe(true);
      expect(verified.entriesChecked).toBe(2);
      expect(chain.count()).toBe(2);
    });

    it('chain integrity holds over 100 entries', () => {
      chain = new AuditChain({ dbPath });
      for (let i = 0; i < 100; i += 1) {
        chain.append('task.create', { taskId: `t${i}`, i });
      }
      const r = chain.verify();
      expect(r.valid).toBe(true);
      expect(r.entriesChecked).toBe(100);
      expect(chain.count()).toBe(100);

      // latest links back to seq 100
      const latest = chain.latest();
      expect(latest?.seq).toBe(100);
      expect(latest?.eventType).toBe('task.create');
    });
  });

  describe('tamper detection', () => {
    it('verify() detects payload tampering and reports broken seq', () => {
      chain = new AuditChain({ dbPath });
      chain.append('agent.spawn', { agentId: 'a1' });
      chain.append('agent.spawn', { agentId: 'a2' });
      chain.append('agent.spawn', { agentId: 'a3' });
      chain.close();

      // Tamper directly via raw DB (bypassing append-only triggers) by
      // disabling them, then re-checking. SQLite allows trigger removal so we
      // simulate an adversary with file-level access.
      const raw = new Database(dbPath);
      raw.exec('DROP TRIGGER IF EXISTS audit_log_chain_no_update');
      raw.prepare("UPDATE audit_log_chain SET payload_json = ? WHERE seq = 2").run(
        JSON.stringify({ agentId: 'EVIL' }),
      );
      raw.close();

      chain = new AuditChain({ dbPath });
      const r = chain.verify();
      expect(r.valid).toBe(false);
      expect(r.brokenAt).toBe(2);
      expect(r.reason).toContain('hash mismatch');
      // First entry was valid, so entriesChecked == 1.
      expect(r.entriesChecked).toBe(1);
    });

    it('verify() detects prev_hash linkage break', () => {
      chain = new AuditChain({ dbPath });
      chain.append('a', {});
      chain.append('b', {});
      chain.close();

      const raw = new Database(dbPath);
      raw.exec('DROP TRIGGER IF EXISTS audit_log_chain_no_update');
      raw.prepare('UPDATE audit_log_chain SET prev_hash = ? WHERE seq = 2').run('0'.repeat(64));
      raw.close();

      chain = new AuditChain({ dbPath });
      const r = chain.verify();
      expect(r.valid).toBe(false);
      expect(r.brokenAt).toBe(2);
      expect(r.reason).toContain('prev_hash mismatch');
    });
  });

  describe('HMAC signing', () => {
    it('signs entries and verifies HMAC end-to-end', () => {
      const key = randomBytes(32);
      chain = new AuditChain({ dbPath, signatureKey: key });
      expect(chain.isSigned()).toBe(true);

      chain.append('agent.spawn', { agentId: 'a1' });
      chain.append('agent.stop', { agentId: 'a1' });

      const r = chain.verify();
      expect(r.valid).toBe(true);
      expect(r.entriesChecked).toBe(2);

      const latest = chain.latest();
      expect(latest?.signatureAlg).toBe('HMAC-SHA256');
      expect(latest?.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verify() fails when key changes', () => {
      const k1 = randomBytes(32);
      chain = new AuditChain({ dbPath, signatureKey: k1 });
      chain.append('x', {});
      chain.close();

      const k2 = randomBytes(32);
      chain = new AuditChain({ dbPath, signatureKey: k2 });
      const r = chain.verify();
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('signature mismatch');
    });

    it('rejects keys shorter than 32 bytes', () => {
      expect(() => new AuditChain({ dbPath, signatureKey: 'short' })).toThrow(/at least 32 bytes/);
    });
  });

  describe('export', () => {
    it('exports entries in JSONL-compatible iteration order', async () => {
      chain = new AuditChain({ dbPath });
      for (let i = 0; i < 5; i += 1) {
        chain.append('task.create', { i });
      }
      const collected: number[] = [];
      for await (const e of chain.export()) {
        collected.push(e.seq);
        expect(typeof e.hash).toBe('string');
        expect(e.payload).toBeDefined();
      }
      expect(collected).toEqual([1, 2, 3, 4, 5]);
    });

    it('export entries are re-importable on a second machine and re-verifiable', async () => {
      const key = randomBytes(32);
      chain = new AuditChain({ dbPath, signatureKey: key });
      chain.append('agent.spawn', { agentId: 'a1' });
      chain.append('task.create', { taskId: 't1' });
      chain.append('task.complete', { taskId: 't1' });

      const exported: Array<{
        prev_hash: string;
        hash: string;
        event_type: string;
        payload_json: string;
        signature: string | null;
        signature_alg: string | null;
        created_at: number;
      }> = [];
      for await (const e of chain.export()) {
        exported.push({
          prev_hash: e.prevHash,
          hash: e.hash,
          event_type: e.eventType,
          payload_json: canonicalJSONStringify(e.payload),
          signature: e.signature,
          signature_alg: e.signatureAlg,
          created_at: e.createdAt.getTime(),
        });
      }
      chain.close();

      // Simulate a separate evidence-pack DB on a second machine.
      const otherPath = join(tmpDir, 'evidence.db');
      const raw = new Database(otherPath);
      raw.exec(`
        CREATE TABLE audit_log_chain (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          prev_hash TEXT NOT NULL,
          hash TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          signature TEXT,
          signature_alg TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      const stmt = raw.prepare(
        'INSERT INTO audit_log_chain (prev_hash, hash, event_type, payload_json, signature, signature_alg, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const r of exported) {
        stmt.run(r.prev_hash, r.hash, r.event_type, r.payload_json, r.signature, r.signature_alg, r.created_at);
      }
      raw.close();

      // Re-open with same key and verify.
      chain = new AuditChain({ dbPath: otherPath, signatureKey: key });
      const r = chain.verify();
      expect(r.valid).toBe(true);
      expect(r.entriesChecked).toBe(3);
    });
  });

  describe('payload size limits', () => {
    it('rejects payloads exceeding MAX_PAYLOAD_BYTES in strict mode', () => {
      chain = new AuditChain({ dbPath });
      const big = 'x'.repeat(MAX_PAYLOAD_BYTES + 1);
      expect(() => chain.append('big', { blob: big })).toThrow(/too large/);
    });
  });

  describe('redaction', () => {
    it('redacts configured fields before hashing/storage', async () => {
      chain = new AuditChain({ dbPath, redactFields: ['content', 'apiKey'] });
      chain.append('memory.write', { key: 'foo', content: 'SECRET', apiKey: 'sk-xxx', namespace: 'n' });
      let entry: { payload: Record<string, unknown> } | null = null;
      for await (const e of chain.export()) {
        entry = e;
      }
      expect(entry?.payload.content).toBe('[REDACTED]');
      expect(entry?.payload.apiKey).toBe('[REDACTED]');
      expect(entry?.payload.key).toBe('foo');
      expect(entry?.payload.namespace).toBe('n');
    });
  });

  describe('append-only triggers', () => {
    it('blocks UPDATE on audit_log_chain', () => {
      chain = new AuditChain({ dbPath });
      chain.append('x', { v: 1 });
      // Reach into the connection used by the chain via a sibling raw handle.
      const raw = new Database(dbPath);
      expect(() => raw.prepare("UPDATE audit_log_chain SET event_type = 'evil' WHERE seq = 1").run()).toThrow(
        /append-only/,
      );
      raw.close();
    });

    it('blocks DELETE on audit_log_chain', () => {
      chain = new AuditChain({ dbPath });
      chain.append('x', { v: 1 });
      const raw = new Database(dbPath);
      expect(() => raw.prepare('DELETE FROM audit_log_chain WHERE seq = 1').run()).toThrow(/append-only/);
      raw.close();
    });
  });
});
