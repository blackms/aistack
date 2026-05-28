/**
 * Unit tests for A2ARouter body-size cap.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { A2ARouter, DEFAULT_A2A_MAX_BYTES } from '../../../src/transport/a2a-router.js';

interface RawResponse {
  status: number;
  body: string;
}

function post(
  port: number,
  path: string,
  payload: Buffer | string,
  extraHeaders: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const opts: RequestOptions = {
      host: '127.0.0.1',
      port,
      method: 'POST',
      path,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload).toString(),
        ...extraHeaders,
      },
    };
    const req = httpRequest(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', (err) => {
      // The server destroys the socket on oversize bodies. The kernel may
      // surface this to the client as ECONNRESET *before* it can read the
      // 413 response. Tests cover both outcomes — see resolve below.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNRESET' || code === 'EPIPE') {
        resolve({ status: 0, body: `__SOCKET_${code}__` });
      } else {
        reject(err);
      }
    });
    req.write(payload);
    req.end();
  });
}

describe('A2ARouter body-size cap', () => {
  let router: A2ARouter | null = null;

  afterEach(async () => {
    if (router) {
      await router.stop();
      router = null;
    }
  });

  it('exposes the documented 1 MiB default', () => {
    expect(DEFAULT_A2A_MAX_BYTES).toBe(1024 * 1024);
  });

  it('rejects bodies exceeding maxBytes with 413 (or socket-reset)', async () => {
    router = new A2ARouter({ port: 0, host: '127.0.0.1', maxBytes: 1024 });
    router.registerRoute('POST', '/echo', (req) => ({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { size: req.body.length },
    }));
    const { port } = await router.start();
    const oversized = Buffer.alloc(2048, 0x61); // 2 KiB of 'a'
    const res = await post(port, '/echo', oversized);
    // Either the server returned 413 before the socket close, or the
    // kernel surfaced the reset to the client first. Both are acceptable
    // — what we MUST NOT see is a 200 (handler reached with full body).
    if (res.status === 413) {
      const parsed = JSON.parse(res.body) as { error: string; limit: number };
      expect(parsed.error).toBe('payload_too_large');
      expect(parsed.limit).toBe(1024);
    } else {
      expect(res.body).toMatch(/^__SOCKET_/);
    }
  });

  it('accepts bodies at or below maxBytes', async () => {
    router = new A2ARouter({ port: 0, host: '127.0.0.1', maxBytes: 1024 });
    router.registerRoute('POST', '/echo', (req) => ({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { size: req.body.length },
    }));
    const { port } = await router.start();
    const justRight = Buffer.alloc(512, 0x62);
    const res = await post(port, '/echo', justRight);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { size: number };
    expect(parsed.size).toBe(512);
  });

  it('handler is never invoked on oversize body', async () => {
    let invoked = 0;
    router = new A2ARouter({ port: 0, host: '127.0.0.1', maxBytes: 256 });
    router.registerRoute('POST', '/sink', () => {
      invoked += 1;
      return { status: 200, body: { ok: true } };
    });
    const { port } = await router.start();
    await post(port, '/sink', Buffer.alloc(1024, 0x63));
    // Give the event loop a tick to ensure any late handler invocation
    // would have happened.
    await new Promise((r) => setImmediate(r));
    expect(invoked).toBe(0);
  });
});
