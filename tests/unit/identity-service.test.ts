/**
 * Identity Service tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IdentityService, resetIdentityService } from '../../src/agents/identity-service.js';
import { resetMemoryManager } from '../../src/memory/index.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-identity-${Date.now()}.db`),
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('IdentityService', () => {
  let service: IdentityService;
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    resetMemoryManager();
    resetIdentityService();
    config = createTestConfig();
    dbPath = config.memory.path;
    service = new IdentityService(config);
  });

  afterEach(() => {
    resetIdentityService();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('createIdentity', () => {
    it('should create a new identity', () => {
      const identity = service.createIdentity({
        agentType: 'coder',
        displayName: 'Test Coder',
        description: 'A test coding agent',
      });

      expect(identity.agentId).toBeDefined();
      expect(identity.agentType).toBe('coder');
      expect(identity.displayName).toBe('Test Coder');
      expect(identity.description).toBe('A test coding agent');
      expect(identity.status).toBe('created');
      expect(identity.version).toBe(1);
      expect(identity.capabilities).toEqual([]);
      expect(identity.createdAt).toBeInstanceOf(Date);
      expect(identity.lastActiveAt).toBeInstanceOf(Date);
      expect(identity.updatedAt).toBeInstanceOf(Date);
    });

    it('should create identity with auto-activate', () => {
      const identity = service.createIdentity({
        agentType: 'researcher',
        autoActivate: true,
      });

      expect(identity.status).toBe('active');
    });

    it('should create identity with capabilities', () => {
      const capabilities = [
        { name: 'code-generation', enabled: true, version: '1.0' },
        { name: 'code-review', enabled: false },
      ];

      const identity = service.createIdentity({
        agentType: 'coder',
        capabilities,
      });

      expect(identity.capabilities).toHaveLength(2);
      expect(identity.capabilities[0].name).toBe('code-generation');
      expect(identity.capabilities[0].enabled).toBe(true);
      expect(identity.capabilities[1].enabled).toBe(false);
    });

    it('should create identity with metadata', () => {
      const identity = service.createIdentity({
        agentType: 'analyst',
        metadata: { team: 'engineering', level: 'senior' },
      });

      expect(identity.metadata).toEqual({ team: 'engineering', level: 'senior' });
    });

    it('should create identity with createdBy', () => {
      const identity = service.createIdentity({
        agentType: 'tester',
        createdBy: 'admin-user-123',
      });

      expect(identity.createdBy).toBe('admin-user-123');
    });

    it('should create audit entry on creation', () => {
      const identity = service.createIdentity({
        agentType: 'coder',
        displayName: 'Audit Test',
      });

      const audit = service.getAuditTrail(identity.agentId);
      expect(audit.length).toBeGreaterThanOrEqual(1);
      expect(audit[0].action).toBe('created');
      expect(audit[0].newStatus).toBe('created');
    });

    it('should create two audit entries when auto-activated', () => {
      const identity = service.createIdentity({
        agentType: 'coder',
        autoActivate: true,
      });

      const audit = service.getAuditTrail(identity.agentId);
      expect(audit.length).toBe(2);

      const actions = audit.map(a => a.action);
      expect(actions).toContain('created');
      expect(actions).toContain('activated');
    });
  });

  describe('getIdentity', () => {
    it('should get identity by ID', () => {
      const created = service.createIdentity({ agentType: 'coder' });
      const retrieved = service.getIdentity(created.agentId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.agentId).toBe(created.agentId);
      expect(retrieved?.agentType).toBe('coder');
    });

    it('should return null for non-existent identity', () => {
      const result = service.getIdentity('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getIdentityByName', () => {
    it('should get identity by display name', () => {
      service.createIdentity({
        agentType: 'coder',
        displayName: 'My Coder Agent',
      });

      const retrieved = service.getIdentityByName('My Coder Agent');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.displayName).toBe('My Coder Agent');
    });

    it('should return null for non-existent name', () => {
      const result = service.getIdentityByName('Non-Existent Agent');
      expect(result).toBeNull();
    });
  });

  describe('listIdentities', () => {
    beforeEach(() => {
      service.createIdentity({ agentType: 'coder', displayName: 'Coder 1' });
      service.createIdentity({ agentType: 'coder', displayName: 'Coder 2', autoActivate: true });
      service.createIdentity({ agentType: 'tester', displayName: 'Tester 1' });
    });

    it('should list all identities', () => {
      const identities = service.listIdentities();
      expect(identities.length).toBe(3);
    });

    it('should filter by status', () => {
      const created = service.listIdentities({ status: 'created' });
      expect(created.length).toBe(2);

      const active = service.listIdentities({ status: 'active' });
      expect(active.length).toBe(1);
    });

    it('should filter by agent type', () => {
      const coders = service.listIdentities({ agentType: 'coder' });
      expect(coders.length).toBe(2);

      const testers = service.listIdentities({ agentType: 'tester' });
      expect(testers.length).toBe(1);
    });

    it('should respect limit', () => {
      const limited = service.listIdentities({ limit: 2 });
      expect(limited.length).toBe(2);
    });

    it('should respect offset', () => {
      const offset = service.listIdentities({ offset: 2 });
      expect(offset.length).toBe(1);
    });
  });

  describe('updateIdentity', () => {
    it('should update display name', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      const updated = service.updateIdentity(identity.agentId, {
        displayName: 'Updated Name',
      });

      expect(updated?.displayName).toBe('Updated Name');
    });

    it('should update description', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      const updated = service.updateIdentity(identity.agentId, {
        description: 'Updated description',
      });

      expect(updated?.description).toBe('Updated description');
    });

    it('should update metadata', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      const updated = service.updateIdentity(identity.agentId, {
        metadata: { key: 'value' },
      });

      expect(updated?.metadata).toEqual({ key: 'value' });
    });

    it('should update capabilities', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      const updated = service.updateIdentity(identity.agentId, {
        capabilities: [{ name: 'new-cap', enabled: true }],
      });

      expect(updated?.capabilities).toHaveLength(1);
      expect(updated?.capabilities[0].name).toBe('new-cap');
    });

    it('should return null for non-existent identity', () => {
      const result = service.updateIdentity('non-existent', { displayName: 'test' });
      expect(result).toBeNull();
    });

    it('should throw when updating retired identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.retireIdentity(identity.agentId, 'test');

      expect(() => {
        service.updateIdentity(identity.agentId, { displayName: 'New' });
      }).toThrow('Cannot update a retired identity');
    });

    it('should create audit entry on update', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      service.updateIdentity(identity.agentId, { displayName: 'Updated' });

      const audit = service.getAuditTrail(identity.agentId);
      const updateEntry = audit.find(a => a.action === 'updated');
      expect(updateEntry).toBeDefined();
    });
  });

  describe('activateIdentity', () => {
    it('should activate a created identity', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      expect(identity.status).toBe('created');

      const activated = service.activateIdentity(identity.agentId);
      expect(activated.status).toBe('active');
    });

    it('should activate a dormant identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.deactivateIdentity(identity.agentId);

      const reactivated = service.activateIdentity(identity.agentId);
      expect(reactivated.status).toBe('active');
    });

    it('should throw for non-existent identity', () => {
      expect(() => {
        service.activateIdentity('non-existent');
      }).toThrow('Identity not found');
    });

    it('should throw for invalid transition from retired', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.retireIdentity(identity.agentId);

      expect(() => {
        service.activateIdentity(identity.agentId);
      }).toThrow('Invalid status transition');
    });

    it('should create audit entry', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      service.activateIdentity(identity.agentId);

      const audit = service.getAuditTrail(identity.agentId);
      const activateEntry = audit.find(a => a.action === 'activated');
      expect(activateEntry).toBeDefined();
      expect(activateEntry?.previousStatus).toBe('created');
      expect(activateEntry?.newStatus).toBe('active');
    });

    it('should update lastActiveAt', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      const originalLastActive = identity.lastActiveAt;

      // Small delay to ensure timestamp difference
      const activated = service.activateIdentity(identity.agentId);
      expect(activated.lastActiveAt.getTime()).toBeGreaterThanOrEqual(originalLastActive.getTime());
    });
  });

  describe('deactivateIdentity', () => {
    it('should deactivate an active identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      expect(identity.status).toBe('active');

      const deactivated = service.deactivateIdentity(identity.agentId);
      expect(deactivated.status).toBe('dormant');
    });

    it('should throw for non-existent identity', () => {
      expect(() => {
        service.deactivateIdentity('non-existent');
      }).toThrow('Identity not found');
    });

    it('should throw for invalid transition from created', () => {
      const identity = service.createIdentity({ agentType: 'coder' });

      expect(() => {
        service.deactivateIdentity(identity.agentId);
      }).toThrow('Invalid status transition');
    });

    it('should include reason in audit', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.deactivateIdentity(identity.agentId, 'Maintenance mode');

      const audit = service.getAuditTrail(identity.agentId);
      const deactivateEntry = audit.find(a => a.action === 'deactivated');
      expect(deactivateEntry?.reason).toBe('Maintenance mode');
    });
  });

  describe('retireIdentity', () => {
    it('should retire an active identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      const retired = service.retireIdentity(identity.agentId, 'No longer needed');

      expect(retired.status).toBe('retired');
      expect(retired.retiredAt).toBeInstanceOf(Date);
      expect(retired.retirementReason).toBe('No longer needed');
    });

    it('should retire a created identity', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      const retired = service.retireIdentity(identity.agentId);

      expect(retired.status).toBe('retired');
    });

    it('should retire a dormant identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.deactivateIdentity(identity.agentId);
      const retired = service.retireIdentity(identity.agentId);

      expect(retired.status).toBe('retired');
    });

    it('should throw for already retired identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.retireIdentity(identity.agentId);

      expect(() => {
        service.retireIdentity(identity.agentId);
      }).toThrow('already retired');
    });

    it('should throw for non-existent identity', () => {
      expect(() => {
        service.retireIdentity('non-existent');
      }).toThrow('Identity not found');
    });

    it('should create audit entry', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.retireIdentity(identity.agentId, 'Test retirement');

      const audit = service.getAuditTrail(identity.agentId);
      const retireEntry = audit.find(a => a.action === 'retired');
      expect(retireEntry).toBeDefined();
      expect(retireEntry?.reason).toBe('Test retirement');
      expect(retireEntry?.newStatus).toBe('retired');
    });
  });

  describe('recordSpawn', () => {
    it('should record spawn event', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.recordSpawn(identity.agentId, 'spawn-123');

      const audit = service.getAuditTrail(identity.agentId);
      const spawnEntry = audit.find(a => a.action === 'spawned');
      expect(spawnEntry).toBeDefined();
      expect(spawnEntry?.metadata?.spawnId).toBe('spawn-123');
    });

    it('should throw for non-existent identity', () => {
      expect(() => {
        service.recordSpawn('non-existent', 'spawn-123');
      }).toThrow('Identity not found');
    });

    it('should throw for retired identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.retireIdentity(identity.agentId);

      expect(() => {
        service.recordSpawn(identity.agentId, 'spawn-123');
      }).toThrow('Cannot spawn a retired identity');
    });

    it('should update lastActiveAt', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      const originalLastActive = identity.lastActiveAt;

      service.recordSpawn(identity.agentId, 'spawn-123');

      const updated = service.getIdentity(identity.agentId);
      expect(updated?.lastActiveAt.getTime()).toBeGreaterThanOrEqual(originalLastActive.getTime());
    });
  });

  describe('getAuditTrail', () => {
    it('should return audit history', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      service.activateIdentity(identity.agentId);
      service.deactivateIdentity(identity.agentId);
      service.activateIdentity(identity.agentId);

      const audit = service.getAuditTrail(identity.agentId);
      expect(audit.length).toBeGreaterThanOrEqual(4);
    });

    it('should respect limit', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      service.activateIdentity(identity.agentId);
      service.deactivateIdentity(identity.agentId);

      const audit = service.getAuditTrail(identity.agentId, 2);
      expect(audit.length).toBe(2);
    });

    it('should return entries in descending order', () => {
      const identity = service.createIdentity({ agentType: 'coder' });
      service.activateIdentity(identity.agentId);

      const audit = service.getAuditTrail(identity.agentId);

      // Most recent should be first
      for (let i = 0; i < audit.length - 1; i++) {
        expect(audit[i].timestamp.getTime()).toBeGreaterThanOrEqual(audit[i + 1].timestamp.getTime());
      }
    });
  });

  describe('touchIdentity', () => {
    it('should update lastActiveAt', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      const originalLastActive = identity.lastActiveAt;

      const result = service.touchIdentity(identity.agentId);
      expect(result).toBe(true);

      const updated = service.getIdentity(identity.agentId);
      expect(updated?.lastActiveAt.getTime()).toBeGreaterThanOrEqual(originalLastActive.getTime());
    });

    it('should return false for non-existent identity', () => {
      const result = service.touchIdentity('non-existent');
      expect(result).toBe(false);
    });

    it('should return false for retired identity', () => {
      const identity = service.createIdentity({ agentType: 'coder', autoActivate: true });
      service.retireIdentity(identity.agentId);

      const result = service.touchIdentity(identity.agentId);
      expect(result).toBe(false);
    });
  });

  describe('isValidTransition', () => {
    it('should validate created -> active', () => {
      expect(service.isValidTransition('created', 'active')).toBe(true);
    });

    it('should validate created -> retired', () => {
      expect(service.isValidTransition('created', 'retired')).toBe(true);
    });

    it('should validate active -> dormant', () => {
      expect(service.isValidTransition('active', 'dormant')).toBe(true);
    });

    it('should validate active -> retired', () => {
      expect(service.isValidTransition('active', 'retired')).toBe(true);
    });

    it('should validate dormant -> active', () => {
      expect(service.isValidTransition('dormant', 'active')).toBe(true);
    });

    it('should validate dormant -> retired', () => {
      expect(service.isValidTransition('dormant', 'retired')).toBe(true);
    });

    it('should invalidate retired -> any', () => {
      expect(service.isValidTransition('retired', 'active')).toBe(false);
      expect(service.isValidTransition('retired', 'dormant')).toBe(false);
      expect(service.isValidTransition('retired', 'created')).toBe(false);
    });

    it('should invalidate created -> dormant', () => {
      expect(service.isValidTransition('created', 'dormant')).toBe(false);
    });

    it('should invalidate active -> created', () => {
      expect(service.isValidTransition('active', 'created')).toBe(false);
    });
  });
});
