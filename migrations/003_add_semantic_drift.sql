-- Migration: Add Semantic Drift Detection Support
-- Created: 2026-01-27
-- Description: Adds task embeddings, relationships, and drift detection events for semantic drift detection

-- ==================== UP ====================

-- Task embeddings (separate table for performance)
CREATE TABLE IF NOT EXISTS task_embeddings (
  task_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_embeddings_created ON task_embeddings(created_at DESC);

-- Task relationships for parent/ancestor tracking
CREATE TABLE IF NOT EXISTS task_relationships (
  id TEXT PRIMARY KEY,
  from_task_id TEXT NOT NULL,
  to_task_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('parent_of', 'derived_from', 'depends_on', 'supersedes')),
  metadata TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (to_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(from_task_id, to_task_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_task_relationships_from ON task_relationships(from_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relationships_to ON task_relationships(to_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relationships_type ON task_relationships(relationship_type);

-- Drift detection events log (for metrics)
CREATE TABLE IF NOT EXISTS drift_detection_events (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  task_type TEXT NOT NULL,
  ancestor_task_id TEXT NOT NULL,
  similarity_score REAL NOT NULL,
  threshold REAL NOT NULL,
  action_taken TEXT NOT NULL CHECK (action_taken IN ('allowed', 'warned', 'prevented')),
  task_input TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drift_detection_events_task ON drift_detection_events(task_id);
CREATE INDEX IF NOT EXISTS idx_drift_detection_events_created ON drift_detection_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drift_detection_events_action ON drift_detection_events(action_taken);

-- ==================== DOWN ====================

-- To rollback this migration, run the following:
-- DROP INDEX IF EXISTS idx_drift_detection_events_action;
-- DROP INDEX IF EXISTS idx_drift_detection_events_created;
-- DROP INDEX IF EXISTS idx_drift_detection_events_task;
-- DROP TABLE IF EXISTS drift_detection_events;
-- DROP INDEX IF EXISTS idx_task_relationships_type;
-- DROP INDEX IF EXISTS idx_task_relationships_to;
-- DROP INDEX IF EXISTS idx_task_relationships_from;
-- DROP TABLE IF EXISTS task_relationships;
-- DROP INDEX IF EXISTS idx_task_embeddings_created;
-- DROP TABLE IF EXISTS task_embeddings;
