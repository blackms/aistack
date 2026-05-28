/**
 * Portable Agent File — export / import / Letta `.af` interop
 *
 * Public API:
 *   - exportAgent(agentId, opts)      -> PortableAgentFile
 *   - exportAgentByType(type, opts)   -> PortableAgentFile (for unspawned templates)
 *   - importAgent(file, opts)         -> { agentId, identityId }
 *   - serialize(file)                 -> string (JSON)
 *   - parse(text)                     -> PortableAgentFile  (validated)
 *   - validatePortableFile(unknown)   -> PortableAgentFile  (validated)
 *   - importLettaAf(unknown)          -> PortableAgentFile  (best-effort)
 *
 * Round-trip guarantee: `parse(serialize(exportAgent(id))) === exportAgent(id)`
 * modulo `metadata.exported_at` (re-stamped on each export).
 *
 * Security: secrets are stripped at export time via `stripSecrets`. Bundles
 * never embed env-var values, API keys, or OAuth tokens — see
 * `docs/AGENT_FILE_SPEC.md` for the full security model.
 */

import { createHash } from 'node:crypto';
import type { AgentStackConfig, AgentIdentity, MemoryEntry } from '../types.js';
import { getAgentDefinition } from './registry.js';
import { getIdentityService } from './identity-service.js';
import { getMemoryManager } from '../memory/index.js';
import { logger } from '../utils/logger.js';
import {
  IncompatibleFileVersionError,
  PORTABLE_FORMAT_VERSION,
  PORTABLE_MAGIC,
  PortableAgentFileSchema,
  SUPPORTED_MAJOR_VERSION,
  parseFormatVersion,
  stripSecrets,
  type PortableAgentFile,
  type PortableAgentSection,
  type PortableIntegrity,
  type PortableMemoryEntry,
  type PortableMemorySnapshot,
} from './portable-schema.js';

const log = logger.child('portable');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Skip embedding memory entries (default: false — memory IS included). */
  noMemory?: boolean;
  /** Override exporter signature (default: `aistack@<version>`). */
  exporterName?: string;
  /** Free-form labels written into `metadata.labels`. */
  labels?: string[];
  /** aistack version string for `metadata.aistack_version`. */
  aistackVersion?: string;
}

export interface ImportOptions {
  /** Rename the imported agent (overrides `agent.name` in the file). */
  rename?: string;
  /**
   * Skip restoring memory entries even if the bundle contains them.
   * Useful when sharing across users where memory may include private data.
   */
  noMemory?: boolean;
  /**
   * Force a fresh identity_id even when the bundle has one. Use when the
   * source identity is known to be in use locally.
   */
  newIdentity?: boolean;
}

export interface ImportResult {
  identityId: string;
  agentType: string;
  agentName: string;
  importedEntries: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Build a `PortableAgentFile` snapshot for a live identity. The identity is
 * looked up in the IdentityService; memory entries owned by `agentId` (the
 * identity's `agentId` field) are collected via the MemoryManager.
 */
export function exportAgent(
  identityId: string,
  config: AgentStackConfig,
  opts: ExportOptions = {}
): PortableAgentFile {
  const identityService = getIdentityService(config);
  const identity = identityService.getIdentity(identityId);
  if (!identity) {
    throw new Error(`Identity not found: ${identityId}`);
  }

  const definition = getAgentDefinition(identity.agentType);
  if (!definition) {
    throw new Error(`Unknown agent type for identity ${identityId}: ${identity.agentType}`);
  }

  const agentSection: PortableAgentSection = {
    type: identity.agentType,
    name: identity.displayName ?? definition.name,
    identity_id: identity.agentId,
    system_prompt_override: extractSystemPromptOverride(identity, definition.systemPrompt),
    tool_whitelist: extractToolWhitelist(identity),
    model: extractModel(identity),
    capabilities: identity.capabilities?.filter((c) => c.enabled).map((c) => c.name),
    description: identity.description ?? definition.description,
  };

  const memory_snapshot = opts.noMemory
    ? emptySnapshot()
    : collectMemorySnapshot(identity.agentId, config);

  const file: PortableAgentFile = {
    magic: PORTABLE_MAGIC,
    format_version: PORTABLE_FORMAT_VERSION,
    agent: agentSection,
    memory_snapshot,
    metadata: {
      exported_at: new Date().toISOString(),
      exporter: opts.exporterName ?? 'aistack-cli',
      aistack_version: opts.aistackVersion,
      labels: opts.labels,
    },
    integrity: null,
  };

  // Validate before sealing so we never emit a broken file. Then attach
  // the SHA-256 digest computed over the envelope with `integrity: null`,
  // which gives importers a stable byte-for-byte target to recompute.
  const validated = validatePortableFile(file);
  validated.integrity = computeIntegrity(validated);
  return validated;
}

/**
 * Export a built-in agent template (no spawned identity, no memory).
 * Useful for shipping reference agents in `examples/shared-agents/`.
 */
export function exportAgentByType(
  type: string,
  opts: ExportOptions = {}
): PortableAgentFile {
  const definition = getAgentDefinition(type);
  if (!definition) {
    throw new Error(`Unknown agent type: ${type}`);
  }

  const file: PortableAgentFile = {
    magic: PORTABLE_MAGIC,
    format_version: PORTABLE_FORMAT_VERSION,
    agent: {
      type: definition.type,
      name: definition.name,
      capabilities: definition.capabilities,
      description: definition.description,
      system_prompt_override: null,
    },
    memory_snapshot: emptySnapshot(),
    metadata: {
      exported_at: new Date().toISOString(),
      exporter: opts.exporterName ?? 'aistack-cli',
      aistack_version: opts.aistackVersion,
      labels: opts.labels ?? ['template'],
    },
    integrity: null,
  };

  const validated = validatePortableFile(file);
  validated.integrity = computeIntegrity(validated);
  return validated;
}

function emptySnapshot(): PortableMemorySnapshot {
  return {
    format: 'json-entries',
    entries_count: 0,
    entries: [],
  };
}

function extractSystemPromptOverride(
  identity: AgentIdentity,
  defaultPrompt: string
): string | null {
  const override = identity.metadata?.systemPromptOverride;
  if (typeof override === 'string' && override !== defaultPrompt) {
    return override;
  }
  return null;
}

/**
 * Pull `tool_whitelist` from `identity.metadata`. Accept both `toolWhitelist`
 * (camelCase, the canonical aistack key) and `tool_whitelist` (snake_case,
 * mirroring the on-disk field). Returns undefined when neither is present or
 * the value is not a non-empty string[] — empty arrays are dropped so they
 * do not survive a round-trip as `[]`.
 */
function extractToolWhitelist(identity: AgentIdentity): string[] | undefined {
  const raw =
    identity.metadata?.toolWhitelist ?? identity.metadata?.tool_whitelist;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const filtered = raw.filter((v): v is string => typeof v === 'string');
  return filtered.length > 0 ? filtered : undefined;
}

/** Pull `model` (suggested model alias) from `identity.metadata`. */
function extractModel(identity: AgentIdentity): string | undefined {
  const raw = identity.metadata?.model;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function collectMemorySnapshot(
  agentId: string,
  config: AgentStackConfig
): PortableMemorySnapshot {
  const memory = getMemoryManager(config);
  const entries = memory.getAgentMemory(agentId, { limit: 10000, includeShared: false });
  const mapped: PortableMemoryEntry[] = entries.map((e) => toPortableEntry(e));
  return {
    format: 'json-entries',
    entries_count: mapped.length,
    entries: mapped,
  };
}

function toPortableEntry(e: MemoryEntry): PortableMemoryEntry {
  return {
    key: e.key,
    namespace: e.namespace,
    content: e.content,
    tags: e.tags,
    metadata: stripSecrets(e.metadata),
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Deterministic JSON serializer (2-space indent for diff-friendliness). */
export function serialize(file: PortableAgentFile): string {
  return JSON.stringify(file, null, 2);
}

/** Parse + validate. Throws ZodError on invalid input. */
export function parse(text: string): PortableAgentFile {
  const raw = JSON.parse(text) as unknown;
  return validatePortableFile(raw);
}

/**
 * Validate any value against the portable schema AND enforce the documented
 * major-version gate. A bundle whose `format_version` major does not match
 * `SUPPORTED_MAJOR_VERSION` is rejected with `IncompatibleFileVersionError`
 * — the docs promise this and the importer must back it up.
 */
export function validatePortableFile(value: unknown): PortableAgentFile {
  const parsed = PortableAgentFileSchema.parse(value);
  const v = parseFormatVersion(parsed.format_version);
  if (!v || v.major !== SUPPORTED_MAJOR_VERSION) {
    throw new IncompatibleFileVersionError(
      parsed.format_version,
      SUPPORTED_MAJOR_VERSION
    );
  }
  return parsed;
}

/**
 * Compute the bundle's SHA-256 integrity digest. The digest is taken over
 * the JSON-serialized envelope with `integrity` set to `null` so that the
 * field can be embedded after the fact without invalidating itself. The
 * serialization is the same deterministic 2-space-indent JSON used by
 * `serialize`, guaranteeing reproducible digests across runtimes.
 */
export function computeIntegrity(file: PortableAgentFile): PortableIntegrity {
  const canonical: PortableAgentFile = { ...file, integrity: null };
  const bytes = Buffer.from(serialize(canonical), 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { algo: 'sha256', digest };
}

/**
 * Verify the embedded `integrity` digest matches the actual content.
 * No-op for bundles without an `integrity` field (older exports). Throws
 * on mismatch with enough context to debug a tampered or corrupted file.
 */
export function verifyIntegrity(file: PortableAgentFile): void {
  if (!file.integrity) return;
  const recomputed = computeIntegrity(file);
  if (recomputed.digest !== file.integrity.digest) {
    throw new Error(
      `Bundle integrity check failed: expected sha256 ${file.integrity.digest}, ` +
        `recomputed ${recomputed.digest}. Bundle may be corrupted or tampered.`
    );
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import a portable file into the current installation. Creates a new
 * AgentIdentity (reusing the bundled `identity_id` unless `newIdentity` is
 * set or the id is already in use) and restores memory entries under a
 * fresh namespace `imported/<identityId>`.
 */
export async function importAgent(
  file: PortableAgentFile,
  config: AgentStackConfig,
  opts: ImportOptions = {}
): Promise<ImportResult> {
  const validated = validatePortableFile(file);
  // Bundle hash check: any tampering between export and import — manual
  // edits in a text editor, truncation during transfer, etc. — surfaces
  // here rather than as a subtle behavioural drift downstream.
  verifyIntegrity(validated);
  const warnings: string[] = [];

  const identityService = getIdentityService(config);

  // Verify agent type is registered locally.
  const definition = getAgentDefinition(validated.agent.type);
  if (!definition) {
    throw new Error(
      `Cannot import: agent type '${validated.agent.type}' is not registered ` +
        `in this installation. Install the providing plugin first.`
    );
  }

  const displayName = opts.rename ?? validated.agent.name;
  const desiredId = validated.agent.identity_id;

  const identity = identityService.createIdentity({
    agentType: validated.agent.type,
    displayName,
    description: validated.agent.description,
    capabilities: validated.agent.capabilities?.map((name) => ({
      name,
      enabled: true,
    })),
    metadata: {
      importedFrom: validated.metadata.exporter,
      importedAt: new Date().toISOString(),
      originalIdentityId: validated.agent.identity_id,
      systemPromptOverride: validated.agent.system_prompt_override ?? undefined,
      // Round-trip tool_whitelist / model so a re-export reproduces the
      // bundle losslessly (regression guard for the silent-drop bug).
      toolWhitelist: validated.agent.tool_whitelist,
      model: validated.agent.model,
    },
    autoActivate: true,
  });

  // IdentityService.createIdentity always allocates a fresh UUID, so the
  // bundled identity_id is informational only. Surface the rewrite so
  // consumers can update any external references.
  if (desiredId && identity.agentId !== desiredId && !opts.newIdentity) {
    warnings.push(
      `Allocated new identity ${identity.agentId} (bundle requested ${desiredId})`
    );
  }

  // Restore memory entries
  let importedEntries = 0;
  if (!opts.noMemory && validated.memory_snapshot.entries.length > 0) {
    const memory = getMemoryManager(config);
    const targetNamespace = `imported/${identity.agentId}`;
    for (const entry of validated.memory_snapshot.entries) {
      try {
        await memory.store(entry.key, entry.content, {
          namespace: targetNamespace,
          metadata: {
            ...entry.metadata,
            originalNamespace: entry.namespace,
          },
          agentId: identity.agentId,
          generateEmbedding: false,
        });
        importedEntries += 1;
      } catch (err) {
        warnings.push(
          `Failed to import memory entry '${entry.key}': ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  log.info('Imported portable agent', {
    identityId: identity.agentId,
    type: validated.agent.type,
    entries: importedEntries,
    warnings: warnings.length,
  });

  return {
    identityId: identity.agentId,
    agentType: validated.agent.type,
    agentName: displayName,
    importedEntries,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Letta `.af` best-effort import
// ---------------------------------------------------------------------------

/**
 * Mapping of common Letta agent_type strings to aistack registry types.
 * Unknown types fall back to `coder` and a warning is recorded.
 */
const LETTA_TYPE_MAP: Record<string, string> = {
  memgpt_agent: 'coder',
  chat_agent: 'coder',
  workflow_agent: 'coordinator',
  research_agent: 'researcher',
  coding_agent: 'coder',
  reviewer_agent: 'reviewer',
};

/** Tool name normalization: Letta -> aistack canonical names. */
const LETTA_TOOL_MAP: Record<string, string> = {
  send_message: 'Reply',
  archival_memory_insert: 'Memory.write',
  archival_memory_search: 'Memory.search',
  core_memory_append: 'Memory.write',
  core_memory_replace: 'Memory.write',
  conversation_search: 'Memory.search',
  pause_heartbeats: 'Sleep',
  run_code: 'Bash',
};

/**
 * Convert a raw parsed Letta `.af` object into a PortableAgentFile.
 * Best-effort: unknown fields are dropped, lossy mappings emit
 * `metadata.labels` entries prefixed with `letta:warn:`.
 *
 * Letta `.af` reference shape (subset we handle):
 *   {
 *     "agent_type": "memgpt_agent",
 *     "name": "...",
 *     "system": "...",
 *     "core_memory": [{ "label": "...", "value": "..." }, ...],
 *     "tools": [{ "name": "..." }, ...],
 *     "llm_config": { "model": "..." }
 *   }
 */
export function importLettaAf(raw: unknown): PortableAgentFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Letta .af import: expected a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const warnings: string[] = [];

  const lettaType = typeof obj.agent_type === 'string' ? obj.agent_type : '';
  const mapped = LETTA_TYPE_MAP[lettaType];
  if (!mapped) {
    warnings.push(`letta:warn:unknown-type:${lettaType || '<missing>'}`);
  }
  const type = mapped ?? 'coder';

  const name = typeof obj.name === 'string' ? obj.name : `letta-${lettaType || 'agent'}`;
  const systemPrompt = typeof obj.system === 'string' ? obj.system : null;

  const tools = Array.isArray(obj.tools) ? obj.tools : [];
  const toolWhitelist: string[] = [];
  for (const t of tools) {
    if (t && typeof t === 'object') {
      const tname = (t as Record<string, unknown>).name;
      if (typeof tname === 'string') {
        const mappedTool = LETTA_TOOL_MAP[tname] ?? tname;
        toolWhitelist.push(mappedTool);
      }
    }
  }

  const llmConfig = (obj.llm_config ?? {}) as Record<string, unknown>;
  const model = typeof llmConfig.model === 'string' ? llmConfig.model : undefined;

  // core_memory -> memory entries under namespace `letta-imported`. Apply
  // the same `stripSecrets` filter the native exporter uses: a Letta block
  // may carry arbitrary attributes (limit, persisted_at, ...) and we do
  // not want anything that looks like an API key to ride along into the
  // local memory store.
  const coreMemory = Array.isArray(obj.core_memory) ? obj.core_memory : [];
  const entries: PortableMemoryEntry[] = [];
  for (const block of coreMemory) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const label = typeof b.label === 'string' ? b.label : `block-${entries.length}`;
    const value = typeof b.value === 'string' ? b.value : JSON.stringify(b);
    // Preserve any other block attributes (limit, description, etc.) as
    // metadata, minus secrets.
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) {
      if (k === 'label' || k === 'value') continue;
      extra[k] = v;
    }
    const cleanedExtra = stripSecrets(extra);
    entries.push({
      key: label,
      namespace: 'letta-imported',
      content: value,
      tags: ['letta-import', 'core-memory'],
      metadata:
        cleanedExtra && Object.keys(cleanedExtra).length > 0
          ? cleanedExtra
          : undefined,
    });
  }

  const file: PortableAgentFile = {
    magic: PORTABLE_MAGIC,
    format_version: PORTABLE_FORMAT_VERSION,
    agent: {
      type,
      name,
      system_prompt_override: systemPrompt,
      tool_whitelist: toolWhitelist.length > 0 ? toolWhitelist : undefined,
      model,
      capabilities: undefined,
      description: `Imported from Letta .af (original type: ${lettaType || 'unknown'})`,
    },
    memory_snapshot: {
      format: 'json-entries',
      entries_count: entries.length,
      entries,
    },
    metadata: {
      exported_at: new Date().toISOString(),
      exporter: 'letta-af-importer',
      labels: warnings,
      source: {
        tool: 'letta',
        original_id: typeof obj.id === 'string' ? obj.id : undefined,
      },
    },
    integrity: null,
  };

  const validated = validatePortableFile(file);
  validated.integrity = computeIntegrity(validated);
  return validated;
}
