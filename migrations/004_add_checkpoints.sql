-- Migration: Add Agent Checkpoints (Durable Execution)
-- Created: 2026-05-28
-- Description: Adds agent_checkpoints table for durable execution / crash recovery.
--              Allows workflows to be resumed after a process crash by replaying
--              the last serialized agent state for each (session_id, agent_id, step_id).
--
-- Issue: AIG-633

-- ==================== UP ====================

-- Agent checkpoints table — durable execution state snapshots
-- One row per (session, agent, step). The state_blob is JSON serialized (gzip optional)
-- agent state at the end of that step. `format` indicates encoding ('json' or 'json+gzip').
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  state_blob TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'json+gzip')),
  metadata TEXT,
  created_at INTEGER NOT NULL
);

-- Composite index for the most common access pattern:
-- "give me the latest checkpoint for this session ordered by time"
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session_created
  ON agent_checkpoints(session_id, created_at DESC);

-- Index for per-agent lookups within a session
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session_agent
  ON agent_checkpoints(session_id, agent_id, created_at DESC);

-- Index for retrieving a specific step (deterministic replay)
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session_step
  ON agent_checkpoints(session_id, step_id);

-- ==================== DOWN ====================

-- To rollback this migration, run the following:
-- DROP INDEX IF EXISTS idx_agent_checkpoints_session_step;
-- DROP INDEX IF EXISTS idx_agent_checkpoints_session_agent;
-- DROP INDEX IF EXISTS idx_agent_checkpoints_session_created;
-- DROP TABLE IF EXISTS agent_checkpoints;
