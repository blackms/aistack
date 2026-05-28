/**
 * Archival helpers — pure functions for compressing / decompressing memory
 * payloads. Kept separate from TierManager so the LLM summarization hook can
 * be swapped or unit-tested in isolation.
 *
 * The default archival format is plain gzip of the UTF-8 content. LLM
 * summarization is intentionally lazy: AutoPager runs may schedule
 * summarization but it is NOT required for correctness — searches on
 * archived entries fall back to the stored summary or a preview slice (see
 * TierManager.applyTransition).
 */

import { gzipSync, gunzipSync } from 'node:zlib';

/**
 * Hook used to generate an optional summary at archival time. Implementations
 * are expected to be best-effort and may return null to indicate "no summary".
 */
export type ArchivalSummarizer = (content: string) => Promise<string | null>;

export interface ArchiveResult {
  /** gzipped UTF-8 payload. */
  compressed: Buffer;
  /** Optional LLM-generated summary, when a summarizer was provided. */
  summary: string | null;
  /** Short preview safe to keep in the `content` column for FTS visibility. */
  preview: string;
}

/**
 * Compress a content string and optionally generate a summary.
 *
 * `summarizer` is awaited only if provided. Failures from the summarizer are
 * swallowed and treated as "no summary" — never let archival fail because the
 * LLM was unavailable.
 */
export async function archiveEntry(
  content: string,
  summarizer?: ArchivalSummarizer
): Promise<ArchiveResult> {
  const compressed = gzipSync(Buffer.from(content, 'utf-8'));
  let summary: string | null = null;
  if (summarizer) {
    try {
      summary = await summarizer(content);
    } catch {
      // Best-effort: archival must not fail due to a flaky summarizer.
      summary = null;
    }
  }
  const previewSource = summary ?? content;
  const preview =
    previewSource.length > 280 ? previewSource.slice(0, 277) + '...' : previewSource;
  return { compressed, summary, preview };
}

/**
 * Restore an archived buffer back into its original UTF-8 string.
 */
export function restoreEntry(compressed: Buffer): string {
  return gunzipSync(compressed).toString('utf-8');
}
