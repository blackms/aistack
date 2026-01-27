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
import { logger } from '../utils/logger.js';

const log = logger.child('memory');

export interface AgentContext {
  agentId: string;
  includeShared?: boolean;
}

export class MemoryManager {
  private sqliteStore: SQLiteStore;
  private fts: FTSSearch;
  private vector: VectorSearch;
  private config: AgentStackConfig;
  private agentContext: AgentContext | null = null;

  constructor(config: AgentStackConfig) {
    this.config = config;
    this.sqliteStore = new SQLiteStore(config.memory.path);
    // @ts-expect-error - accessing internal db for FTS
    this.fts = new FTSSearch(this.sqliteStore.db);
    this.vector = new VectorSearch(this.sqliteStore, config);

    log.info('Memory manager initialized', {
      path: config.memory.path,
      vectorEnabled: this.vector.isEnabled(),
    });
  }

  // ==================== Agent Context ====================

  /**
   * Set the current agent context for memory operations
   */
  setAgentContext(context: AgentContext | null): void {
    this.agentContext = context;
    log.debug('Agent context set', { agentId: context?.agentId });
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
    const namespace = options.namespace ?? this.config.memory.defaultNamespace;
    // Use explicit agentId if provided, otherwise use context
    const agentId = options.agentId ?? this.agentContext?.agentId;
    const entry = this.sqliteStore.store(key, content, { ...options, namespace, agentId });

    // Index for vector search if enabled
    if (options.generateEmbedding !== false && this.vector.isEnabled()) {
      await this.vector.indexEntry(entry);
    }

    log.debug('Stored memory entry', { key, namespace, agentId });
    return entry;
  }

  /**
   * Store explicitly shared memory (agent_id = NULL)
   */
  async storeShared(
    key: string,
    content: string,
    options: Omit<MemoryStoreOptions, 'agentId'> = {}
  ): Promise<MemoryEntry> {
    const namespace = options.namespace ?? this.config.memory.defaultNamespace;
    // Explicitly set agentId to undefined to ensure shared memory
    const entry = this.sqliteStore.store(key, content, { ...options, namespace, agentId: undefined });

    // Index for vector search if enabled
    if (options.generateEmbedding !== false && this.vector.isEnabled()) {
      await this.vector.indexEntry(entry);
    }

    log.debug('Stored shared memory entry', { key, namespace });
    return entry;
  }

  /**
   * Get a memory entry by key
   */
  get(key: string, namespace?: string): MemoryEntry | null {
    return this.sqliteStore.get(key, namespace ?? this.config.memory.defaultNamespace);
  }

  /**
   * Get a memory entry by ID
   */
  getById(id: string): MemoryEntry | null {
    return this.sqliteStore.getById(id);
  }

  /**
   * Delete a memory entry
   */
  delete(key: string, namespace?: string): boolean {
    return this.sqliteStore.delete(key, namespace ?? this.config.memory.defaultNamespace);
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
    // Use explicit agentId if provided, otherwise use context
    const agentId = options?.agentId ?? this.agentContext?.agentId;
    const includeShared = options?.includeShared ?? this.agentContext?.includeShared ?? true;
    return this.sqliteStore.list(namespace, limit, offset, { agentId, includeShared });
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
    const { namespace, limit = 10, threshold = 0.7, useVector } = options;
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

    log.debug('Search completed', {
      query: query.slice(0, 50),
      results: results.length,
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

  createTask(agentType: string, input?: string, sessionId?: string): Task {
    return this.sqliteStore.createTask(agentType, input, sessionId);
  }

  getTask(id: string): Task | null {
    return this.sqliteStore.getTask(id);
  }

  updateTaskStatus(id: string, status: Task['status'], output?: string): boolean {
    return this.sqliteStore.updateTaskStatus(id, status, output);
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
