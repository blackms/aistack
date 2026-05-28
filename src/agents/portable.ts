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

import { randomUUID } from 'node:crypto';
import type { AgentStackConfig, AgentIdentity, MemoryEntry } from '../types.js';
import { getAgentDefinition } from './registry.js';
import { getIdentityService } from './identity-service.js';
import { getMemoryManager } from '../memory/index.js';
import { logger } from '../utils/logger.js';
import {
  PORTABLE_FORMAT_VERSION,
  PORTABLE_MAGIC,
  PortableAgentFileSchema,
  stripSecrets,
  type PortableAgentFile,
  type PortableAgentSection,
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
  };

  // Validate before returning so we never emit a broken file.
  return validatePortableFile(file);
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
  };

  return validatePortableFile(file);
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

/** Validate any value against the portable schema. */
export function validatePortableFile(value: unknown): PortableAgentFile {
  return PortableAgentFileSchema.parse(value);
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
  const warnings: string[] = [];

  // IdentityService.createIdentity currently always allocates a fresh UUID,
  // so we cannot reuse the bundled identity_id verbatim. Detect the
  // (rare but possible) clash up-front so the post-create warning can
  // distinguish "id was in use" from "we just always rewrite".
  const identityService = getIdentityService(config);
  const desiredId = validated.agent.identity_id;
  const desiredIdClashes = Boolean(
    !opts.newIdentity && desiredId && identityService.getIdentity(desiredId)
  );

  // Verify agent type is registered locally.
  const definition = getAgentDefinition(validated.agent.type);
  if (!definition) {
    throw new Error(
      `Cannot import: agent type '${validated.agent.type}' is not registered ` +
        `in this installation. Install the providing plugin first.`
    );
  }

  const displayName = opts.rename ?? validated.agent.name;

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
    },
    autoActivate: true,
  });

  // Surface the id-rewrite so consumers can update any external references.
  if (desiredId && identity.agentId !== desiredId) {
    if (desiredIdClashes) {
      warnings.push(
        `Bundle identity ${desiredId} already existed locally; allocated ${identity.agentId} instead`
      );
    } else if (!opts.newIdentity) {
      warnings.push(
        `Allocated new identity ${identity.agentId} (bundle requested ${desiredId})`
      );
    }
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

  // core_memory -> memory entries under namespace `letta-imported`
  const coreMemory = Array.isArray(obj.core_memory) ? obj.core_memory : [];
  const entries: PortableMemoryEntry[] = [];
  for (const block of coreMemory) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const label = typeof b.label === 'string' ? b.label : `block-${entries.length}`;
    const value = typeof b.value === 'string' ? b.value : JSON.stringify(b);
    entries.push({
      key: label,
      namespace: 'letta-imported',
      content: value,
      tags: ['letta-import', 'core-memory'],
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
  };

  return validatePortableFile(file);
}
