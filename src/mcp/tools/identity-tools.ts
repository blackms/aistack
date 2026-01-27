/**
 * Identity MCP tools - manage agent identities
 */

import { z } from 'zod';
import type { AgentStackConfig, AgentIdentityStatus } from '../../types.js';
import { getIdentityService } from '../../agents/identity-service.js';

// Input schemas
const CreateIdentityInputSchema = z.object({
  agentType: z.string().min(1).describe('Type of agent (e.g., coder, researcher)'),
  displayName: z.string().min(1).max(100).optional().describe('Human-readable name for the identity'),
  description: z.string().max(1000).optional().describe('Description of the identity'),
  capabilities: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
    enabled: z.boolean(),
    metadata: z.record(z.unknown()).optional(),
  })).optional().describe('List of capabilities'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  createdBy: z.string().optional().describe('ID of the creator'),
  autoActivate: z.boolean().optional().describe('Automatically activate after creation'),
});

const GetIdentityInputSchema = z.object({
  agentId: z.string().uuid().optional().describe('Identity ID (UUID)'),
  displayName: z.string().optional().describe('Display name to look up'),
});

const ListIdentitiesInputSchema = z.object({
  status: z.enum(['created', 'active', 'dormant', 'retired']).optional().describe('Filter by status'),
  agentType: z.string().optional().describe('Filter by agent type'),
  limit: z.number().min(1).max(1000).optional().describe('Maximum results'),
  offset: z.number().min(0).optional().describe('Offset for pagination'),
});

const UpdateIdentityInputSchema = z.object({
  agentId: z.string().uuid().describe('Identity ID to update'),
  displayName: z.string().min(1).max(100).optional().describe('New display name'),
  description: z.string().max(1000).optional().describe('New description'),
  metadata: z.record(z.unknown()).optional().describe('New metadata'),
  capabilities: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
    enabled: z.boolean(),
    metadata: z.record(z.unknown()).optional(),
  })).optional().describe('Updated capabilities'),
  actorId: z.string().optional().describe('ID of the actor making the change'),
});

const LifecycleInputSchema = z.object({
  agentId: z.string().uuid().describe('Identity ID'),
  reason: z.string().optional().describe('Reason for the action'),
  actorId: z.string().optional().describe('ID of the actor'),
});

const AuditInputSchema = z.object({
  agentId: z.string().uuid().describe('Identity ID'),
  limit: z.number().min(1).max(1000).optional().describe('Maximum entries to return'),
});

function serializeIdentity(identity: {
  agentId: string;
  agentType: string;
  status: string;
  capabilities: unknown[];
  version: number;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastActiveAt: Date;
  retiredAt?: Date;
  retirementReason?: string;
  createdBy?: string;
  updatedAt: Date;
}) {
  return {
    agentId: identity.agentId,
    agentType: identity.agentType,
    status: identity.status,
    capabilities: identity.capabilities,
    version: identity.version,
    displayName: identity.displayName,
    description: identity.description,
    metadata: identity.metadata,
    createdAt: identity.createdAt.toISOString(),
    lastActiveAt: identity.lastActiveAt.toISOString(),
    retiredAt: identity.retiredAt?.toISOString(),
    retirementReason: identity.retirementReason,
    createdBy: identity.createdBy,
    updatedAt: identity.updatedAt.toISOString(),
  };
}

export function createIdentityTools(config: AgentStackConfig) {
  return {
    identity_create: {
      name: 'identity_create',
      description: 'Create a new persistent agent identity',
      inputSchema: {
        type: 'object',
        properties: {
          agentType: { type: 'string', description: 'Type of agent (e.g., coder, researcher)' },
          displayName: { type: 'string', description: 'Human-readable name for the identity' },
          description: { type: 'string', description: 'Description of the identity' },
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
                enabled: { type: 'boolean' },
                metadata: { type: 'object' },
              },
              required: ['name', 'enabled'],
            },
            description: 'List of capabilities',
          },
          metadata: { type: 'object', description: 'Additional metadata' },
          createdBy: { type: 'string', description: 'ID of the creator' },
          autoActivate: { type: 'boolean', description: 'Automatically activate after creation' },
        },
        required: ['agentType'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = CreateIdentityInputSchema.parse(params);

        try {
          const identityService = getIdentityService(config);
          const identity = identityService.createIdentity({
            agentType: input.agentType,
            displayName: input.displayName,
            description: input.description,
            capabilities: input.capabilities,
            metadata: input.metadata,
            createdBy: input.createdBy,
            autoActivate: input.autoActivate,
          });

          return {
            success: true,
            identity: serializeIdentity(identity),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    identity_get: {
      name: 'identity_get',
      description: 'Get an agent identity by ID or display name',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Identity ID (UUID)' },
          displayName: { type: 'string', description: 'Display name to look up' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = GetIdentityInputSchema.parse(params);

        if (!input.agentId && !input.displayName) {
          return {
            found: false,
            error: 'Either agentId or displayName is required',
          };
        }

        try {
          const identityService = getIdentityService(config);
          let identity;

          if (input.agentId) {
            identity = identityService.getIdentity(input.agentId);
          } else if (input.displayName) {
            identity = identityService.getIdentityByName(input.displayName);
          }

          if (!identity) {
            return {
              found: false,
              message: 'Identity not found',
            };
          }

          return {
            found: true,
            identity: serializeIdentity(identity),
          };
        } catch (error) {
          return {
            found: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    identity_list: {
      name: 'identity_list',
      description: 'List agent identities with optional filters',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['created', 'active', 'dormant', 'retired'],
            description: 'Filter by status',
          },
          agentType: { type: 'string', description: 'Filter by agent type' },
          limit: { type: 'number', description: 'Maximum results' },
          offset: { type: 'number', description: 'Offset for pagination' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = ListIdentitiesInputSchema.parse(params);

        try {
          const identityService = getIdentityService(config);
          const identities = identityService.listIdentities({
            status: input.status as AgentIdentityStatus | undefined,
            agentType: input.agentType,
            limit: input.limit,
            offset: input.offset,
          });

          return {
            count: identities.length,
            identities: identities.map(serializeIdentity),
          };
        } catch (error) {
          return {
            count: 0,
            identities: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    identity_update: {
      name: 'identity_update',
      description: 'Update an agent identity (metadata only, not status)',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Identity ID to update' },
          displayName: { type: 'string', description: 'New display name' },
          description: { type: 'string', description: 'New description' },
          metadata: { type: 'object', description: 'New metadata' },
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
                enabled: { type: 'boolean' },
                metadata: { type: 'object' },
              },
              required: ['name', 'enabled'],
            },
            description: 'Updated capabilities',
          },
          actorId: { type: 'string', description: 'ID of the actor making the change' },
        },
        required: ['agentId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = UpdateIdentityInputSchema.parse(params);

        try {
          const identityService = getIdentityService(config);
          const identity = identityService.updateIdentity(
            input.agentId,
            {
              displayName: input.displayName,
              description: input.description,
              metadata: input.metadata,
              capabilities: input.capabilities,
            },
            input.actorId
          );

          if (!identity) {
            return {
              success: false,
              error: 'Identity not found',
            };
          }

          return {
            success: true,
            identity: serializeIdentity(identity),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    identity_activate: {
      name: 'identity_activate',
      description: 'Activate an agent identity (transition from created or dormant to active)',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Identity ID to activate' },
          actorId: { type: 'string', description: 'ID of the actor' },
        },
        required: ['agentId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = LifecycleInputSchema.parse(params);

        try {
          const identityService = getIdentityService(config);
          const identity = identityService.activateIdentity(input.agentId, input.actorId);

          return {
            success: true,
            identity: serializeIdentity(identity),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    identity_deactivate: {
      name: 'identity_deactivate',
      description: 'Deactivate an agent identity (transition from active to dormant)',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Identity ID to deactivate' },
          reason: { type: 'string', description: 'Reason for deactivation' },
          actorId: { type: 'string', description: 'ID of the actor' },
        },
        required: ['agentId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = LifecycleInputSchema.parse(params);

        try {
          const identityService = getIdentityService(config);
          const identity = identityService.deactivateIdentity(
            input.agentId,
            input.reason,
            input.actorId
          );

          return {
            success: true,
            identity: serializeIdentity(identity),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    identity_retire: {
      name: 'identity_retire',
      description: 'Retire an agent identity permanently (cannot be undone)',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Identity ID to retire' },
          reason: { type: 'string', description: 'Reason for retirement' },
          actorId: { type: 'string', description: 'ID of the actor' },
        },
        required: ['agentId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = LifecycleInputSchema.parse(params);

        try {
          const identityService = getIdentityService(config);
          const identity = identityService.retireIdentity(
            input.agentId,
            input.reason,
            input.actorId
          );

          return {
            success: true,
            identity: serializeIdentity(identity),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    identity_audit: {
      name: 'identity_audit',
      description: 'Get the audit trail for an agent identity',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Identity ID' },
          limit: { type: 'number', description: 'Maximum entries to return' },
        },
        required: ['agentId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = AuditInputSchema.parse(params);

        try {
          const identityService = getIdentityService(config);

          // Verify identity exists
          const identity = identityService.getIdentity(input.agentId);
          if (!identity) {
            return {
              success: false,
              error: 'Identity not found',
            };
          }

          const entries = identityService.getAuditTrail(input.agentId, input.limit);

          return {
            agentId: input.agentId,
            count: entries.length,
            entries: entries.map(entry => ({
              id: entry.id,
              action: entry.action,
              previousStatus: entry.previousStatus,
              newStatus: entry.newStatus,
              reason: entry.reason,
              actorId: entry.actorId,
              metadata: entry.metadata,
              timestamp: entry.timestamp.toISOString(),
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },
  };
}
