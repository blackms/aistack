/**
 * Middleware tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCorsMiddleware } from '../../../src/web/middleware/cors.js';
import { createAuthMiddleware, getApiKey } from '../../../src/web/middleware/auth.js';
import {
  ApiError,
  handleError,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  conflict,
  serverError,
} from '../../../src/web/middleware/error.js';
import type { WebConfig } from '../../../src/web/types.js';

// Mock response object
function createMockResponse() {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    headersSent: false,
  } as unknown as ServerResponse;
  return res;
}

// Mock request object
function createMockRequest(headers: Record<string, string> = {}, method = 'GET'): IncomingMessage {
  return {
    method,
    headers,
  } as unknown as IncomingMessage;
}

describe('CORS Middleware', () => {
  const defaultConfig: WebConfig = {
    enabled: true,
    port: 3001,
    host: 'localhost',
    cors: {
      origins: ['http://localhost:5173', 'http://localhost:3000'],
    },
  };

  it('should set CORS headers for allowed origins', () => {
    const middleware = createCorsMiddleware(defaultConfig);
    const req = createMockRequest({ origin: 'http://localhost:5173' });
    const res = createMockResponse();

    middleware(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', expect.any(String));
  });

  it('should handle wildcard origins', () => {
    const config: WebConfig = {
      ...defaultConfig,
      cors: { origins: ['*'] },
    };
    const middleware = createCorsMiddleware(config);
    const req = createMockRequest({ origin: 'http://example.com' });
    const res = createMockResponse();

    middleware(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://example.com');
  });

  it('should handle OPTIONS preflight requests', () => {
    const middleware = createCorsMiddleware(defaultConfig);
    const req = createMockRequest({ origin: 'http://localhost:5173' }, 'OPTIONS');
    const res = createMockResponse();

    const result = middleware(req, res);

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('should not handle non-OPTIONS requests', () => {
    const middleware = createCorsMiddleware(defaultConfig);
    const req = createMockRequest({ origin: 'http://localhost:5173' }, 'GET');
    const res = createMockResponse();

    const result = middleware(req, res);

    expect(result).toBe(false);
  });

  it('should set credentials header', () => {
    const middleware = createCorsMiddleware(defaultConfig);
    const req = createMockRequest({ origin: 'http://localhost:5173' });
    const res = createMockResponse();

    middleware(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
  });

  it('should set max age header', () => {
    const middleware = createCorsMiddleware(defaultConfig);
    const req = createMockRequest({ origin: 'http://localhost:5173' });
    const res = createMockResponse();

    middleware(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Max-Age', '86400');
  });
});

describe('Auth Middleware', () => {
  describe('createAuthMiddleware', () => {
    it('should return authenticated context', () => {
      const middleware = createAuthMiddleware();
      const req = createMockRequest();
      const res = createMockResponse();

      const context = middleware(req, res);

      expect(context.authenticated).toBe(true);
    });

    it('should work with required option', () => {
      const middleware = createAuthMiddleware({ required: true });
      const req = createMockRequest();
      const res = createMockResponse();

      const context = middleware(req, res);

      expect(context.authenticated).toBe(true);
    });
  });

  describe('getApiKey', () => {
    it('should extract Bearer token from Authorization header', () => {
      const req = createMockRequest({ authorization: 'Bearer my-api-key' });

      const apiKey = getApiKey(req);

      expect(apiKey).toBe('my-api-key');
    });

    it('should extract API key from X-Api-Key header', () => {
      const req = createMockRequest({ 'x-api-key': 'my-api-key' });

      const apiKey = getApiKey(req);

      expect(apiKey).toBe('my-api-key');
    });

    it('should return null when no API key is present', () => {
      const req = createMockRequest();

      const apiKey = getApiKey(req);

      expect(apiKey).toBeNull();
    });

    it('should prefer Bearer token over X-Api-Key', () => {
      const req = createMockRequest({
        authorization: 'Bearer bearer-key',
        'x-api-key': 'header-key',
      });

      const apiKey = getApiKey(req);

      expect(apiKey).toBe('bearer-key');
    });

    it('should return null for non-Bearer Authorization', () => {
      const req = createMockRequest({ authorization: 'Basic abc123' });

      const apiKey = getApiKey(req);

      expect(apiKey).toBeNull();
    });
  });
});

describe('Error Middleware', () => {
  describe('ApiError', () => {
    it('should create error with status code', () => {
      const error = new ApiError(404, 'Not found');

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Not found');
      expect(error.name).toBe('ApiError');
    });
  });

  describe('handleError', () => {
    it('should handle ApiError with correct status code', () => {
      const res = createMockResponse();
      const error = new ApiError(400, 'Bad request');

      handleError(res, error);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.error).toBe('Bad request');
    });

    it('should handle generic Error with 500 status', () => {
      const res = createMockResponse();
      const error = new Error('Something went wrong');

      handleError(res, error);

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
    });

    it('should handle non-Error objects', () => {
      const res = createMockResponse();

      handleError(res, 'string error');

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.error).toBe('Internal server error');
    });

    it('should not write if headers already sent', () => {
      const res = createMockResponse();
      res.headersSent = true;
      const error = new Error('Test');

      handleError(res, error);

      expect(res.writeHead).not.toHaveBeenCalled();
    });
  });

  describe('Error factory functions', () => {
    it('notFound should create 404 error', () => {
      const error = notFound('Resource');
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Resource not found');
    });

    it('badRequest should create 400 error', () => {
      const error = badRequest('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid input');
    });

    it('unauthorized should create 401 error', () => {
      const error = unauthorized();
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Unauthorized');
    });

    it('unauthorized should accept custom message', () => {
      const error = unauthorized('Token expired');
      expect(error.message).toBe('Token expired');
    });

    it('forbidden should create 403 error', () => {
      const error = forbidden();
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Forbidden');
    });

    it('conflict should create 409 error', () => {
      const error = conflict('Resource already exists');
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Resource already exists');
    });

    it('serverError should create 500 error', () => {
      const error = serverError();
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Internal server error');
    });
  });
});
