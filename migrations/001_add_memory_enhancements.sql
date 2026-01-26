-- Migration: Add Memory Enhancements (Tags, Relationships, Versions)
-- Created: 2026-01-26
-- Description: Adds tagging system, knowledge graph relationships, and version history

-- ==================== UP ====================

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- Memory-Tags junction table
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, tag_id),
  FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_memory_tags_composite ON memory_tags(tag_id, memory_id);

-- Memory relationships table
CREATE TABLE IF NOT EXISTS memory_relationships (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_id) REFERENCES memory(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id) REFERENCES memory(id) ON DELETE CASCADE,
  UNIQUE(from_id, to_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_memory_relationships_from ON memory_relationships(from_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_to ON memory_relationships(to_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_type ON memory_relationships(relationship_type);

-- Memory versions table (for version history)
CREATE TABLE IF NOT EXISTS memory_versions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  key TEXT NOT NULL,
  namespace TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE,
  UNIQUE(memory_id, version)
);

CREATE INDEX IF NOT EXISTS idx_memory_versions_memory ON memory_versions(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_versions_created ON memory_versions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_versions_memory_version ON memory_versions(memory_id, version DESC);

-- ==================== DOWN ====================

-- To rollback this migration, run the following:
-- DROP TABLE IF EXISTS memory_versions;
-- DROP TABLE IF EXISTS memory_relationships;
-- DROP TABLE IF EXISTS memory_tags;
-- DROP TABLE IF EXISTS tags;
