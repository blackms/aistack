/**
 * Portable Agent File schema (`.aistack-agent`)
 *
 * Defines a versioned JSON envelope describing a single agent that can be
 * exported from one aistack installation and imported into another (or into
 * a third-party tool that speaks a compatible subset). The format is modeled
 * on Letta's `.af` Agent File (https://www.letta.com/blog/our-next-phase)
 * but tailored to aistack's identity + namespaced-memory model.
 *
 * Security: this schema deliberately has NO field for secrets (API keys,
 * tokens, OAuth refresh, etc.). Bundle producers MUST strip such values
 * before writing. Bundle consumers should run `validatePortableFile` and
 * reject any unexpected top-level keys (handled by zod `.strict()`).
 *
 * Single source of truth for runtime validation and TypeScript inference.
 */

import { z } from 'zod';

/** Current spec version. Bump when introducing a breaking change. */
export const PORTABLE_FORMAT_VERSION = '1.0';

/** Magic string written into every bundle for sanity checks. */
export const PORTABLE_MAGIC = 'aistack-agent';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const AgentSectionSchema = z
  .object({
    /** Agent type — matches aistack registry (`coder`, `researcher`, ...). */
    type: z.string().min(1),
    /** Human-readable display name. Not unique. */
    name: z.string().min(1),
    /** Stable identity UUID (optional — may be regenerated on import). */
    identity_id: z.string().uuid().optional(),
    /** Optional system prompt override (otherwise uses registry default). */
    system_prompt_override: z.string().nullable().optional(),
    /** Whitelist of tools the agent is allowed to call. */
    tool_whitelist: z.array(z.string()).optional(),
    /** Suggested model alias (`sonnet` | `opus` | `haiku` | provider-id). */
    model: z.string().optional(),
    /** Free-form capabilities list (mirrors AgentDefinition.capabilities). */
    capabilities: z.array(z.string()).optional(),
    /** Free-form description shown in marketplaces. */
    description: z.string().optional(),
  })
  .strict();

const MemoryEntrySchema = z
  .object({
    key: z.string(),
    namespace: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const MemorySnapshotSchema = z
  .object({
    /** Serialization scheme. `json-entries` is the portable default. */
    format: z.literal('json-entries'),
    /** Number of entries embedded (for quick UI display). */
    entries_count: z.number().int().nonnegative(),
    /** The entries themselves. Empty array when exported with --no-memory. */
    entries: z.array(MemoryEntrySchema),
  })
  .strict();

const MetadataSectionSchema = z
  .object({
    exported_at: z.string().datetime(),
    exporter: z.string(),
    /** Producer aistack version (informational). */
    aistack_version: z.string().optional(),
    /** Free-form labels (e.g. `["secure-default", "battle-tested"]`). */
    labels: z.array(z.string()).optional(),
    /** Original source if the agent was imported from another tool. */
    source: z
      .object({
        tool: z.string(),
        original_id: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Top-level file schema
// ---------------------------------------------------------------------------

export const PortableAgentFileSchema = z
  .object({
    /** Magic literal so simple file-type detection works. */
    magic: z.literal(PORTABLE_MAGIC),
    /** Spec version (semver-ish; minor bumps remain backward-compatible). */
    format_version: z.string().regex(/^\d+\.\d+$/),
    agent: AgentSectionSchema,
    memory_snapshot: MemorySnapshotSchema,
    metadata: MetadataSectionSchema,
  })
  .strict();

export type PortableAgentFile = z.infer<typeof PortableAgentFileSchema>;
export type PortableAgentSection = z.infer<typeof AgentSectionSchema>;
export type PortableMemorySnapshot = z.infer<typeof MemorySnapshotSchema>;
export type PortableMemoryEntry = z.infer<typeof MemoryEntrySchema>;
export type PortableMetadata = z.infer<typeof MetadataSectionSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Keys that must NEVER be persisted into a portable file (security floor). */
export const FORBIDDEN_METADATA_KEYS = new Set<string>([
  'apiKey',
  'api_key',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'session_token',
  'private_key',
]);

/**
 * Strip well-known secret-looking keys from a metadata record. Returns a
 * shallow copy; nested objects are inspected one level deep, which is
 * sufficient for the metadata shapes aistack emits today.
 */
export function stripSecrets(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!meta) {
    return meta;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_METADATA_KEYS.has(k)) {
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripSecrets(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
