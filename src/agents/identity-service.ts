/**
 * Agent Identity Service - manages persistent agent identities
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentIdentity,
  AgentIdentityStatus,
  AgentCapability,
  AgentIdentityAuditEntry,
  AgentStackConfig,
  AgentType,
} from '../types.js';
import { IDENTITY_STATUS_TRANSITIONS } from '../types.js';
import { getMemoryManager } from '../memory/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('identity-service');

export interface CreateIdentityOptions {
  agentType: AgentType | string;
  displayName?: string;
  description?: string;
  capabilities?: AgentCapability[];
  metadata?: Record<string, unknown>;
  createdBy?: string;
  autoActivate?: boolean;
}

export interface ListIdentitiesFilters {
  status?: AgentIdentityStatus;
  agentType?: string;
  limit?: number;
  offset?: number;
}

export class IdentityService {
  private config: AgentStackConfig;

  constructor(config: AgentStackConfig) {
    this.config = config;
    log.info('Identity service initialized');
  }

  /**
   * Create a new agent identity
   */
  createIdentity(options: CreateIdentityOptions): AgentIdentity {
    const store = getMemoryManager(this.config).getStore();
    const agentId = randomUUID();
    const initialStatus: AgentIdentityStatus = options.autoActivate ? 'active' : 'created';

    const identity = store.createAgentIdentity({
      agentId,
      agentType: options.agentType,
      status: initialStatus,
      capabilities: options.capabilities,
      displayName: options.displayName,
      description: options.description,
      metadata: options.metadata,
      createdBy: options.createdBy,
    });

    // Create audit entry for creation
    store.createAgentIdentityAudit({
      id: randomUUID(),
      agentId,
      action: 'created',
      newStatus: initialStatus,
      actorId: options.createdBy,
      metadata: {
        displayName: options.displayName,
        agentType: options.agentType,
      },
    });

    // If auto-activated, also log activation
    if (options.autoActivate) {
      store.createAgentIdentityAudit({
        id: randomUUID(),
        agentId,
        action: 'activated',
        previousStatus: 'created',
        newStatus: 'active',
        reason: 'Auto-activated on creation',
        actorId: options.createdBy,
      });
    }

    log.info('Created identity', { agentId, type: options.agentType, displayName: options.displayName });
    return identity;
  }

  /**
   * Get an identity by ID
   */
  getIdentity(agentId: string): AgentIdentity | null {
    const store = getMemoryManager(this.config).getStore();
    return store.getAgentIdentity(agentId);
  }

  /**
   * Get an identity by display name
   */
  getIdentityByName(displayName: string): AgentIdentity | null {
    const store = getMemoryManager(this.config).getStore();
    return store.getAgentIdentityByName(displayName);
  }

  /**
   * List identities with optional filters
   */
  listIdentities(filters?: ListIdentitiesFilters): AgentIdentity[] {
    const store = getMemoryManager(this.config).getStore();
    return store.listAgentIdentities(filters);
  }

  /**
   * Update identity metadata (non-lifecycle fields)
   */
  updateIdentity(
    agentId: string,
    updates: {
      displayName?: string;
      description?: string;
      metadata?: Record<string, unknown>;
      capabilities?: AgentCapability[];
    },
    actorId?: string
  ): AgentIdentity | null {
    const store = getMemoryManager(this.config).getStore();
    const identity = store.getAgentIdentity(agentId);

    if (!identity) {
      return null;
    }

    if (identity.status === 'retired') {
      throw new Error('Cannot update a retired identity');
    }

    const success = store.updateAgentIdentity(agentId, updates);
    if (!success) {
      return null;
    }

    // Create audit entry
    store.createAgentIdentityAudit({
      id: randomUUID(),
      agentId,
      action: 'updated',
      actorId,
      metadata: { updates: Object.keys(updates) },
    });

    log.debug('Updated identity', { agentId, updates: Object.keys(updates) });
    return store.getAgentIdentity(agentId);
  }

  /**
   * Activate an identity (transition from created or dormant to active)
   */
  activateIdentity(agentId: string, actorId?: string): AgentIdentity {
    return this.transitionStatus(agentId, 'active', { actorId });
  }

  /**
   * Deactivate an identity (transition from active to dormant)
   */
  deactivateIdentity(agentId: string, reason?: string, actorId?: string): AgentIdentity {
    return this.transitionStatus(agentId, 'dormant', { reason, actorId });
  }

  /**
   * Retire an identity (permanent - no coming back)
   */
  retireIdentity(agentId: string, reason?: string, actorId?: string): AgentIdentity {
    const store = getMemoryManager(this.config).getStore();
    const identity = store.getAgentIdentity(agentId);

    if (!identity) {
      throw new Error(`Identity not found: ${agentId}`);
    }

    if (identity.status === 'retired') {
      throw new Error('Identity is already retired');
    }

    const previousStatus = identity.status;

    // Update to retired status with retirement metadata
    store.updateAgentIdentity(agentId, {
      status: 'retired',
      retiredAt: new Date(),
      retirementReason: reason,
    });

    // Create audit entry
    store.createAgentIdentityAudit({
      id: randomUUID(),
      agentId,
      action: 'retired',
      previousStatus,
      newStatus: 'retired',
      reason,
      actorId,
    });

    log.info('Retired identity', { agentId, reason });

    const updated = store.getAgentIdentity(agentId);
    if (!updated) {
      throw new Error('Failed to retrieve updated identity');
    }
    return updated;
  }

  /**
   * Record a spawn event for an identity
   */
  recordSpawn(identityId: string, spawnId: string, actorId?: string): void {
    const store = getMemoryManager(this.config).getStore();
    const identity = store.getAgentIdentity(identityId);

    if (!identity) {
      throw new Error(`Identity not found: ${identityId}`);
    }

    if (identity.status === 'retired') {
      throw new Error('Cannot spawn a retired identity');
    }

    // Update last active timestamp
    store.updateAgentIdentity(identityId, {
      lastActiveAt: new Date(),
    });

    // Create audit entry for spawn
    store.createAgentIdentityAudit({
      id: randomUUID(),
      agentId: identityId,
      action: 'spawned',
      actorId,
      metadata: { spawnId },
    });

    log.debug('Recorded spawn', { identityId, spawnId });
  }

  /**
   * Get audit trail for an identity
   */
  getAuditTrail(agentId: string, limit: number = 100): AgentIdentityAuditEntry[] {
    const store = getMemoryManager(this.config).getStore();
    return store.getAgentIdentityAuditHistory(agentId, limit);
  }

  /**
   * Touch an identity to update its last active timestamp
   */
  touchIdentity(agentId: string): boolean {
    const store = getMemoryManager(this.config).getStore();
    const identity = store.getAgentIdentity(agentId);

    if (!identity || identity.status === 'retired') {
      return false;
    }

    return store.updateAgentIdentity(agentId, {
      lastActiveAt: new Date(),
    });
  }

  /**
   * Validate if a status transition is allowed
   */
  isValidTransition(from: AgentIdentityStatus, to: AgentIdentityStatus): boolean {
    const allowedTransitions = IDENTITY_STATUS_TRANSITIONS[from];
    return allowedTransitions.includes(to);
  }

  /**
   * Internal method for status transitions
   */
  private transitionStatus(
    agentId: string,
    newStatus: AgentIdentityStatus,
    options: { reason?: string; actorId?: string } = {}
  ): AgentIdentity {
    const store = getMemoryManager(this.config).getStore();
    const identity = store.getAgentIdentity(agentId);

    if (!identity) {
      throw new Error(`Identity not found: ${agentId}`);
    }

    const previousStatus = identity.status;

    // Validate transition
    if (!this.isValidTransition(previousStatus, newStatus)) {
      throw new Error(
        `Invalid status transition: ${previousStatus} -> ${newStatus}. ` +
        `Allowed transitions from ${previousStatus}: ${IDENTITY_STATUS_TRANSITIONS[previousStatus].join(', ') || 'none'}`
      );
    }

    // Apply transition
    store.updateAgentIdentity(agentId, {
      status: newStatus,
      lastActiveAt: newStatus === 'active' ? new Date() : undefined,
    });

    // Determine action type
    let action: AgentIdentityAuditEntry['action'];
    if (newStatus === 'active') {
      action = 'activated';
    } else if (newStatus === 'dormant') {
      action = 'deactivated';
    } else if (newStatus === 'retired') {
      action = 'retired';
    } else {
      action = 'updated';
    }

    // Create audit entry
    store.createAgentIdentityAudit({
      id: randomUUID(),
      agentId,
      action,
      previousStatus,
      newStatus,
      reason: options.reason,
      actorId: options.actorId,
    });

    log.info('Transitioned identity status', { agentId, from: previousStatus, to: newStatus });

    const updated = store.getAgentIdentity(agentId);
    if (!updated) {
      throw new Error('Failed to retrieve updated identity');
    }
    return updated;
  }
}

// Singleton instance
let instance: IdentityService | null = null;

/**
 * Get or create the identity service instance
 */
export function getIdentityService(config?: AgentStackConfig): IdentityService {
  if (!instance) {
    if (!config) {
      throw new Error('Configuration required to initialize identity service');
    }
    instance = new IdentityService(config);
  }
  return instance;
}

/**
 * Reset the identity service instance (for testing)
 */
export function resetIdentityService(): void {
  instance = null;
}
