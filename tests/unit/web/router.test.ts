/**
 * Router tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router, sendJson, sendError, sendPaginated } from '../../../src/web/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Mock response object
function createMockResponse() {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
    headersSent: false,
  } as unknown as ServerResponse;
  return res;
}

// Mock request object
function createMockRequest(method: string, url: string, body?: unknown): IncomingMessage {
  const req = {
    method,
    url,
    headers: {},
    on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
      if (event === 'data' && body) {
        callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === 'end') {
        callback();
      }
      return req;
    }),
  } as unknown as IncomingMessage;
  return req;
}

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  describe('route registration', () => {
    it('should register GET routes', () => {
      const handler = vi.fn();
      router.get('/test', handler);

      const result = router.match('GET', '/test');
      expect(result).not.toBeNull();
      expect(result?.handler).toBe(handler);
    });

    it('should register POST routes', () => {
      const handler = vi.fn();
      router.post('/test', handler);

      const result = router.match('POST', '/test');
      expect(result).not.toBeNull();
    });

    it('should register PUT routes', () => {
      const handler = vi.fn();
      router.put('/test', handler);

      const result = router.match('PUT', '/test');
      expect(result).not.toBeNull();
    });

    it('should register DELETE routes', () => {
      const handler = vi.fn();
      router.delete('/test', handler);

      const result = router.match('DELETE', '/test');
      expect(result).not.toBeNull();
    });

    it('should register PATCH routes', () => {
      const handler = vi.fn();
      router.patch('/test', handler);

      const result = router.match('PATCH', '/test');
      expect(result).not.toBeNull();
    });
  });

  describe('route matching', () => {
    it('should match exact paths', () => {
      const handler = vi.fn();
      router.get('/api/v1/agents', handler);

      const result = router.match('GET', '/api/v1/agents');
      expect(result).not.toBeNull();
    });

    it('should not match different methods', () => {
      const handler = vi.fn();
      router.get('/test', handler);

      const result = router.match('POST', '/test');
      expect(result).toBeNull();
    });

    it('should not match different paths', () => {
      const handler = vi.fn();
      router.get('/test', handler);

      const result = router.match('GET', '/other');
      expect(result).toBeNull();
    });

    it('should extract path parameters', () => {
      const handler = vi.fn();
      router.get('/api/v1/agents/:id', handler);

      const result = router.match('GET', '/api/v1/agents/123');
      expect(result).not.toBeNull();
      expect(result?.params.path).toEqual(['123']);
    });

    it('should extract multiple path parameters', () => {
      const handler = vi.fn();
      router.get('/api/v1/:resource/:id', handler);

      const result = router.match('GET', '/api/v1/agents/456');
      expect(result).not.toBeNull();
      expect(result?.params.path).toEqual(['agents', '456']);
    });

    it('should parse query parameters', () => {
      const handler = vi.fn();
      router.get('/test', handler);

      const result = router.match('GET', '/test?foo=bar&baz=qux');
      expect(result).not.toBeNull();
      expect(result?.params.query).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('should handle empty query string', () => {
      const handler = vi.fn();
      router.get('/test', handler);

      const result = router.match('GET', '/test');
      expect(result?.params.query).toEqual({});
    });
  });

  describe('request handling', () => {
    it('should handle GET requests', async () => {
      const handler = vi.fn();
      router.get('/test', handler);

      const req = createMockRequest('GET', '/test');
      const res = createMockResponse();

      const handled = await router.handle(req, res);
      expect(handled).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    it('should return false for unmatched routes', async () => {
      const req = createMockRequest('GET', '/unknown');
      const res = createMockResponse();

      const handled = await router.handle(req, res);
      expect(handled).toBe(false);
    });

    it('should parse JSON body for POST requests', async () => {
      const handler = vi.fn();
      router.post('/test', handler);

      const body = { name: 'test', value: 123 };
      const req = createMockRequest('POST', '/test', body);
      const res = createMockResponse();

      await router.handle(req, res);
      expect(handler).toHaveBeenCalled();
      const params = handler.mock.calls[0][2];
      expect(params.body).toEqual(body);
    });

    it('should handle empty body for POST requests', async () => {
      const handler = vi.fn();
      router.post('/test', handler);

      const req = {
        method: 'POST',
        url: '/test',
        headers: {},
        on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
          if (event === 'end') {
            callback();
          }
          return req;
        }),
      } as unknown as IncomingMessage;
      const res = createMockResponse();

      await router.handle(req, res);
      expect(handler).toHaveBeenCalled();
      const params = handler.mock.calls[0][2];
      expect(params.body).toBeUndefined();
    });

    it('should handle handler errors', async () => {
      const handler = vi.fn().mockImplementation(() => {
        throw new Error('Test error');
      });
      router.get('/test', handler);

      const req = createMockRequest('GET', '/test');
      const res = createMockResponse();

      await router.handle(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    });
  });
});

describe('Response helpers', () => {
  describe('sendJson', () => {
    it('should send JSON response with 200 status', () => {
      const res = createMockResponse();
      const data = { message: 'Hello' };

      sendJson(res, data);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalled();
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(data);
      expect(body.timestamp).toBeDefined();
    });

    it('should send JSON response with custom status', () => {
      const res = createMockResponse();
      const data = { id: '123' };

      sendJson(res, data, 201);

      expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
    });

    it('should set success to false for error status codes', () => {
      const res = createMockResponse();

      sendJson(res, null, 400);

      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.success).toBe(false);
    });
  });

  describe('sendError', () => {
    it('should send error response', () => {
      const res = createMockResponse();

      sendError(res, 404, 'Not found');

      expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Not found');
    });
  });

  describe('sendPaginated', () => {
    it('should send paginated response', () => {
      const res = createMockResponse();
      const data = [{ id: 1 }, { id: 2 }];
      const pagination = { limit: 10, offset: 0, total: 100 };

      sendPaginated(res, data, pagination);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(data);
      expect(body.pagination).toEqual(pagination);
    });
  });
});
