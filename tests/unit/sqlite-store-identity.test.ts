/**
 * SQLite Store Identity Operations tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('SQLiteStore Identity Operations', () => {
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-identity-store-${Date.now()}.db`);
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('createAgentIdentity', () => {
    it('should create a basic identity', () => {
      const identity = store.createAgentIdentity({
        agentId: randomUUID(),
        agentType: 'coder',
      });

      expect(identity.agentId).toBeDefined();
      expect(identity.agentType).toBe('coder');
      expect(identity.status).toBe('created');
      expect(identity.version).toBe(1);
      expect(identity.capabilities).toEqual([]);
      expect(identity.createdAt).toBeInstanceOf(Date);
      expect(identity.lastActiveAt).toBeInstanceOf(Date);
      expect(identity.updatedAt).toBeInstanceOf(Date);
    });

    it('should create identity with all fields', () => {
      const agentId = randomUUID();
      const capabilities = [{ name: 'cap1', enabled: true }];

      const identity = store.createAgentIdentity({
        agentId,
        agentType: 'researcher',
        status: 'active',
        capabilities,
        displayName: 'Test Agent',
        description: 'A test agent',
        metadata: { foo: 'bar' },
        createdBy: 'admin',
      });

      expect(identity.agentId).toBe(agentId);
      expect(identity.agentType).toBe('researcher');
      expect(identity.status).toBe('active');
      expect(identity.capabilities).toEqual(capabilities);
      expect(identity.displayName).toBe('Test Agent');
      expect(identity.description).toBe('A test agent');
      expect(identity.metadata).toEqual({ foo: 'bar' });
      expect(identity.createdBy).toBe('admin');
    });

    it('should persist identity to database', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({
        agentId,
        agentType: 'tester',
        displayName: 'Persistent Agent',
      });

      const retrieved = store.getAgentIdentity(agentId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.displayName).toBe('Persistent Agent');
    });
  });

  describe('getAgentIdentity', () => {
    it('should retrieve existing identity', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({
        agentId,
        agentType: 'coder',
        displayName: 'Get Test',
      });

      const retrieved = store.getAgentIdentity(agentId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.agentId).toBe(agentId);
      expect(retrieved?.displayName).toBe('Get Test');
    });

    it('should return null for non-existent identity', () => {
      const result = store.getAgentIdentity('non-existent-id');
      expect(result).toBeNull();
    });

    it('should deserialize capabilities correctly', () => {
      const agentId = randomUUID();
      const capabilities = [
        { name: 'cap1', enabled: true, version: '1.0' },
        { name: 'cap2', enabled: false, metadata: { key: 'value' } },
      ];

      store.createAgentIdentity({
        agentId,
        agentType: 'coder',
        capabilities,
      });

      const retrieved = store.getAgentIdentity(agentId);
      expect(retrieved?.capabilities).toEqual(capabilities);
    });

    it('should deserialize metadata correctly', () => {
      const agentId = randomUUID();
      const metadata = { nested: { key: 'value' }, array: [1, 2, 3] };

      store.createAgentIdentity({
        agentId,
        agentType: 'coder',
        metadata,
      });

      const retrieved = store.getAgentIdentity(agentId);
      expect(retrieved?.metadata).toEqual(metadata);
    });
  });

  describe('getAgentIdentityByName', () => {
    it('should retrieve identity by display name', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({
        agentId,
        agentType: 'coder',
        displayName: 'Named Agent',
      });

      const retrieved = store.getAgentIdentityByName('Named Agent');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.agentId).toBe(agentId);
    });

    it('should return null for non-existent name', () => {
      const result = store.getAgentIdentityByName('Non-Existent');
      expect(result).toBeNull();
    });

    it('should be case-sensitive', () => {
      store.createAgentIdentity({
        agentId: randomUUID(),
        agentType: 'coder',
        displayName: 'CaseSensitive',
      });

      const lower = store.getAgentIdentityByName('casesensitive');
      expect(lower).toBeNull();

      const correct = store.getAgentIdentityByName('CaseSensitive');
      expect(correct).not.toBeNull();
    });
  });

  describe('updateAgentIdentity', () => {
    it('should update display name', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({
        agentId,
        agentType: 'coder',
        displayName: 'Original',
      });

      const success = store.updateAgentIdentity(agentId, {
        displayName: 'Updated',
      });

      expect(success).toBe(true);
      const updated = store.getAgentIdentity(agentId);
      expect(updated?.displayName).toBe('Updated');
    });

    it('should update description', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      store.updateAgentIdentity(agentId, { description: 'New description' });

      const updated = store.getAgentIdentity(agentId);
      expect(updated?.description).toBe('New description');
    });

    it('should update status', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      store.updateAgentIdentity(agentId, { status: 'active' });

      const updated = store.getAgentIdentity(agentId);
      expect(updated?.status).toBe('active');
    });

    it('should update capabilities', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      const newCapabilities = [{ name: 'new-cap', enabled: true }];
      store.updateAgentIdentity(agentId, { capabilities: newCapabilities });

      const updated = store.getAgentIdentity(agentId);
      expect(updated?.capabilities).toEqual(newCapabilities);
    });

    it('should update metadata', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      store.updateAgentIdentity(agentId, { metadata: { updated: true } });

      const updated = store.getAgentIdentity(agentId);
      expect(updated?.metadata).toEqual({ updated: true });
    });

    it('should update lastActiveAt', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      const newDate = new Date();
      store.updateAgentIdentity(agentId, { lastActiveAt: newDate });

      const updated = store.getAgentIdentity(agentId);
      expect(updated?.lastActiveAt.getTime()).toBe(newDate.getTime());
    });

    it('should update retiredAt and retirementReason', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      const retiredAt = new Date();
      store.updateAgentIdentity(agentId, {
        retiredAt,
        retirementReason: 'No longer needed',
      });

      const updated = store.getAgentIdentity(agentId);
      expect(updated?.retiredAt?.getTime()).toBe(retiredAt.getTime());
      expect(updated?.retirementReason).toBe('No longer needed');
    });

    it('should return false for non-existent identity', () => {
      const success = store.updateAgentIdentity('non-existent', {
        displayName: 'Test',
      });
      expect(success).toBe(false);
    });

    it('should update updatedAt timestamp', () => {
      const agentId = randomUUID();
      const identity = store.createAgentIdentity({ agentId, agentType: 'coder' });
      const originalUpdatedAt = identity.updatedAt;

      // Small delay
      store.updateAgentIdentity(agentId, { displayName: 'Changed' });

      const updated = store.getAgentIdentity(agentId);
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });
  });

  describe('listAgentIdentities', () => {
    beforeEach(() => {
      store.createAgentIdentity({
        agentId: randomUUID(),
        agentType: 'coder',
        status: 'created',
        displayName: 'Coder 1',
      });
      store.createAgentIdentity({
        agentId: randomUUID(),
        agentType: 'coder',
        status: 'active',
        displayName: 'Coder 2',
      });
      store.createAgentIdentity({
        agentId: randomUUID(),
        agentType: 'tester',
        status: 'active',
        displayName: 'Tester 1',
      });
    });

    it('should list all identities', () => {
      const identities = store.listAgentIdentities();
      expect(identities.length).toBe(3);
    });

    it('should filter by status', () => {
      const active = store.listAgentIdentities({ status: 'active' });
      expect(active.length).toBe(2);

      const created = store.listAgentIdentities({ status: 'created' });
      expect(created.length).toBe(1);
    });

    it('should filter by agentType', () => {
      const coders = store.listAgentIdentities({ agentType: 'coder' });
      expect(coders.length).toBe(2);

      const testers = store.listAgentIdentities({ agentType: 'tester' });
      expect(testers.length).toBe(1);
    });

    it('should combine filters', () => {
      const activeCoders = store.listAgentIdentities({
        status: 'active',
        agentType: 'coder',
      });
      expect(activeCoders.length).toBe(1);
    });

    it('should respect limit', () => {
      const limited = store.listAgentIdentities({ limit: 2 });
      expect(limited.length).toBe(2);
    });

    it('should respect offset', () => {
      const offset = store.listAgentIdentities({ offset: 2 });
      expect(offset.length).toBe(1);
    });

    it('should order by lastActiveAt descending', () => {
      const identities = store.listAgentIdentities();

      for (let i = 0; i < identities.length - 1; i++) {
        expect(identities[i].lastActiveAt.getTime()).toBeGreaterThanOrEqual(
          identities[i + 1].lastActiveAt.getTime()
        );
      }
    });
  });

  describe('createAgentIdentityAudit', () => {
    it('should create audit entry', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      store.createAgentIdentityAudit({
        id: randomUUID(),
        agentId,
        action: 'activated',
        previousStatus: 'created',
        newStatus: 'active',
      });

      const audit = store.getAgentIdentityAuditHistory(agentId);
      expect(audit.length).toBe(1);
      expect(audit[0].action).toBe('activated');
    });

    it('should create audit entry with all fields', () => {
      const agentId = randomUUID();
      const auditId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      store.createAgentIdentityAudit({
        id: auditId,
        agentId,
        action: 'retired',
        previousStatus: 'active',
        newStatus: 'retired',
        reason: 'Test retirement',
        actorId: 'admin-123',
        metadata: { source: 'test' },
      });

      const audit = store.getAgentIdentityAuditHistory(agentId);
      expect(audit[0].id).toBe(auditId);
      expect(audit[0].reason).toBe('Test retirement');
      expect(audit[0].actorId).toBe('admin-123');
      expect(audit[0].metadata).toEqual({ source: 'test' });
    });
  });

  describe('getAgentIdentityAuditHistory', () => {
    it('should retrieve audit history', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      store.createAgentIdentityAudit({
        id: randomUUID(),
        agentId,
        action: 'created',
        newStatus: 'created',
      });
      store.createAgentIdentityAudit({
        id: randomUUID(),
        agentId,
        action: 'activated',
        previousStatus: 'created',
        newStatus: 'active',
      });
      store.createAgentIdentityAudit({
        id: randomUUID(),
        agentId,
        action: 'deactivated',
        previousStatus: 'active',
        newStatus: 'dormant',
      });

      const audit = store.getAgentIdentityAuditHistory(agentId);
      expect(audit.length).toBe(3);
    });

    it('should respect limit', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      for (let i = 0; i < 5; i++) {
        store.createAgentIdentityAudit({
          id: randomUUID(),
          agentId,
          action: 'updated',
        });
      }

      const audit = store.getAgentIdentityAuditHistory(agentId, 3);
      expect(audit.length).toBe(3);
    });

    it('should order by timestamp descending', () => {
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId, agentType: 'coder' });

      store.createAgentIdentityAudit({
        id: randomUUID(),
        agentId,
        action: 'created',
      });
      store.createAgentIdentityAudit({
        id: randomUUID(),
        agentId,
        action: 'activated',
      });

      const audit = store.getAgentIdentityAuditHistory(agentId);

      for (let i = 0; i < audit.length - 1; i++) {
        expect(audit[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          audit[i + 1].timestamp.getTime()
        );
      }
    });

    it('should return empty array for non-existent identity', () => {
      const audit = store.getAgentIdentityAuditHistory('non-existent');
      expect(audit).toEqual([]);
    });
  });

  describe('Memory with agentId', () => {
    it('should store memory with agentId', () => {
      const agentId = randomUUID();
      const entry = store.store('test-key', 'test content', { agentId });

      expect(entry.agentId).toBe(agentId);
    });

    it('should retrieve memory with agentId', () => {
      const agentId = randomUUID();
      store.store('agent-key', 'agent content', { agentId });

      const entry = store.get('agent-key');
      expect(entry?.agentId).toBe(agentId);
    });

    it('should list memory filtered by agentId', () => {
      const agent1 = randomUUID();
      const agent2 = randomUUID();

      store.store('key-1', 'content 1', { agentId: agent1 });
      store.store('key-2', 'content 2', { agentId: agent1 });
      store.store('key-3', 'content 3', { agentId: agent2 });
      store.store('key-4', 'shared content'); // No agentId (shared)

      const agent1Memory = store.list(undefined, 100, 0, { agentId: agent1, includeShared: false });
      expect(agent1Memory.length).toBe(2);

      const agent2Memory = store.list(undefined, 100, 0, { agentId: agent2, includeShared: false });
      expect(agent2Memory.length).toBe(1);
    });

    it('should include shared memory when includeShared is true', () => {
      const agentId = randomUUID();

      store.store('agent-key', 'agent content', { agentId });
      store.store('shared-key', 'shared content'); // No agentId

      const withShared = store.list(undefined, 100, 0, { agentId, includeShared: true });
      expect(withShared.length).toBe(2);

      const withoutShared = store.list(undefined, 100, 0, { agentId, includeShared: false });
      expect(withoutShared.length).toBe(1);
    });

    it('should get entries with embeddings filtered by agentId', () => {
      const agent1 = randomUUID();
      const agent2 = randomUUID();

      const entry1 = store.store('embed-1', 'content', { agentId: agent1 });
      const entry2 = store.store('embed-2', 'content', { agentId: agent2 });
      const entry3 = store.store('embed-3', 'content'); // Shared

      store.storeEmbedding(entry1.id, [0.1, 0.2]);
      store.storeEmbedding(entry2.id, [0.3, 0.4]);
      store.storeEmbedding(entry3.id, [0.5, 0.6]);

      const agent1Embeddings = store.getEntriesWithEmbeddings(undefined, {
        agentId: agent1,
        includeShared: false,
      });
      expect(agent1Embeddings.length).toBe(1);

      const withShared = store.getEntriesWithEmbeddings(undefined, {
        agentId: agent1,
        includeShared: true,
      });
      expect(withShared.length).toBe(2);
    });
  });

  describe('Active Agents with identityId', () => {
    it('should save active agent with identityId', () => {
      const identityId = randomUUID();
      store.createAgentIdentity({ agentId: identityId, agentType: 'coder' });

      store.saveActiveAgent({
        id: randomUUID(),
        type: 'coder',
        name: 'test-agent',
        status: 'idle',
        createdAt: new Date(),
        identityId,
      });

      const agents = store.loadActiveAgents();
      expect(agents.length).toBe(1);
      expect(agents[0].identityId).toBe(identityId);
    });

    it('should save active agent without identityId', () => {
      store.saveActiveAgent({
        id: randomUUID(),
        type: 'coder',
        name: 'ephemeral-agent',
        status: 'idle',
        createdAt: new Date(),
      });

      const agents = store.loadActiveAgents();
      expect(agents.length).toBe(1);
      expect(agents[0].identityId).toBeUndefined();
    });

    it('should load agents with identityId', () => {
      const identityId = randomUUID();
      const agentId = randomUUID();
      store.createAgentIdentity({ agentId: identityId, agentType: 'coder' });

      store.saveActiveAgent({
        id: agentId,
        type: 'coder',
        name: 'identity-agent',
        status: 'idle',
        createdAt: new Date(),
        identityId,
      });

      const agents = store.loadActiveAgents();
      const agent = agents.find(a => a.id === agentId);
      expect(agent?.identityId).toBe(identityId);
    });
  });
});
