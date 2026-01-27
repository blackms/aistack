/**
 * Tests for MCP Identity Tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIdentityTools } from '../../src/mcp/tools/identity-tools.js';
import { resetIdentityService } from '../../src/agents/identity-service.js';
import { resetMemoryManager, SQLiteStore } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';

describe('MCP Identity Tools', () => {
  const testDbPath = '/tmp/test-mcp-identity-tools.db';
  let config: AgentStackConfig;
  let tools: ReturnType<typeof createIdentityTools>;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // Reset singletons
    resetIdentityService();
    resetMemoryManager();

    config = {
      version: '1.0.0',
      memory: {
        path: testDbPath,
        defaultNamespace: 'test',
        vectorSearch: {
          enabled: false,
        },
      },
      providers: {
        default: 'anthropic',
        anthropic: { apiKey: 'test-key' },
      },
      mcp: { enabled: true },
      web: { port: 3000 },
      agents: [],
    } as AgentStackConfig;

    tools = createIdentityTools(config);
  });

  afterEach(() => {
    resetIdentityService();
    resetMemoryManager();

    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('identity_create', () => {
    it('should create an identity', async () => {
      const result = await tools.identity_create.handler({
        agentType: 'coder',
        displayName: 'Test Coder',
      });

      expect(result.success).toBe(true);
      expect(result.identity).toBeDefined();
      expect(result.identity.agentType).toBe('coder');
      expect(result.identity.displayName).toBe('Test Coder');
      expect(result.identity.status).toBe('created');
    });

    it('should create an identity with auto-activate', async () => {
      const result = await tools.identity_create.handler({
        agentType: 'researcher',
        displayName: 'Auto Researcher',
        autoActivate: true,
      });

      expect(result.success).toBe(true);
      expect(result.identity.status).toBe('active');
    });

    it('should create an identity with capabilities', async () => {
      const result = await tools.identity_create.handler({
        agentType: 'coder',
        capabilities: [
          { name: 'typescript', enabled: true, version: '5.0' },
          { name: 'python', enabled: false },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.identity.capabilities).toHaveLength(2);
      expect(result.identity.capabilities[0].name).toBe('typescript');
    });

    it('should create an identity with metadata', async () => {
      const result = await tools.identity_create.handler({
        agentType: 'coder',
        metadata: { team: 'backend', priority: 1 },
      });

      expect(result.success).toBe(true);
      expect(result.identity.metadata).toEqual({ team: 'backend', priority: 1 });
    });

    it('should create an identity with createdBy', async () => {
      const result = await tools.identity_create.handler({
        agentType: 'coder',
        createdBy: 'admin-user',
      });

      expect(result.success).toBe(true);
      expect(result.identity.createdBy).toBe('admin-user');
    });

    it('should return error for invalid input', async () => {
      // Zod throws synchronously on validation, so we catch it
      await expect(async () => {
        await tools.identity_create.handler({
          // Missing required agentType
        });
      }).rejects.toThrow();
    });
  });

  describe('identity_get', () => {
    it('should get an identity by ID', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        displayName: 'Get Test',
      });

      const result = await tools.identity_get.handler({
        agentId: created.identity.agentId,
      });

      expect(result.found).toBe(true);
      expect(result.identity.displayName).toBe('Get Test');
    });

    it('should get an identity by displayName', async () => {
      await tools.identity_create.handler({
        agentType: 'coder',
        displayName: 'Unique Name',
      });

      const result = await tools.identity_get.handler({
        displayName: 'Unique Name',
      });

      expect(result.found).toBe(true);
      expect(result.identity.displayName).toBe('Unique Name');
    });

    it('should return not found for non-existent ID', async () => {
      const result = await tools.identity_get.handler({
        agentId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Identity not found');
    });

    it('should return not found for non-existent name', async () => {
      const result = await tools.identity_get.handler({
        displayName: 'Non Existent',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Identity not found');
    });

    it('should return error if neither ID nor name provided', async () => {
      const result = await tools.identity_get.handler({});

      expect(result.found).toBe(false);
      expect(result.error).toBe('Either agentId or displayName is required');
    });
  });

  describe('identity_list', () => {
    beforeEach(async () => {
      // Create several identities for testing
      await tools.identity_create.handler({
        agentType: 'coder',
        displayName: 'Coder 1',
        autoActivate: true,
      });
      await tools.identity_create.handler({
        agentType: 'coder',
        displayName: 'Coder 2',
      });
      await tools.identity_create.handler({
        agentType: 'researcher',
        displayName: 'Researcher 1',
        autoActivate: true,
      });
    });

    it('should list all identities', async () => {
      const result = await tools.identity_list.handler({});

      expect(result.count).toBe(3);
      expect(result.identities).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const result = await tools.identity_list.handler({
        status: 'active',
      });

      expect(result.count).toBe(2);
      expect(result.identities.every((i: { status: string }) => i.status === 'active')).toBe(true);
    });

    it('should filter by agentType', async () => {
      const result = await tools.identity_list.handler({
        agentType: 'coder',
      });

      expect(result.count).toBe(2);
      expect(result.identities.every((i: { agentType: string }) => i.agentType === 'coder')).toBe(true);
    });

    it('should support limit', async () => {
      const result = await tools.identity_list.handler({
        limit: 2,
      });

      expect(result.count).toBe(2);
    });

    it('should support offset', async () => {
      const result = await tools.identity_list.handler({
        offset: 1,
        limit: 10,
      });

      expect(result.count).toBe(2);
    });
  });

  describe('identity_update', () => {
    it('should update displayName', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        displayName: 'Original Name',
      });

      const result = await tools.identity_update.handler({
        agentId: created.identity.agentId,
        displayName: 'Updated Name',
      });

      expect(result.success).toBe(true);
      expect(result.identity.displayName).toBe('Updated Name');
    });

    it('should update description', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      const result = await tools.identity_update.handler({
        agentId: created.identity.agentId,
        description: 'New description',
      });

      expect(result.success).toBe(true);
      expect(result.identity.description).toBe('New description');
    });

    it('should update metadata', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        metadata: { old: 'value' },
      });

      const result = await tools.identity_update.handler({
        agentId: created.identity.agentId,
        metadata: { new: 'value', count: 42 },
      });

      expect(result.success).toBe(true);
      expect(result.identity.metadata).toEqual({ new: 'value', count: 42 });
    });

    it('should update capabilities', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        capabilities: [{ name: 'old', enabled: true }],
      });

      const result = await tools.identity_update.handler({
        agentId: created.identity.agentId,
        capabilities: [{ name: 'new', enabled: false }],
      });

      expect(result.success).toBe(true);
      expect(result.identity.capabilities).toHaveLength(1);
      expect(result.identity.capabilities[0].name).toBe('new');
    });

    it('should return error for non-existent identity', async () => {
      const result = await tools.identity_update.handler({
        agentId: '00000000-0000-0000-0000-000000000000',
        displayName: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Identity not found');
    });
  });

  describe('identity_activate', () => {
    it('should activate an identity from created', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      expect(created.identity.status).toBe('created');

      const result = await tools.identity_activate.handler({
        agentId: created.identity.agentId,
      });

      expect(result.success).toBe(true);
      expect(result.identity.status).toBe('active');
    });

    it('should activate an identity with actorId', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      const result = await tools.identity_activate.handler({
        agentId: created.identity.agentId,
        actorId: 'admin-123',
      });

      expect(result.success).toBe(true);
    });

    it('should return error for invalid transition', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        autoActivate: true,
      });

      // Retire the identity
      await tools.identity_retire.handler({
        agentId: created.identity.agentId,
      });

      // Try to activate retired identity
      const result = await tools.identity_activate.handler({
        agentId: created.identity.agentId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status transition');
    });
  });

  describe('identity_deactivate', () => {
    it('should deactivate an active identity', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        autoActivate: true,
      });

      const result = await tools.identity_deactivate.handler({
        agentId: created.identity.agentId,
      });

      expect(result.success).toBe(true);
      expect(result.identity.status).toBe('dormant');
    });

    it('should deactivate with reason', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        autoActivate: true,
      });

      const result = await tools.identity_deactivate.handler({
        agentId: created.identity.agentId,
        reason: 'Scheduled maintenance',
      });

      expect(result.success).toBe(true);
    });

    it('should return error for non-active identity', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      const result = await tools.identity_deactivate.handler({
        agentId: created.identity.agentId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status transition');
    });
  });

  describe('identity_retire', () => {
    it('should retire an identity', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
        autoActivate: true,
      });

      const result = await tools.identity_retire.handler({
        agentId: created.identity.agentId,
        reason: 'End of life',
      });

      expect(result.success).toBe(true);
      expect(result.identity.status).toBe('retired');
      expect(result.identity.retirementReason).toBe('End of life');
      expect(result.identity.retiredAt).toBeDefined();
    });

    it('should retire from any non-retired state', async () => {
      // Retire from created
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      const result = await tools.identity_retire.handler({
        agentId: created.identity.agentId,
      });

      expect(result.success).toBe(true);
    });

    it('should return error when already retired', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      await tools.identity_retire.handler({
        agentId: created.identity.agentId,
      });

      const result = await tools.identity_retire.handler({
        agentId: created.identity.agentId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already retired');
    });
  });

  describe('identity_audit', () => {
    it('should get audit trail for identity', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      await tools.identity_activate.handler({
        agentId: created.identity.agentId,
      });

      await tools.identity_deactivate.handler({
        agentId: created.identity.agentId,
      });

      const result = await tools.identity_audit.handler({
        agentId: created.identity.agentId,
      });

      expect(result.agentId).toBe(created.identity.agentId);
      expect(result.count).toBeGreaterThanOrEqual(3); // created, activated, deactivated
      expect(result.entries).toBeDefined();
    });

    it('should support limit parameter', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      await tools.identity_activate.handler({
        agentId: created.identity.agentId,
      });

      await tools.identity_deactivate.handler({
        agentId: created.identity.agentId,
      });

      const result = await tools.identity_audit.handler({
        agentId: created.identity.agentId,
        limit: 2,
      });

      expect(result.count).toBe(2);
    });

    it('should return error for non-existent identity', async () => {
      const result = await tools.identity_audit.handler({
        agentId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Identity not found');
    });

    it('should include audit entry details', async () => {
      const created = await tools.identity_create.handler({
        agentType: 'coder',
      });

      const result = await tools.identity_audit.handler({
        agentId: created.identity.agentId,
      });

      expect(result.entries[0]).toHaveProperty('id');
      expect(result.entries[0]).toHaveProperty('action');
      expect(result.entries[0]).toHaveProperty('timestamp');
      expect(result.entries[0].action).toBe('created');
    });
  });

  describe('tool metadata', () => {
    it('should have correct tool names', () => {
      expect(tools.identity_create.name).toBe('identity_create');
      expect(tools.identity_get.name).toBe('identity_get');
      expect(tools.identity_list.name).toBe('identity_list');
      expect(tools.identity_update.name).toBe('identity_update');
      expect(tools.identity_activate.name).toBe('identity_activate');
      expect(tools.identity_deactivate.name).toBe('identity_deactivate');
      expect(tools.identity_retire.name).toBe('identity_retire');
      expect(tools.identity_audit.name).toBe('identity_audit');
    });

    it('should have descriptions', () => {
      expect(tools.identity_create.description).toBeTruthy();
      expect(tools.identity_get.description).toBeTruthy();
      expect(tools.identity_list.description).toBeTruthy();
      expect(tools.identity_update.description).toBeTruthy();
      expect(tools.identity_activate.description).toBeTruthy();
      expect(tools.identity_deactivate.description).toBeTruthy();
      expect(tools.identity_retire.description).toBeTruthy();
      expect(tools.identity_audit.description).toBeTruthy();
    });

    it('should have input schemas', () => {
      expect(tools.identity_create.inputSchema).toBeDefined();
      expect(tools.identity_create.inputSchema.type).toBe('object');
      expect(tools.identity_create.inputSchema.required).toContain('agentType');
    });
  });
});
