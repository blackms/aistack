/**
 * Server tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import {
  WebServer,
  startWebServer,
  stopWebServer,
  getWebServer,
  defaultWebConfig,
} from '../../../src/web/server.js';
import type { AgentStackConfig } from '../../../src/types.js';

// Helper to wait for server to be ready
async function waitForServer(port: number, maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await makeRequestOnce(port, '/api/v1/system/health');
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// Single HTTP request attempt
function makeRequestOnce(
  port: number,
  path: string,
  options: http.RequestOptions = {}
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path,
      method: options.method || 'GET',
      headers: options.headers,
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 0,
            body: data ? JSON.parse(data) : null,
            headers: res.headers,
          });
        } catch {
          resolve({
            status: res.statusCode || 0,
            body: data,
            headers: res.headers,
          });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (options.method === 'POST' || options.method === 'PUT') {
      req.write(JSON.stringify({}));
    }
    req.end();
  });
}

// Helper to make HTTP request with retry
async function makeRequest(
  port: number,
  path: string,
  options: http.RequestOptions = {},
  retries = 3
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  for (let i = 0; i < retries; i++) {
    try {
      return await makeRequestOnce(port, path, options);
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('All retries failed');
}

// Mock config
const mockConfig: AgentStackConfig = {
  version: '1.0.0',
  memory: {
    path: ':memory:',
    defaultNamespace: 'default',
    vectorSearch: { enabled: false },
  },
  providers: { default: 'anthropic' },
  agents: { maxConcurrent: 5, defaultTimeout: 300 },
  github: { enabled: false },
  plugins: { enabled: false, directory: './plugins' },
  mcp: { transport: 'stdio' },
  hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
};

describe('defaultWebConfig', () => {
  it('should have correct default values', () => {
    expect(defaultWebConfig.enabled).toBe(true);
    expect(defaultWebConfig.port).toBe(3001);
    expect(defaultWebConfig.host).toBe('localhost');
    expect(defaultWebConfig.cors.origins).toContain('http://localhost:5174');
  });
});

describe('WebServer', () => {
  let server: WebServer;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('constructor', () => {
    it('should create server with default config', () => {
      server = new WebServer(mockConfig);
      const status = server.getStatus();

      expect(status.running).toBe(false);
      expect(status.port).toBe(3001);
      expect(status.host).toBe('localhost');
    });

    it('should create server with custom config', () => {
      server = new WebServer(mockConfig, {
        port: 4000,
        host: '0.0.0.0',
      });
      const status = server.getStatus();

      expect(status.port).toBe(4000);
      expect(status.host).toBe('0.0.0.0');
    });
  });

  describe('start', () => {
    it('should start server on specified port', async () => {
      server = new WebServer(mockConfig, { port: 3099 });
      await server.start();

      const status = server.getStatus();
      expect(status.running).toBe(true);
    });
  });

  describe('stop', () => {
    it('should stop running server', async () => {
      server = new WebServer(mockConfig, { port: 3098 });
      await server.start();
      await server.stop();

      const status = server.getStatus();
      expect(status.running).toBe(false);
    });

    it('should handle stopping non-running server', async () => {
      server = new WebServer(mockConfig, { port: 3097 });
      // Should not throw
      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should return server status', async () => {
      server = new WebServer(mockConfig, { port: 3096 });
      await server.start();

      const status = server.getStatus();

      expect(status).toHaveProperty('running', true);
      expect(status).toHaveProperty('host');
      expect(status).toHaveProperty('port');
      expect(status).toHaveProperty('wsClients');
    });
  });
});

describe('Server singleton functions', () => {
  afterEach(async () => {
    await stopWebServer();
  });

  describe('startWebServer', () => {
    it('should start and return server instance', async () => {
      const server = await startWebServer(mockConfig, { port: 3095 });

      expect(server).toBeDefined();
      expect(server.getStatus().running).toBe(true);
    });

    it('should return same instance if already running', async () => {
      const server1 = await startWebServer(mockConfig, { port: 3094 });
      const server2 = await startWebServer(mockConfig, { port: 3094 });

      expect(server1).toBe(server2);
    });
  });

  describe('stopWebServer', () => {
    it('should stop running server', async () => {
      await startWebServer(mockConfig, { port: 3093 });
      await stopWebServer();

      const server = getWebServer();
      expect(server).toBeNull();
    });

    it('should handle stopping when no server running', async () => {
      // Should not throw
      await expect(stopWebServer()).resolves.not.toThrow();
    });
  });

  describe('getWebServer', () => {
    it('should return null when no server running', () => {
      const server = getWebServer();
      expect(server).toBeNull();
    });

    it('should return server instance when running', async () => {
      await startWebServer(mockConfig, { port: 3092 });

      const server = getWebServer();
      expect(server).not.toBeNull();
    });
  });
});

describe('HTTP Requests', () => {
  let server: WebServer;
  const testPort = 3088;

  beforeEach(async () => {
    server = new WebServer(mockConfig, { port: testPort });
    await server.start();
    // Wait for server to be fully ready
    await waitForServer(testPort);
  });

  afterEach(async () => {
    await server.stop();
    // Give time for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  describe('API Routes', () => {
    it('should return API info at /api/v1', async () => {
      const res = await makeRequest(testPort, '/api/v1');

      expect(res.status).toBe(200);
      expect((res.body as { data: { name: string } }).data.name).toBe('AgentStack Web API');
    });

    it('should return system status at /api/v1/system/status', async () => {
      const res = await makeRequest(testPort, '/api/v1/system/status');

      expect(res.status).toBe(200);
      expect((res.body as { success: boolean }).success).toBe(true);
    });

    it('should return health at /api/v1/system/health', async () => {
      const res = await makeRequest(testPort, '/api/v1/system/health');

      expect(res.status).toBe(200);
    });

    it('should return 404 for unknown routes', async () => {
      const res = await makeRequest(testPort, '/api/v1/unknown');

      expect(res.status).toBe(404);
    });
  });

  describe('CORS', () => {
    it('should handle preflight OPTIONS request', async () => {
      const res = await makeRequest(testPort, '/api/v1/agents', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5174',
          'access-control-request-method': 'GET',
        },
      });

      expect(res.status).toBe(204);
    });

    it('should include CORS headers for allowed origin', async () => {
      const res = await makeRequest(testPort, '/api/v1/system/status', {
        headers: {
          origin: 'http://localhost:5174',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    });
  });

  describe('Static files', () => {
    it('should serve static files or return 404', async () => {
      const res = await makeRequest(testPort, '/some-page');

      // Will return 200 if frontend is built, 404 otherwise
      expect([200, 404]).toContain(res.status);
    });

    it('should serve root path or return 404', async () => {
      const res = await makeRequest(testPort, '/');

      // Will return 200 if frontend is built, 404 otherwise
      expect([200, 404]).toContain(res.status);
    });

    it('should not serve static for API routes', async () => {
      const res = await makeRequest(testPort, '/api/v1/unknown-endpoint');

      // API routes should not be served as static
      expect(res.status).toBe(404);
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown API routes', async () => {
      const res = await makeRequest(testPort, '/api/v1/nonexistent');

      expect(res.status).toBe(404);
    });
  });
});
