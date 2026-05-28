/**
 * Memory module - unified interface for storage and search
 */

import type {
  MemoryEntry,
  MemorySearchResult,
  MemoryStoreOptions,
  MemorySearchOptions,
  AgentStackConfig,
  Session,
  Task,
  Project,
  ProjectTask,
  Specification,
  TaskPhase,
  SpecificationType,
  SpecificationStatus,
  ReviewComment,
} from '../types.js';
import { SQLiteStore } from './sqlite-store.js';
import { FTSSearch } from './fts-search.js';
import { VectorSearch } from './vector-search.js';
import { MemoryAccessControl, getAccessControl } from './access-control.js';
import { audit } from '../audit/index.js';
import { TierManager } from './tiers/tier-manager.js';
import { logger } from '../utils/logger.js';
import {
  getActiveTenantContext,
  workspaceNamespace,
  type MultitenancyContext,
} from '../multitenancy/index.js';

const log = logger.child('memory');

export interface AgentContext {
  agentId?: string;         // Optional - scoping within session
  sessionId: string;        // Required for session-based isolation
  includeShared?: boolean;
  /**
   * Multi-tenancy scoping (AIG-649). When set, memory namespaces are
   * automatically prefixed with `tenant:<id>[:workspace:<id>]` so a tenant
   * cannot read another tenant's memory even if they share a session id.
   * When undefined, the manager falls back to `getActiveTenantContext()` —
   * which itself returns undefined in single-tenant mode.
   */
  tenantContext?: MultitenancyContext;
}

/**
 * Compute the effective tenant scope for a memory operation. Returns the
 * explicit context on `agentContext` first, then the AsyncLocal-ish active
 * context. Undefined means "no tenant scoping" (single-tenant mode).
 */
function effectiveTenantContext(
  agentContext: AgentContext | null,
): MultitenancyContext | undefined {
  return agentContext?.tenantContext ?? getActiveTenantContext();
}

/**
 * Prefix a memory namespace with the tenant/workspace scope when one is
 * active, so cross-tenant key collisions are impossible. No-op for
 * single-tenant deployments.
 */
function applyTenantPrefix(
  namespace: string,
  agentContext: AgentContext | null,
): string {
  const tctx = effectiveTenantContext(agentContext);
  if (!tctx) return namespace;
  return `${workspaceNamespace(tctx)}:${namespace}`;
}

export class MemoryManager {
  private sqliteStore: SQLiteStore;
  private fts: FTSSearch;
  private vector: VectorSearch;
  private config: AgentStackConfig;
  private agentContext: AgentContext | null = null;
  private accessControl: MemoryAccessControl;
  /**
   * Hierarchical-memory hook (AIG-651). Constructing the TierManager applies
   * the tier-column schema patch idempotently and lets every read path call
   * touch() so AutoPager has accurate hot/cold signal. We intentionally do
   * NOT expose the pager from the manager — that wiring is opt-in via
   * createTierStack() in src/memory/tiers/index.ts.
   */
  private tierManager: TierManager;

  constructor(config: AgentStackConfig) {
    this.config = config;
    this.sqliteStore = new SQLiteStore(config.memory.path);
    // @ts-expect-error - accessing internal db for FTS
    this.fts = new FTSSearch(this.sqliteStore.db);
    this.vector = new VectorSearch(this.sqliteStore, config);
    this.accessControl = getAccessControl();
    this.tierManager = new TierManager(this.sqliteStore);

    log.info('Memory manager initialized', {
      path: config.memory.path,
      vectorEnabled: this.vector.isEnabled(),
    });
  }

  /**
   * Best-effort access bookkeeping. Wraps tierManager.touch in try/catch so
   * a malformed schema (e.g. a partial migration) cannot break a read.
   */
  private touchEntry(id: string | undefined | null): void {
    if (!id) return;
    try {
      this.tierManager.touch(id);
    } catch (err) {
      log.debug('touch() failed (best-effort)', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ==================== Agent Context ====================

  /**
   * Set the current agent context for memory operations
   */
  setAgentContext(context: AgentContext | null): void {
    this.agentContext = context;
    log.debug('Agent context set', { agentId: context?.agentId, sessionId: context?.sessionId });
  }

  /**
   * Get the current agent context
   */
  getAgentContext(): AgentContext | null {
    return this.agentContext;
  }

  /**
   * Clear the current agent context
   */
  clearAgentContext(): void {
    this.agentContext = null;
    log.debug('Agent context cleared');
  }

  // ==================== Memory Operations ====================

  /**
   * Store a key-value pair in memory
   */
  async store(
    key: string,
    content: string,
    options: MemoryStoreOptions = {}
  ): Promise<MemoryEntry> {
    // Derive namespace from context if not explicitly provided
    let namespace = options.namespace;
    if (!namespace && this.agentContext?.sessionId) {
      namespace = this.accessControl.getSessionNamespace(this.agentContext.sessionId);
    } else if (!namespace) {
      namespace = this.config.memory.defaultNamespace;
    }

    // AIG-649 wire-point: prefix the namespace with tenant/workspace scope.
    namespace = applyTenantPrefix(namespace, this.agentContext);

    // Validate access if we have a context
    if (this.agentContext?.sessionId) {
      this.accessControl.validateAccess(
        { sessionId: this.agentContext.sessionId, agentId: this.agentContext.agentId },
        namespace,
        'write'
      );
    }

    // Use explicit agentId if provided, otherwise use context
    const agentId = options.agentId ?? this.agentContext?.agentId;
    const entry = this.sqliteStore.store(key, content, { ...options, namespace, agentId });

    // Index for vector search if enabled
    if (options.generateEmbedding !== false && this.vector.isEnabled()) {
      await this.vector.indexEntry(entry);
    }

    log.debug('Stored memory entry', { key, namespace, agentId });
    audit(this.config, 'memory.write', { entryId: entry.id, key, namespace, agentId, shared: false });
    return entry;
  }

  /**
   * Store explicitly shared memory (agent_id = NULL)
   * Shared within the session namespace
   */
  async storeShared(
    key: string,
    content: string,
    options: Omit<MemoryStoreOptions, 'agentId'> = {}
  ): Promise<MemoryEntry> {
    // Derive namespace from context if not explicitly provided
    let namespace = options.namespace;
    if (!namespace && this.agentContext?.sessionId) {
      namespace = this.accessControl.getSessionNamespace(this.agentContext.sessionId);
    } else if (!namespace) {
      namespace = this.config.memory.defaultNamespace;
    }

    // Validate access if we have a context
    if (this.agentContext?.sessionId) {
      this.accessControl.validateAccess(
        { sessionId: this.agentContext.sessionId },
        namespace,
        'write'
      );
    }

    // Explicitly set agentId to undefined to ensure shared memory
    const entry = this.sqliteStore.store(key, content, { ...options, namespace, agentId: undefined });

    // Index for vector search if enabled
    if (options.generateEmbedding !== false && this.vector.isEnabled()) {
      await this.vector.indexEntry(entry);
    }

    log.debug('Stored shared memory entry', { key, namespace });
    audit(this.config, 'memory.write', { entryId: entry.id, key, namespace, shared: true });
    return entry;
  }

  /**
   * Get a memory entry by key
   */
  get(key: string, namespace?: string): MemoryEntry | null {
    // Derive namespace from context if not explicitly provided
    let effectiveNamespace = namespace;
    if (!effectiveNamespace && this.agentContext?.sessionId) {
      effectiveNamespace = this.accessControl.getSessionNamespace(this.agentContext.sessionId);
    } else if (!effectiveNamespace) {
      effectiveNamespace = this.config.memory.defaultNamespace;
    }

    // AIG-649 wire-point: tenant-scope the lookup key.
    effectiveNamespace = applyTenantPrefix(effectiveNamespace, this.agentContext);

    // Validate access if we have a context
    if (this.agentContext?.sessionId) {
      this.accessControl.validateAccess(
        { sessionId: this.agentContext.sessionId, agentId: this.agentContext.agentId },
        effectiveNamespace,
        'read'
      );
    }

    const entry = this.sqliteStore.get(key, effectiveNamespace);
    // Tier bookkeeping: record this read for the AutoPager promotion
    // heuristic. No-op if the entry is missing.
    this.touchEntry(entry?.id);
    return entry;
  }

  /**
   * Get a memory entry by ID
   */
  getById(id: string): MemoryEntry | null {
    const entry = this.sqliteStore.getById(id);

    // Validate access if we have a context
    if (entry && this.agentContext?.sessionId) {
      if (!this.accessControl.canAccessEntry(
        { sessionId: this.agentContext.sessionId, agentId: this.agentContext.agentId, includeShared: this.agentContext.includeShared },
        entry.namespace,
        entry.agentId
      )) {
        log.warn('Access denied to memory entry', {
          entryId: id,
          entryNamespace: entry.namespace,
          contextSessionId: this.agentContext.sessionId,
        });
        return null;  // Deny access by returning null
      }
    }

    // Tier bookkeeping for the successful read path only — denied accesses
    // must not look like a hot signal.
    if (entry) this.touchEntry(entry.id);
    return entry;
  }

  /**
   * Delete a memory entry
   */
  delete(key: string, namespace?: string): boolean {
    // Derive namespace from context if not explicitly provided
    let effectiveNamespace = namespace;
    if (!effectiveNamespace && this.agentContext?.sessionId) {
      effectiveNamespace = this.accessControl.getSessionNamespace(this.agentContext.sessionId);
    } else if (!effectiveNamespace) {
      effectiveNamespace = this.config.memory.defaultNamespace;
    }

    // Validate access if we have a context
    if (this.agentContext?.sessionId) {
      this.accessControl.validateAccess(
        { sessionId: this.agentContext.sessionId, agentId: this.agentContext.agentId },
        effectiveNamespace,
        'delete'
      );
    }

    const deleted = this.sqliteStore.delete(key, effectiveNamespace);
    if (deleted) {
      audit(this.config, 'memory.delete', { key, namespace: effectiveNamespace });
    }
    return deleted;
  }

  /**
   * List memory entries
   */
  list(
    namespace?: string,
    limit?: number,
    offset?: number,
    options?: { agentId?: string; includeShared?: boolean }
  ): MemoryEntry[] {
    // Derive namespace from context if not explicitly provided (for session isolation)
    let effectiveNamespace = namespace;
    if (!effectiveNamespace && this.agentContext?.sessionId) {
      effectiveNamespace = this.accessControl.getSessionNamespace(this.agentContext.sessionId);
    }

    // Validate access if we have a context and a namespace
    if (this.agentContext?.sessionId && effectiveNamespace) {
      this.accessControl.validateAccess(
        { sessionId: this.agentContext.sessionId, agentId: this.agentContext.agentId },
        effectiveNamespace,
        'read'
      );
    }

    // Use explicit agentId if provided, otherwise use context
    const agentId = options?.agentId ?? this.agentContext?.agentId;
    const includeShared = options?.includeShared ?? this.agentContext?.includeShared ?? true;
    return this.sqliteStore.list(effectiveNamespace, limit, offset, { agentId, includeShared });
  }

  /**
   * Get memory entries for a specific agent
   */
  getAgentMemory(
    agentId: string,
    options?: { namespace?: string; limit?: number; offset?: number; includeShared?: boolean }
  ): MemoryEntry[] {
    return this.sqliteStore.list(
      options?.namespace,
      options?.limit ?? 100,
      options?.offset ?? 0,
      { agentId, includeShared: options?.includeShared ?? false }
    );
  }

  /**
   * Count memory entries
   */
  count(namespace?: string): number {
    return this.sqliteStore.count(namespace);
  }

  // ==================== Tag Operations ====================

  /**
   * Add a tag to a memory entry
   */
  addTag(entryId: string, tagName: string): void {
    this.sqliteStore.addTag(entryId, tagName);
    log.debug('Tag added', { entryId, tagName });
  }

  /**
   * Remove a tag from a memory entry
   */
  removeTag(entryId: string, tagName: string): boolean {
    const removed = this.sqliteStore.removeTag(entryId, tagName);
    log.debug('Tag removed', { entryId, tagName, removed });
    return removed;
  }

  /**
   * Get all tags with usage counts
   */
  getAllTags(): Array<{ name: string; count: number }> {
    return this.sqliteStore.getAllTags();
  }

  /**
   * Search entries by tags
   */
  searchByTags(tags: string[], namespace?: string): MemoryEntry[] {
    return this.sqliteStore.searchByTags(tags, namespace);
  }

  // ==================== Relationship Operations ====================

  /**
   * Create a relationship between two memory entries
   */
  createRelationship(
    fromId: string,
    toId: string,
    relationshipType: string,
    metadata?: Record<string, unknown>
  ): string {
    const id = this.sqliteStore.createRelationship(fromId, toId, relationshipType, metadata);
    log.debug('Relationship created', { fromId, toId, relationshipType });
    return id;
  }

  /**
   * Get relationships for an entry
   */
  getRelationships(entryId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both') {
    return this.sqliteStore.getRelationships(entryId, direction);
  }

  /**
   * Get related entries with relationship info
   */
  getRelatedEntries(entryId: string, relationshipType?: string) {
    return this.sqliteStore.getRelatedEntries(entryId, relationshipType);
  }

  /**
   * Delete a relationship
   */
  deleteRelationship(relationshipId: string): boolean {
    const deleted = this.sqliteStore.deleteRelationship(relationshipId);
    log.debug('Relationship deleted', { relationshipId, deleted });
    return deleted;
  }

  /**
   * Delete all relationships for an entry
   */
  deleteAllRelationships(entryId: string): number {
    const count = this.sqliteStore.deleteAllRelationships(entryId);
    log.debug('All relationships deleted', { entryId, count });
    return count;
  }

  // ==================== Version Operations ====================

  /**
   * Get version history for an entry
   */
  getVersionHistory(entryId: string) {
    return this.sqliteStore.getVersionHistory(entryId);
  }

  /**
   * Get a specific version of an entry
   */
  getVersion(entryId: string, version: number) {
    return this.sqliteStore.getVersion(entryId, version);
  }

  /**
   * Get the current version number for an entry
   */
  getCurrentVersion(entryId: string): number {
    return this.sqliteStore.getCurrentVersion(entryId);
  }

  /**
   * Restore a specific version
   */
  restoreVersion(entryId: string, version: number): boolean {
    const restored = this.sqliteStore.restoreVersion(entryId, version);
    log.info('Version restored', { entryId, version, restored });
    return restored;
  }

  /**
   * Search memory using FTS and optionally vector search
   */
  async search(
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const { limit = 10, threshold = 0.7, useVector } = options;

    // Derive namespace from context if not explicitly provided (for session isolation)
    let namespace = options.namespace;
    if (!namespace && this.agentContext?.sessionId) {
      namespace = this.accessControl.getSessionNamespace(this.agentContext.sessionId);
    }

    // Validate access if we have a context and a namespace
    if (this.agentContext?.sessionId && namespace) {
      this.accessControl.validateAccess(
        { sessionId: this.agentContext.sessionId, agentId: this.agentContext.agentId },
        namespace,
        'read'
      );
    }

    // Use explicit agentId if provided, otherwise use context
    const agentId = options.agentId ?? this.agentContext?.agentId;
    const includeShared = options.includeShared ?? this.agentContext?.includeShared ?? true;

    // Decide whether to use vector search
    const shouldUseVector = useVector ?? this.vector.isEnabled();

    let results: MemorySearchResult[] = [];

    // Try vector search first if enabled
    if (shouldUseVector && this.vector.isEnabled()) {
      const vectorResults = await this.vector.search(query, {
        namespace,
        limit,
        threshold,
        agentId,
        includeShared,
      });
      results = vectorResults;
    }

    // If no vector results or vector disabled, use FTS
    if (results.length === 0) {
      results = this.fts.search(query, { namespace, limit, agentId, includeShared });
    }

    // If we have both, merge and deduplicate
    if (shouldUseVector && this.vector.isEnabled() && results.length > 0) {
      const ftsResults = this.fts.search(query, { namespace, limit, agentId, includeShared });
      results = this.mergeResults(results, ftsResults, limit);
    }

    // Tier bookkeeping: every search hit counts as a read for the AutoPager
    // promotion heuristic. Deduplicate via Set so ranked merging doesn't
    // double-count the same entry.
    const touched = new Set<string>();
    for (const r of results) {
      if (r.entry?.id && !touched.has(r.entry.id)) {
        touched.add(r.entry.id);
        this.touchEntry(r.entry.id);
      }
    }

    log.debug('Search completed', {
      query: query.slice(0, 50),
      results: results.length,
      namespace,
      agentId,
    });

    return results;
  }

  /**
   * Merge and deduplicate search results from different sources
   */
  private mergeResults(
    vectorResults: MemorySearchResult[],
    ftsResults: MemorySearchResult[],
    limit: number
  ): MemorySearchResult[] {
    const seen = new Set<string>();
    const merged: MemorySearchResult[] = [];

    // Add vector results first (higher quality)
    for (const result of vectorResults) {
      if (!seen.has(result.entry.id)) {
        seen.add(result.entry.id);
        merged.push(result);
      }
    }

    // Add FTS results that weren't in vector results
    for (const result of ftsResults) {
      if (!seen.has(result.entry.id) && merged.length < limit) {
        seen.add(result.entry.id);
        merged.push(result);
      }
    }

    return merged.slice(0, limit);
  }

  // ==================== Session Operations ====================

  createSession(metadata?: Record<string, unknown>): Session {
    return this.sqliteStore.createSession(metadata);
  }

  getSession(id: string): Session | null {
    return this.sqliteStore.getSession(id);
  }

  endSession(id: string): boolean {
    return this.sqliteStore.endSession(id);
  }

  getActiveSession(): Session | null {
    return this.sqliteStore.getActiveSession();
  }

  listSessions(status?: 'active' | 'ended', limit?: number, offset?: number): Session[] {
    return this.sqliteStore.listSessions(status, limit, offset);
  }

  // ==================== Task Operations ====================

  createTask(
    agentType: string,
    input?: string,
    sessionId?: string,
    options?: {
      riskLevel?: 'low' | 'medium' | 'high';
      parentTaskId?: string;
      depth?: number;
      consensusCheckpointId?: string;
    }
  ): Task {
    const task = this.sqliteStore.createTask(agentType, input, sessionId, options);
    audit(this.config, 'task.create', { taskId: task.id, agentType, sessionId, riskLevel: options?.riskLevel, parentTaskId: options?.parentTaskId, depth: options?.depth });
    return task;
  }

  getTask(id: string): Task | null {
    return this.sqliteStore.getTask(id);
  }

  updateTaskStatus(id: string, status: Task['status'], output?: string): boolean {
    const updated = this.sqliteStore.updateTaskStatus(id, status, output);
    if (updated && (status === 'completed' || status === 'failed' || status === 'running')) {
      const eventType = status === 'completed' ? 'task.complete' : status === 'failed' ? 'task.fail' : 'task.assign';
      audit(this.config, eventType, { taskId: id, status });
    }
    return updated;
  }

  listTasks(sessionId?: string, status?: Task['status']): Task[] {
    return this.sqliteStore.listTasks(sessionId, status);
  }

  // ==================== Project Operations ====================

  createProject(
    name: string,
    path: string,
    description?: string,
    metadata?: Record<string, unknown>
  ): Project {
    return this.sqliteStore.createProject(name, path, description, metadata);
  }

  getProject(id: string): Project | null {
    return this.sqliteStore.getProject(id);
  }

  updateProject(
    id: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'metadata'>>
  ): boolean {
    return this.sqliteStore.updateProject(id, updates);
  }

  listProjects(status?: Project['status']): Project[] {
    return this.sqliteStore.listProjects(status);
  }

  deleteProject(id: string): boolean {
    return this.sqliteStore.deleteProject(id);
  }

  // ==================== Project Task Operations ====================

  createProjectTask(
    projectId: string,
    title: string,
    options?: {
      description?: string;
      priority?: number;
      assignedAgents?: string[];
      sessionId?: string;
    }
  ): ProjectTask {
    return this.sqliteStore.createProjectTask(projectId, title, options);
  }

  getProjectTask(id: string): ProjectTask | null {
    return this.sqliteStore.getProjectTask(id);
  }

  updateProjectTask(
    id: string,
    updates: Partial<Pick<ProjectTask, 'title' | 'description' | 'priority' | 'assignedAgents' | 'sessionId'>>
  ): boolean {
    return this.sqliteStore.updateProjectTask(id, updates);
  }

  updateProjectTaskPhase(id: string, phase: TaskPhase): boolean {
    return this.sqliteStore.updateProjectTaskPhase(id, phase);
  }

  listProjectTasks(projectId: string, phase?: TaskPhase): ProjectTask[] {
    return this.sqliteStore.listProjectTasks(projectId, phase);
  }

  deleteProjectTask(id: string): boolean {
    return this.sqliteStore.deleteProjectTask(id);
  }

  // ==================== Specification Operations ====================

  createSpecification(
    projectTaskId: string,
    type: SpecificationType,
    title: string,
    content: string,
    createdBy: string
  ): Specification {
    return this.sqliteStore.createSpecification(projectTaskId, type, title, content, createdBy);
  }

  getSpecification(id: string): Specification | null {
    return this.sqliteStore.getSpecification(id);
  }

  updateSpecification(
    id: string,
    updates: Partial<Pick<Specification, 'title' | 'content' | 'type'>>
  ): boolean {
    return this.sqliteStore.updateSpecification(id, updates);
  }

  updateSpecificationStatus(
    id: string,
    status: SpecificationStatus,
    reviewedBy?: string,
    comments?: ReviewComment[]
  ): boolean {
    return this.sqliteStore.updateSpecificationStatus(id, status, reviewedBy, comments);
  }

  listSpecifications(projectTaskId: string, status?: SpecificationStatus): Specification[] {
    return this.sqliteStore.listSpecifications(projectTaskId, status);
  }

  deleteSpecification(id: string): boolean {
    return this.sqliteStore.deleteSpecification(id);
  }

  // ==================== Vector Search ====================

  /**
   * Reindex all entries for vector search
   */
  async reindex(namespace?: string): Promise<number> {
    if (!this.vector.isEnabled()) {
      log.warn('Vector search not enabled');
      return 0;
    }

    const entries = this.sqliteStore.list(namespace, 10000);
    return this.vector.indexBatch(entries);
  }

  /**
   * Get vector search statistics
   */
  getVectorStats(namespace?: string): { total: number; indexed: number; coverage: number } {
    return this.vector.getStats(namespace);
  }

  // ==================== Cleanup ====================

  /**
   * Get the underlying SQLite store
   */
  getStore(): SQLiteStore {
    return this.sqliteStore;
  }

  close(): void {
    this.sqliteStore.close();
    log.info('Memory manager closed');
  }

  vacuum(): void {
    this.sqliteStore.vacuum();
  }
}

// Export components
export { SQLiteStore } from './sqlite-store.js';
export { FTSSearch } from './fts-search.js';
export { VectorSearch } from './vector-search.js';
export { MemoryAccessControl, getAccessControl, resetAccessControl } from './access-control.js';
export type { MemoryAccessContext } from './access-control.js';

// Hierarchical memory tiers (AIG-651) — see src/memory/tiers/ for details.
export {
  TierManager,
  AutoPager,
  TierBudgetExceededError,
  estimateTokens,
  createTierStack,
  DEFAULT_PAGING_POLICY,
} from './tiers/index.js';
export type {
  MemoryTier,
  TierStats,
  PagingPolicy,
  PagingRunResult,
  TierStack,
  TierScope,
} from './tiers/index.js';

// Singleton instance
let instance: MemoryManager | null = null;

/**
 * Get or create the memory manager instance
 */
export function getMemoryManager(config?: AgentStackConfig): MemoryManager {
  if (!instance) {
    if (!config) {
      throw new Error('Configuration required to initialize memory manager');
    }
    instance = new MemoryManager(config);
  }
  return instance;
}

/**
 * Reset the memory manager instance
 */
export function resetMemoryManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

// AIG-640: Anthropic Memory Tool integration (additive — see ./tool-adapter.ts,
// ./dreaming.ts, ./sync.ts).
export { MemoryToolAdapter, normalizeMemoryPath } from './tool-adapter.js';
export type {
  MemoryToolCommand,
  MemoryToolInput,
  MemoryToolResult,
  MemoryToolAdapterOptions,
} from './tool-adapter.js';
export { DreamingWorker } from './dreaming.js';
export type { DreamingWorkerOptions, DreamingCycleResult } from './dreaming.js';
export { BidirectionalSync } from './sync.js';
export type { BidirectionalSyncOptions, SyncStats } from './sync.js';
