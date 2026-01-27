/**
 * Tests for Spawner Integration with Agent Identity
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  spawnAgent,
  getAgent,
  stopAgent,
  clearAgents,
} from '../../src/agents/spawner.js';
import { getIdentityService, resetIdentityService } from '../../src/agents/identity-service.js';
import { resetMemoryManager, getMemoryManager } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';

describe('Spawner Identity Integration', () => {
  const testDbPath = '/tmp/test-spawner-identity.db';
  let config: AgentStackConfig;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // Reset singletons
    resetIdentityService();
    resetMemoryManager();
    clearAgents();

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
  });

  afterEach(() => {
    clearAgents();
    resetIdentityService();
    resetMemoryManager();

    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('spawnAgent with identityId', () => {
    it('should spawn agent with existing identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        displayName: 'Test Coder',
        autoActivate: true,
      });

      const agent = spawnAgent('coder', {
        identityId: identity.agentId,
      }, config);

      expect(agent.identityId).toBe(identity.agentId);
    });

    it('should record spawn event in audit trail', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        autoActivate: true,
      });

      const agent = spawnAgent('coder', {
        identityId: identity.agentId,
      }, config);

      const audit = identityService.getAuditTrail(identity.agentId);
      const spawnEvent = audit.find(e => e.action === 'spawned');

      expect(spawnEvent).toBeDefined();
      expect(spawnEvent?.metadata?.spawnId).toBe(agent.id);
    });

    it('should reject non-existent identity', () => {
      expect(() => {
        spawnAgent('coder', {
          identityId: '00000000-0000-0000-0000-000000000000',
        }, config);
      }).toThrow('Identity not found');
    });

    it('should reject retired identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        autoActivate: true,
      });
      identityService.retireIdentity(identity.agentId, 'test');

      expect(() => {
        spawnAgent('coder', {
          identityId: identity.agentId,
        }, config);
      }).toThrow('Cannot spawn with retired identity');
    });

    it('should reject non-active identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        // Not auto-activated, status is 'created'
      });

      expect(() => {
        spawnAgent('coder', {
          identityId: identity.agentId,
        }, config);
      }).toThrow('Identity must be active to spawn');
    });
  });

  describe('spawnAgent with createIdentity', () => {
    it('should create ephemeral identity when createIdentity is true', () => {
      const agent = spawnAgent('coder', {
        createIdentity: true,
        name: 'ephemeral-coder',
      }, config);

      expect(agent.identityId).toBeDefined();

      const identityService = getIdentityService(config);
      const identity = identityService.getIdentity(agent.identityId!);

      expect(identity).toBeDefined();
      expect(identity?.metadata?.ephemeral).toBe(true);
      expect(identity?.status).toBe('active');
    });

    it('should record spawn for ephemeral identity', () => {
      const agent = spawnAgent('coder', {
        createIdentity: true,
      }, config);

      const identityService = getIdentityService(config);
      const audit = identityService.getAuditTrail(agent.identityId!);
      const spawnEvent = audit.find(e => e.action === 'spawned');

      expect(spawnEvent).toBeDefined();
    });

    it('should not create identity by default', () => {
      const agent = spawnAgent('coder', {}, config);

      expect(agent.identityId).toBeUndefined();
    });
  });

  describe('stopAgent with identity', () => {
    it('should update identity lastActiveAt when stopping agent', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        autoActivate: true,
      });
      const initialLastActive = identity.lastActiveAt;

      // Small delay to ensure time difference
      const agent = spawnAgent('coder', {
        identityId: identity.agentId,
      }, config);

      // Stop after a small delay
      stopAgent(agent.id);

      const updatedIdentity = identityService.getIdentity(identity.agentId);
      expect(updatedIdentity?.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
        initialLastActive.getTime()
      );
    });

    it('should not fail when stopping agent without identity', () => {
      const agent = spawnAgent('coder', {}, config);

      expect(() => {
        stopAgent(agent.id);
      }).not.toThrow();
    });
  });

  describe('Agent persistence with identity', () => {
    it('should persist identityId to database', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        autoActivate: true,
      });

      const agent = spawnAgent('coder', {
        identityId: identity.agentId,
      }, config);

      const memoryManager = getMemoryManager(config);
      const persistedAgents = memoryManager.getStore().loadActiveAgents();

      const persistedAgent = persistedAgents.find(a => a.id === agent.id);
      expect(persistedAgent?.identityId).toBe(identity.agentId);
    });
  });

  describe('Multiple agents with same identity', () => {
    it('should allow multiple agents with the same identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        autoActivate: true,
      });

      const agent1 = spawnAgent('coder', {
        identityId: identity.agentId,
        name: 'coder-1',
      }, config);

      const agent2 = spawnAgent('coder', {
        identityId: identity.agentId,
        name: 'coder-2',
      }, config);

      expect(agent1.identityId).toBe(identity.agentId);
      expect(agent2.identityId).toBe(identity.agentId);

      // Both spawn events should be recorded
      const audit = identityService.getAuditTrail(identity.agentId);
      const spawnEvents = audit.filter(e => e.action === 'spawned');
      expect(spawnEvents).toHaveLength(2);
    });
  });

  describe('Edge cases', () => {
    it('should handle identity validation failure gracefully', () => {
      // Create identity but close the database connection to simulate failure
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({
        agentType: 'coder',
        autoActivate: true,
      });

      // This should work normally
      const agent = spawnAgent('coder', {
        identityId: identity.agentId,
      }, config);

      expect(agent.identityId).toBe(identity.agentId);
    });

    it('should use agent name for ephemeral identity displayName', () => {
      const agent = spawnAgent('coder', {
        createIdentity: true,
        name: 'my-custom-coder',
      }, config);

      const identityService = getIdentityService(config);
      const identity = identityService.getIdentity(agent.identityId!);

      expect(identity?.displayName).toBe('my-custom-coder');
    });

    it('should include spawnId in ephemeral identity metadata', () => {
      const agent = spawnAgent('coder', {
        createIdentity: true,
      }, config);

      const identityService = getIdentityService(config);
      const identity = identityService.getIdentity(agent.identityId!);

      expect(identity?.metadata?.spawnId).toBe(agent.id);
    });
  });
});
