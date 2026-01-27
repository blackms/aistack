-- Migration: Add Agent Identity Support
-- Created: 2026-01-27
-- Description: Adds persistent agent identity with lifecycle management and memory scoping

-- ==================== UP ====================

-- Agent Identities table
CREATE TABLE IF NOT EXISTS agent_identities (
  agent_id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'active', 'dormant', 'retired')),
  capabilities TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT,
  description TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  retired_at INTEGER,
  retirement_reason TEXT,
  created_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_identities_type ON agent_identities(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_identities_status ON agent_identities(status);
CREATE INDEX IF NOT EXISTS idx_agent_identities_last_active ON agent_identities(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_identities_display_name ON agent_identities(display_name);

-- Agent Identity Audit Log
CREATE TABLE IF NOT EXISTS agent_identity_audit (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('created', 'activated', 'deactivated', 'retired', 'updated', 'spawned')),
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  actor_id TEXT,
  metadata TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agent_identities(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_identity_audit_agent ON agent_identity_audit(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_identity_audit_timestamp ON agent_identity_audit(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_identity_audit_action ON agent_identity_audit(action);

-- Add identity_id to active_agents for linking spawned agents to identities
-- Note: SQLite doesn't support adding constraints via ALTER TABLE, so we just add the column
ALTER TABLE active_agents ADD COLUMN identity_id TEXT REFERENCES agent_identities(agent_id);
CREATE INDEX IF NOT EXISTS idx_active_agents_identity ON active_agents(identity_id);

-- Add agent_id to memory for scoped memory ownership
ALTER TABLE memory ADD COLUMN agent_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_agent_id ON memory(agent_id);

-- Add agent_id to memory_versions for version history tracking
ALTER TABLE memory_versions ADD COLUMN agent_id TEXT DEFAULT NULL;

-- ==================== DOWN ====================

-- To rollback this migration, run the following:
-- Note: SQLite doesn't support DROP COLUMN, so rollback requires recreating tables
-- DROP INDEX IF EXISTS idx_memory_agent_id;
-- DROP INDEX IF EXISTS idx_active_agents_identity;
-- DROP INDEX IF EXISTS idx_agent_identity_audit_action;
-- DROP INDEX IF EXISTS idx_agent_identity_audit_timestamp;
-- DROP INDEX IF EXISTS idx_agent_identity_audit_agent;
-- DROP INDEX IF EXISTS idx_agent_identities_display_name;
-- DROP INDEX IF EXISTS idx_agent_identities_last_active;
-- DROP INDEX IF EXISTS idx_agent_identities_status;
-- DROP INDEX IF EXISTS idx_agent_identities_type;
-- DROP TABLE IF EXISTS agent_identity_audit;
-- DROP TABLE IF EXISTS agent_identities;
