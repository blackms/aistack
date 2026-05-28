/**
 * Security regression tests for the HITL interrupts REST surface (AIG-644).
 *
 * Covers:
 *   - All `/api/v1/interrupts/*` endpoints reject unauthenticated callers
 *     with a 401 (NEVER returning records or accepting resume payloads).
 *   - Requests bearing the shared-secret env token are accepted.
 *
 * Lives under tests/unit/web/routes/ alongside other route-handler tests so
 * the existing vitest unit config picks it up automatically.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Router } from '../../../../src/web/router.js';
import { registerInterruptRoutes } from '../../../../src/web/routes/interrupts.js';
import {
  getInterruptStore,
  resetInterruptStore,
} from '../../../../src/coordination/interrupt.js';
import type { AgentStackConfig } from '../../../../src/types.js';

// Block the auth middleware's dev-mode "allow when service missing" path —
// we want the env-token branch to be the only acceptable credential here.
vi.mock('../../../../src/web/middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/web/middleware/auth.js')>(
    '../../../../src/web/middleware/auth.js'
  );
  return {
    ...actual,
    // Force production-style fail-closed behaviour without an init'd service.
    createAuthMiddleware: () => (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      throw new Error('Authentication required');
    },
  };
});

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown
): IncomingMessage {
  const req: Partial<IncomingMessage> & { _body?: string } = {
    method,
    url,
    headers,
  };
  // Minimal readable-stream shim so router.parseBody resolves.
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  req.on = ((event: string, cb: (...args: unknown[]) => void) => {
    (listeners[event] ||= []).push(cb);
    return req as IncomingMessage;
  }) as IncomingMessage['on'];
  // Schedule data + end on the next tick so the handler can subscribe first.
  setImmediate(() => {
    if (body !== undefined) {
      const buf = Buffer.from(JSON.stringify(body));
      for (const cb of listeners['data'] ?? []) cb(buf);
    }
    for (const cb of listeners['end'] ?? []) cb();
  });
  return req as IncomingMessage;
}

function makeRes(): {
  res: ServerResponse;
  status: () => number;
  body: () => string;
} {
  let status = 0;
  let body = '';
  let headersSent = false;
  const res: Partial<ServerResponse> = {
    writeHead: ((code: number) => {
      status = code;
      headersSent = true;
      return res as ServerResponse;
    }) as ServerResponse['writeHead'],
    end: ((chunk?: string | Buffer) => {
      if (chunk) body += typeof chunk === 'string' ? chunk : chunk.toString();
      return res as ServerResponse;
    }) as ServerResponse['end'],
    get headersSent() {
      return headersSent;
    },
  };
  return {
    res: res as ServerResponse,
    status: () => status,
    body: () => body,
  };
}

const SECRET = 'test-shared-secret-1234';

const STUB_CONFIG = {} as AgentStackConfig;

describe('interrupts REST auth gate', () => {
  let router: Router;

  beforeEach(() => {
    process.env.AISTACK_INTERRUPTS_TOKEN = SECRET;
    resetInterruptStore();
    router = new Router();
    registerInterruptRoutes(router, STUB_CONFIG);
  });

  afterEach(() => {
    delete process.env.AISTACK_INTERRUPTS_TOKEN;
    resetInterruptStore();
  });

  const PROTECTED: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/v1/interrupts' },
    { method: 'GET', path: '/api/v1/interrupts/int_xyz' },
    { method: 'POST', path: '/api/v1/interrupts/int_xyz/claim' },
    { method: 'POST', path: '/api/v1/interrupts/int_xyz/resume', body: { input: 'pwn' } },
    { method: 'POST', path: '/api/v1/interrupts/int_xyz/cancel', body: { reason: 'pwn' } },
  ];

  for (const route of PROTECTED) {
    it(`${route.method} ${route.path} rejects with 401 when no bearer supplied`, async () => {
      const { res, status } = makeRes();
      const req = makeReq(route.method, route.path, {}, route.body);
      await router.handle(req, res);
      expect(status()).toBe(401);
    });

    it(`${route.method} ${route.path} rejects with 401 when bearer is wrong`, async () => {
      const { res, status } = makeRes();
      const req = makeReq(
        route.method,
        route.path,
        { authorization: 'Bearer not-the-right-token' },
        route.body
      );
      await router.handle(req, res);
      expect(status()).toBe(401);
    });
  }

  it('GET /api/v1/interrupts allows requests carrying the env shared secret', async () => {
    // Seed a record so we get a 200 instead of a 404.
    await getInterruptStore().create({
      id: 'int_seed',
      sessionId: 's1',
      prompt: 'p',
      status: 'pending',
      notify: ['console'],
      createdAt: new Date().toISOString(),
    });
    const { res, status } = makeRes();
    const req = makeReq('GET', '/api/v1/interrupts', {
      authorization: `Bearer ${SECRET}`,
    });
    await router.handle(req, res);
    expect(status()).toBe(200);
  });

  it('GET /api/v1/interrupts accepts the secret via x-api-key as well', async () => {
    const { res, status } = makeRes();
    const req = makeReq('GET', '/api/v1/interrupts', { 'x-api-key': SECRET });
    await router.handle(req, res);
    expect(status()).toBe(200);
  });

  it('resume cannot mutate state without auth (verifies record stays pending)', async () => {
    await getInterruptStore().create({
      id: 'int_protected',
      sessionId: 's1',
      prompt: 'p',
      state: { important: true },
      status: 'pending',
      notify: ['console'],
      createdAt: new Date().toISOString(),
    });
    const { res, status } = makeRes();
    const req = makeReq(
      'POST',
      '/api/v1/interrupts/int_protected/resume',
      {},
      { input: 'attacker', stateEdits: [{ path: 'important', value: 'false' }] }
    );
    await router.handle(req, res);
    expect(status()).toBe(401);
    const rec = getInterruptStore().get('int_protected');
    expect(rec?.status).toBe('pending');
    expect(rec?.state).toEqual({ important: true });
  });
});

/**
 * Integration-style coverage for the dev-mode bypass regression: when NO
 * env token AND NO AuthService is initialized we must still 401, even in
 * non-production NODE_ENV. The block above mocks the middleware to force
 * the env-token branch, so it cannot exercise the bypass — this block uses
 * the REAL middleware to prove `requireInterruptsAuth` rejects pre-flight.
 */
describe('interrupts REST auth gate — dev-mode bypass regression', () => {
  let router: Router;
  let restoreEnv: { token: string | undefined; nodeEnv: string | undefined };

  beforeEach(async () => {
    // Reset the module graph so the real middleware (not the mock above) is
    // loaded. We re-import the route registrar so it binds to the real
    // `createAuthMiddleware` / `isAuthServiceInitialized` symbols.
    vi.resetModules();
    vi.doUnmock('../../../../src/web/middleware/auth.js');
    restoreEnv = {
      token: process.env.AISTACK_INTERRUPTS_TOKEN,
      nodeEnv: process.env.NODE_ENV,
    };
    delete process.env.AISTACK_INTERRUPTS_TOKEN;
    // Critical: this is the regression — pre-fix, NODE_ENV !== 'production'
    // + no env token + no auth service caused the middleware's dev-mode
    // "allow" branch to grant access with zero credentials.
    process.env.NODE_ENV = 'development';
    resetInterruptStore();
    const { Router: RealRouter } = await import('../../../../src/web/router.js');
    const { registerInterruptRoutes: realRegister } = await import(
      '../../../../src/web/routes/interrupts.js'
    );
    router = new RealRouter();
    realRegister(router, STUB_CONFIG);
  });

  afterEach(() => {
    if (restoreEnv.token === undefined) delete process.env.AISTACK_INTERRUPTS_TOKEN;
    else process.env.AISTACK_INTERRUPTS_TOKEN = restoreEnv.token;
    if (restoreEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = restoreEnv.nodeEnv;
    resetInterruptStore();
    // Restore the mock for any later describe blocks loaded in the same file.
    vi.resetModules();
  });

  const PROTECTED: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/v1/interrupts' },
    { method: 'POST', path: '/api/v1/interrupts/int_xyz/resume', body: { input: 'pwn' } },
  ];

  for (const route of PROTECTED) {
    it(`${route.method} ${route.path} returns 401 with no token AND no AuthService in dev`, async () => {
      const { res, status } = makeRes();
      const req = makeReq(route.method, route.path, {}, route.body);
      await router.handle(req, res);
      expect(status()).toBe(401);
    });

    it(`${route.method} ${route.path} returns 401 even with a bearer when no AuthService is init`, async () => {
      // A bearer that does not match any env token AND no AuthService should
      // not be silently accepted by the dev-mode fallback.
      const { res, status } = makeRes();
      const req = makeReq(
        route.method,
        route.path,
        { authorization: 'Bearer anything' },
        route.body
      );
      await router.handle(req, res);
      expect(status()).toBe(401);
    });
  }

  it('does not mutate state on resume when auth bypass would have applied', async () => {
    await getInterruptStore().create({
      id: 'int_bypass_target',
      sessionId: 's1',
      prompt: 'p',
      state: { secret: 'untouched' },
      status: 'pending',
      notify: ['console'],
      createdAt: new Date().toISOString(),
    });
    const { res, status } = makeRes();
    const req = makeReq(
      'POST',
      '/api/v1/interrupts/int_bypass_target/resume',
      {},
      { input: 'attacker', stateEdits: [{ path: 'secret', value: 'pwned' }] }
    );
    await router.handle(req, res);
    expect(status()).toBe(401);
    const rec = getInterruptStore().get('int_bypass_target');
    expect(rec?.status).toBe('pending');
    expect(rec?.state).toEqual({ secret: 'untouched' });
  });
});
