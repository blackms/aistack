-- Migration: Add Hierarchical Memory Tiers (working/recall/archival)
-- Created: 2026-05-28
-- Issue: AIG-651
-- Description: Adds OS-style hierarchical memory tiering to the `memory` table.
--   - working: hot in-context entries (top N most recent/relevant, < ~4k tokens)
--   - recall:  warm storage backed by SQLite FTS5 + vector index (current default)
--   - archival: cold compressed storage with optional LLM summary, lazy restore
--
-- Auto-paging worker (src/memory/tiers/auto-pager.ts) migrates entries between
-- tiers based on access frequency and age. See docs/MEMORY.md.
--
-- NOTE: This migration is additive only (ALTER ADD COLUMN with defaults). It does
-- NOT modify existing rows beyond setting the default tier='recall'. It is safe
-- to apply alongside AIG-635 (audit hash-chain) and AIG-640 (Memory Tool /
-- Dreaming) which operate on different concerns.

-- ==================== UP ====================

-- Tier column: which tier this entry currently lives in.
-- Defaults to 'recall' so existing entries keep current SQLite-backed semantics.
ALTER TABLE memory ADD COLUMN tier TEXT NOT NULL DEFAULT 'recall'
  CHECK (tier IN ('working', 'recall', 'archival'));

-- Access count: incremented by TierManager.touch() on read/search hits.
-- Used by the auto-pager to compute promotion candidates.
ALTER TABLE memory ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;

-- Last accessed timestamp (ms epoch). NULL for entries never read since migration.
-- Used by the auto-pager to compute demotion candidates.
ALTER TABLE memory ADD COLUMN last_accessed_at INTEGER;

-- Optional summary text generated when entry is archived. Allows search hits
-- on archived entries without decompressing the full payload.
ALTER TABLE memory ADD COLUMN summary TEXT;

-- Optional gzipped payload of the original content, set when tier='archival'.
-- When non-null, the `content` column holds the summary or a short preview and
-- the full content is restored on demand via TierManager.restore().
ALTER TABLE memory ADD COLUMN archived_content BLOB;

-- Indexes for paging queries
CREATE INDEX IF NOT EXISTS idx_memory_tier ON memory(tier);
CREATE INDEX IF NOT EXISTS idx_memory_last_accessed ON memory(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_tier_accessed ON memory(tier, last_accessed_at DESC);

-- ==================== DOWN ====================

-- SQLite < 3.35 does not support DROP COLUMN. To rollback on older versions,
-- copy `memory` into a new table without these columns, drop the original, and
-- rename. On SQLite >= 3.35:
--
-- DROP INDEX IF EXISTS idx_memory_tier_accessed;
-- DROP INDEX IF EXISTS idx_memory_last_accessed;
-- DROP INDEX IF EXISTS idx_memory_tier;
-- ALTER TABLE memory DROP COLUMN archived_content;
-- ALTER TABLE memory DROP COLUMN summary;
-- ALTER TABLE memory DROP COLUMN last_accessed_at;
-- ALTER TABLE memory DROP COLUMN access_count;
-- ALTER TABLE memory DROP COLUMN tier;
