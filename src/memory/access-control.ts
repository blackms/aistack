/**
 * Memory Access Control - Session-based isolation for agent memory
 *
 * Ensures agents in different sessions cannot access each other's memory.
 */

import { logger } from '../utils/logger.js';

const log = logger.child('memory:access-control');

/**
 * Context for memory access operations
 */
export interface MemoryAccessContext {
  /** Required - enforced namespace based on session */
  sessionId: string;
  /** Optional - scoping within session */
  agentId?: string;
  /** Include shared memory (agent_id = NULL within session) */
  includeShared?: boolean;
}

/**
 * Memory access control for session-based isolation
 */
export class MemoryAccessControl {
  /** Prefix for session namespaces */
  private static readonly SESSION_PREFIX = 'session:';

  /**
   * Get the namespace for a session
   */
  getSessionNamespace(sessionId: string): string {
    if (!sessionId) {
      throw new Error('sessionId is required for memory access');
    }
    return `${MemoryAccessControl.SESSION_PREFIX}${sessionId}`;
  }

  /**
   * Check if a namespace belongs to a session
   */
  isSessionNamespace(namespace: string): boolean {
    return namespace.startsWith(MemoryAccessControl.SESSION_PREFIX);
  }

  /**
   * Extract session ID from a namespace
   */
  extractSessionId(namespace: string): string | null {
    if (!this.isSessionNamespace(namespace)) {
      return null;
    }
    return namespace.slice(MemoryAccessControl.SESSION_PREFIX.length);
  }

  /**
   * Validate access to a namespace
   * @throws Error if access is denied
   */
  validateAccess(
    context: MemoryAccessContext,
    namespace: string,
    operation: 'read' | 'write' | 'delete'
  ): void {
    if (!context.sessionId) {
      throw new Error('sessionId is required for memory access');
    }

    const sessionNamespace = this.getSessionNamespace(context.sessionId);

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
   * Check if a context can access a specific memory entry
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
   * Derive the appropriate namespace for a memory operation
   * If no namespace provided, use the session namespace
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
