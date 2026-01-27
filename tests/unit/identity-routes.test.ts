/**
 * Tests for Identity REST API Routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerIdentityRoutes } from '../../src/web/routes/identities.js';
import { getIdentityService, resetIdentityService } from '../../src/agents/identity-service.js';
import { resetMemoryManager } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';
import type { Router, RouteParams } from '../../src/web/router.js';
import { unlinkSync, existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

// Mock response helper
function createMockResponse(): { res: ServerResponse; getJson: () => unknown; getStatus: () => number } {
  let statusCode = 200;
  let responseData = '';

  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((data: string) => {
      responseData = data;
    }),
    writeHead: vi.fn((code: number) => {
      statusCode = code;
      (res as { statusCode: number }).statusCode = code;
    }),
  } as unknown as ServerResponse;

  return {
    res,
    getJson: () => {
      try {
        const parsed = JSON.parse(responseData);
        // sendJson wraps data in { success, data, timestamp }
        return parsed.data !== undefined ? parsed.data : parsed;
      } catch {
        return responseData;
      }
    },
    getStatus: () => (res as { statusCode: number }).statusCode,
  };
}

// Router mock to capture handlers
function createMockRouter(): {
  router: Router;
  handlers: Map<string, (req: unknown, res: ServerResponse, params: RouteParams) => void>;
} {
  const handlers = new Map<string, (req: unknown, res: ServerResponse, params: RouteParams) => void>();

  const router: Router = {
    get: vi.fn((path: string, handler) => {
      handlers.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler) => {
      handlers.set(`POST ${path}`, handler);
    }),
    put: vi.fn((path: string, handler) => {
      handlers.set(`PUT ${path}`, handler);
    }),
    patch: vi.fn((path: string, handler) => {
      handlers.set(`PATCH ${path}`, handler);
    }),
    delete: vi.fn((path: string, handler) => {
      handlers.set(`DELETE ${path}`, handler);
    }),
  } as unknown as Router;

  return { router, handlers };
}

describe('Identity REST API Routes', () => {
  const testDbPath = '/tmp/test-identity-routes.db';
  let config: AgentStackConfig;
  let router: Router;
  let handlers: Map<string, (req: unknown, res: ServerResponse, params: RouteParams) => void>;

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
      agents: {
        maxConcurrent: 5,
        defaultTimeout: 300,
      },
      github: {
        enabled: false,
      },
      plugins: {
        enabled: false,
        directory: './plugins',
      },
      mcp: {
        transport: 'stdio',
      },
      hooks: {
        sessionStart: false,
        sessionEnd: false,
        preTask: false,
        postTask: false,
      },
    };

    const mock = createMockRouter();
    router = mock.router;
    handlers = mock.handlers;

    registerIdentityRoutes(router, config);
  });

  afterEach(() => {
    resetIdentityService();
    resetMemoryManager();

    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Route Registration', () => {
    it('should register all identity routes', () => {
      expect(handlers.has('GET /api/v1/identities')).toBe(true);
      expect(handlers.has('POST /api/v1/identities')).toBe(true);
      expect(handlers.has('GET /api/v1/identities/:id')).toBe(true);
      expect(handlers.has('GET /api/v1/identities/name/:name')).toBe(true);
      expect(handlers.has('PATCH /api/v1/identities/:id')).toBe(true);
      expect(handlers.has('POST /api/v1/identities/:id/activate')).toBe(true);
      expect(handlers.has('POST /api/v1/identities/:id/deactivate')).toBe(true);
      expect(handlers.has('POST /api/v1/identities/:id/retire')).toBe(true);
      expect(handlers.has('GET /api/v1/identities/:id/audit')).toBe(true);
    });
  });

  describe('GET /api/v1/identities', () => {
    it('should list all identities', () => {
      const identityService = getIdentityService(config);
      identityService.createIdentity({ agentType: 'coder', autoActivate: true });
      identityService.createIdentity({ agentType: 'researcher', autoActivate: true });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities')!;

      handler({}, res, { path: [], query: {}, body: undefined });

      const json = getJson() as { count: number; identities: unknown[] };
      expect(json.count).toBe(2);
      expect(json.identities).toHaveLength(2);
    });

    it('should filter by status', () => {
      const identityService = getIdentityService(config);
      identityService.createIdentity({ agentType: 'coder', autoActivate: true });
      identityService.createIdentity({ agentType: 'researcher' }); // created status

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities')!;

      handler({}, res, { path: [], query: { status: 'active' }, body: undefined });

      const json = getJson() as { count: number };
      expect(json.count).toBe(1);
    });

    it('should filter by agentType', () => {
      const identityService = getIdentityService(config);
      identityService.createIdentity({ agentType: 'coder', autoActivate: true });
      identityService.createIdentity({ agentType: 'researcher', autoActivate: true });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities')!;

      handler({}, res, { path: [], query: { agentType: 'coder' }, body: undefined });

      const json = getJson() as { count: number };
      expect(json.count).toBe(1);
    });
  });

  describe('POST /api/v1/identities', () => {
    it('should create an identity', () => {
      const { res, getJson } = createMockResponse();
      const handler = handlers.get('POST /api/v1/identities')!;

      handler({}, res, {
        path: [],
        query: {},
        body: { agentType: 'coder', displayName: 'Test Coder' },
      });

      const json = getJson() as { agentId: string; displayName: string };
      expect(json.agentId).toBeDefined();
      expect(json.displayName).toBe('Test Coder');
    });

    it('should throw error if agentType missing', () => {
      const { res } = createMockResponse();
      const handler = handlers.get('POST /api/v1/identities')!;

      expect(() => {
        handler({}, res, { path: [], query: {}, body: {} });
      }).toThrow('Agent type is required');
    });
  });

  describe('GET /api/v1/identities/:id', () => {
    it('should get identity by ID', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({ agentType: 'coder' });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities/:id')!;

      handler({}, res, { path: [identity.agentId], query: {}, body: undefined });

      const json = getJson() as { agentId: string };
      expect(json.agentId).toBe(identity.agentId);
    });

    it('should throw not found for non-existent identity', () => {
      const { res } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities/:id')!;

      expect(() => {
        handler({}, res, {
          path: ['00000000-0000-0000-0000-000000000000'],
          query: {},
          body: undefined,
        });
      }).toThrow();
    });
  });

  describe('GET /api/v1/identities/name/:name', () => {
    it('should get identity by display name', () => {
      const identityService = getIdentityService(config);
      identityService.createIdentity({ agentType: 'coder', displayName: 'MyCoder' });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities/name/:name')!;

      handler({}, res, { path: ['MyCoder'], query: {}, body: undefined });

      const json = getJson() as { displayName: string };
      expect(json.displayName).toBe('MyCoder');
    });

    it('should throw not found for non-existent name', () => {
      const { res } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities/name/:name')!;

      expect(() => {
        handler({}, res, { path: ['NonExistent'], query: {}, body: undefined });
      }).toThrow();
    });
  });

  describe('PATCH /api/v1/identities/:id', () => {
    it('should update identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({ agentType: 'coder' });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('PATCH /api/v1/identities/:id')!;

      handler({}, res, {
        path: [identity.agentId],
        query: {},
        body: { displayName: 'Updated Name' },
      });

      const json = getJson() as { displayName: string };
      expect(json.displayName).toBe('Updated Name');
    });

    it('should throw not found for non-existent identity', () => {
      const { res } = createMockResponse();
      const handler = handlers.get('PATCH /api/v1/identities/:id')!;

      expect(() => {
        handler({}, res, {
          path: ['00000000-0000-0000-0000-000000000000'],
          query: {},
          body: { displayName: 'Test' },
        });
      }).toThrow();
    });
  });

  describe('POST /api/v1/identities/:id/activate', () => {
    it('should activate identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({ agentType: 'coder' });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('POST /api/v1/identities/:id/activate')!;

      handler({}, res, { path: [identity.agentId], query: {}, body: undefined });

      const json = getJson() as { status: string };
      expect(json.status).toBe('active');
    });
  });

  describe('POST /api/v1/identities/:id/deactivate', () => {
    it('should deactivate identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({ agentType: 'coder', autoActivate: true });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('POST /api/v1/identities/:id/deactivate')!;

      handler({}, res, { path: [identity.agentId], query: {}, body: {} });

      const json = getJson() as { status: string };
      expect(json.status).toBe('dormant');
    });
  });

  describe('POST /api/v1/identities/:id/retire', () => {
    it('should retire identity', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({ agentType: 'coder', autoActivate: true });

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('POST /api/v1/identities/:id/retire')!;

      handler({}, res, {
        path: [identity.agentId],
        query: {},
        body: { reason: 'End of life' },
      });

      const json = getJson() as { status: string; retirementReason: string };
      expect(json.status).toBe('retired');
      expect(json.retirementReason).toBe('End of life');
    });
  });

  describe('GET /api/v1/identities/:id/audit', () => {
    it('should get audit trail', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({ agentType: 'coder' });
      identityService.activateIdentity(identity.agentId);

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities/:id/audit')!;

      handler({}, res, { path: [identity.agentId], query: {}, body: undefined });

      const json = getJson() as { agentId: string; count: number; entries: unknown[] };
      expect(json.agentId).toBe(identity.agentId);
      expect(json.count).toBeGreaterThanOrEqual(2);
      expect(json.entries.length).toBeGreaterThanOrEqual(2);
    });

    it('should support limit parameter', () => {
      const identityService = getIdentityService(config);
      const identity = identityService.createIdentity({ agentType: 'coder' });
      identityService.activateIdentity(identity.agentId);
      identityService.deactivateIdentity(identity.agentId);

      const { res, getJson } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities/:id/audit')!;

      handler({}, res, { path: [identity.agentId], query: { limit: '2' }, body: undefined });

      const json = getJson() as { count: number; entries: unknown[] };
      // Count should be 2 since we limited to 2 entries (created + activated)
      expect(json.count).toBe(2);
      expect(json.entries).toHaveLength(2);
    });

    it('should throw not found for non-existent identity', () => {
      const { res } = createMockResponse();
      const handler = handlers.get('GET /api/v1/identities/:id/audit')!;

      expect(() => {
        handler({}, res, {
          path: ['00000000-0000-0000-0000-000000000000'],
          query: {},
          body: undefined,
        });
      }).toThrow();
    });
  });
});
