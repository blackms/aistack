-- Migration: Hash-chained immutable audit log (AIG-635)
-- Created: 2026-05-28
-- Description: Append-only audit trail with cryptographic hash chain for SOC2/ISO27001/HIPAA evidence.
--
-- Each row contains a SHA-256 hash of (prev_hash + timestamp + event_type + payload), making the
-- chain tamper-evident: any modification to a row breaks the chain at that point and propagates
-- forward. UPDATE/DELETE are blocked by triggers to enforce immutability at the storage layer.

-- ==================== UP ====================

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

-- Enforce append-only semantics: block UPDATE and DELETE.
-- These triggers are the storage-layer guarantee that complements the hash chain.
-- Anyone with write access to the file can still drop the table or modify the SQLite
-- file directly; the chain hash makes such tampering detectable on verify.
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

-- ==================== DOWN ====================

-- Rollback (manual, for development only — never run in production):
-- DROP TRIGGER IF EXISTS audit_log_chain_no_delete;
-- DROP TRIGGER IF EXISTS audit_log_chain_no_update;
-- DROP INDEX IF EXISTS idx_audit_log_chain_created_at;
-- DROP INDEX IF EXISTS idx_audit_log_chain_event_type;
-- DROP TABLE IF EXISTS audit_log_chain;
