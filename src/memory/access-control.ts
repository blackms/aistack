/**
 * Memory Access Control - Session-based isolation for agent memory
 *
 * This module provides session-based memory isolation to prevent agents in
 * different sessions from accessing each other's memory. Each session gets
 * its own namespace prefixed with "session:" followed by the session ID.
 *
 * Key security guarantees:
 * - Cross-session access is blocked (agents in session A cannot access session B's memory)
 * - Within a session, agents can optionally share memory or have private memory
 * - Global/system namespaces remain accessible for shared data
 *
 * @module memory/access-control
 */

import { logger } from '../utils/logger.js';

const log = logger.child('memory:access-control');

/**
 * Context for memory access operations.
 *
 * This context is required for all memory operations to enforce session isolation.
 *
 * @example
 * ```typescript
 * const context: MemoryAccessContext = {
 *   sessionId: 'abc-123-def',      // Required: session identifier
 *   agentId: 'agent-456',          // Optional: filter to specific agent
 *   includeShared: true            // Optional: include session-level shared memory
 * };
 * ```
 */
export interface MemoryAccessContext {
  /** Required - enforced namespace based on session */
  sessionId: string;
  /** Optional - scoping within session for agent-specific memory */
  agentId?: string;
  /** Include shared memory (agent_id = NULL within session). Defaults to true. */
  includeShared?: boolean;
}

/**
 * Memory access control for session-based isolation.
 *
 * This class enforces memory isolation between sessions by:
 * - Validating that memory operations only access the caller's session namespace
 * - Blocking cross-session access attempts
 * - Supporting agent-level filtering within a session
 *
 * @example
 * ```typescript
 * const accessControl = getAccessControl();
 * const namespace = accessControl.getSessionNamespace('session-123');
 * // namespace = 'session:session-123'
 *
 * // Validate access
 * accessControl.validateAccess(
 *   { sessionId: 'session-123' },
 *   'session:session-123',
 *   'read'
 * ); // OK
 *
 * accessControl.validateAccess(
 *   { sessionId: 'session-123' },
 *   'session:session-456',
 *   'read'
 * ); // Throws: Access denied
 * ```
 */
export class MemoryAccessControl {
  /** Prefix for session namespaces */
  private static readonly SESSION_PREFIX = 'session:';

  /**
   * Get the namespace for a session.
   *
   * @param sessionId - The session identifier
   * @returns The session namespace in format "session:{sessionId}"
   * @throws {Error} If sessionId is empty or undefined
   *
   * @example
   * ```typescript
   * getSessionNamespace('abc-123'); // Returns 'session:abc-123'
   * ```
   */
  getSessionNamespace(sessionId: string): string {
    if (!sessionId) {
      throw new Error('sessionId is required for memory access');
    }
    return `${MemoryAccessControl.SESSION_PREFIX}${sessionId}`;
  }

  /**
   * Check if a namespace belongs to a session (starts with "session:" prefix).
   *
   * @param namespace - The namespace to check
   * @returns True if the namespace is a session namespace
   */
  isSessionNamespace(namespace: string): boolean {
    return namespace.startsWith(MemoryAccessControl.SESSION_PREFIX);
  }

  /**
   * Extract session ID from a namespace.
   *
   * @param namespace - The namespace to extract from
   * @returns The session ID if this is a session namespace, null otherwise
   *
   * @example
   * ```typescript
   * extractSessionId('session:abc-123'); // Returns 'abc-123'
   * extractSessionId('default');          // Returns null
   * ```
   */
  extractSessionId(namespace: string): string | null {
    if (!this.isSessionNamespace(namespace)) {
      return null;
    }
    return namespace.slice(MemoryAccessControl.SESSION_PREFIX.length);
  }

  /**
   * Validate access to a namespace.
   *
   * This method enforces session isolation by checking that:
   * - The context has a valid sessionId
   * - If the target namespace is a session namespace, it belongs to the caller's session
   *
   * Non-session namespaces (global/shared) are allowed for backwards compatibility.
   *
   * @param context - The access context with sessionId
   * @param namespace - The target namespace to access
   * @param operation - The operation type for logging purposes
   * @throws {Error} If sessionId is missing or cross-session access is attempted
   */
  validateAccess(
    context: MemoryAccessContext,
    namespace: string,
    operation: 'read' | 'write' | 'delete'
  ): void {
    if (!context.sessionId) {
      throw new Error('sessionId is required for memory access');
    }

    // If the namespace is a session namespace, verify it matches the context's session
    if (this.isSessionNamespace(namespace)) {
      const namespaceSessionId = this.extractSessionId(namespace);
      if (namespaceSessionId !== context.sessionId) {
        log.warn('Access denied: cross-session access attempt', {
          operation,
          requestedNamespace: namespace,
          contextSessionId: context.sessionId,
          agentId: context.agentId,
        });
        throw new Error(
          `Access denied: cannot ${operation} memory in session ${namespaceSessionId} from session ${context.sessionId}`
        );
      }
    }

    // Non-session namespaces are allowed (global/shared data)
    // but writes should be carefully controlled
    if (!this.isSessionNamespace(namespace) && operation === 'write') {
      log.debug('Write to non-session namespace', {
        namespace,
        sessionId: context.sessionId,
        agentId: context.agentId,
      });
    }

    log.debug('Access validated', {
      operation,
      namespace,
      sessionId: context.sessionId,
      agentId: context.agentId,
    });
  }

  /**
   * Check if a context can access a specific memory entry.
   *
   * This performs a non-throwing access check, useful for filtering results.
   *
   * @param context - The access context with sessionId
   * @param entryNamespace - The namespace of the memory entry
   * @param entryAgentId - Optional agent ID of the entry owner
   * @returns True if access is allowed, false otherwise
   */
  canAccessEntry(
    context: MemoryAccessContext,
    entryNamespace: string,
    entryAgentId?: string
  ): boolean {
    if (!context.sessionId) {
      return false;
    }

    // If entry is in a session namespace, verify it's the same session
    if (this.isSessionNamespace(entryNamespace)) {
      const entrySessionId = this.extractSessionId(entryNamespace);
      if (entrySessionId !== context.sessionId) {
        return false;
      }
    }

    // If agentId filter is set on context and entry has an agentId
    if (context.agentId && entryAgentId) {
      // If includeShared is false, only allow matching agentId
      if (context.includeShared === false && entryAgentId !== context.agentId) {
        return false;
      }
    }

    return true;
  }

  /**
   * Derive the appropriate namespace for a memory operation.
   *
   * If an explicit namespace is provided, validates access and returns it.
   * Otherwise, returns the session namespace for the context.
   *
   * @param context - The access context with sessionId
   * @param explicitNamespace - Optional explicit namespace to use
   * @returns The namespace to use for the operation
   * @throws {Error} If access to the explicit namespace is denied
   */
  deriveNamespace(context: MemoryAccessContext, explicitNamespace?: string): string {
    if (explicitNamespace) {
      // Validate access to the explicit namespace
      this.validateAccess(context, explicitNamespace, 'write');
      return explicitNamespace;
    }

    // Default to session namespace
    return this.getSessionNamespace(context.sessionId);
  }

  /**
   * Check if we should filter by session namespace
   * Used when listing/searching to ensure session isolation
   */
  shouldFilterBySession(context: MemoryAccessContext, requestedNamespace?: string): string | undefined {
    // If a specific namespace is requested, validate and use it
    if (requestedNamespace) {
      this.validateAccess(context, requestedNamespace, 'read');
      return requestedNamespace;
    }

    // Default to session namespace for session isolation
    return this.getSessionNamespace(context.sessionId);
  }
}

// Singleton instance
let instance: MemoryAccessControl | null = null;

/**
 * Get or create the access control instance
 */
export function getAccessControl(): MemoryAccessControl {
  if (!instance) {
    instance = new MemoryAccessControl();
  }
  return instance;
}

/**
 * Reset the access control instance (for testing)
 */
export function resetAccessControl(): void {
  instance = null;
}
