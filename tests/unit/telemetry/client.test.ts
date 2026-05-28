/**
 * Tests for TelemetryClient (AIG-655)
 */

import { describe, it, expect, vi } from 'vitest';
import { TelemetryClient, hashSessionId, createTelemetry } from '../../../src/telemetry/index.js';

function makeFetchMock(status = 204) {
  return vi.fn(async () => new Response(null, { status }));
}

describe('TelemetryClient — opt-in gating', () => {
  it('no-ops recordEvent when disabled (default)', () => {
    const fetchMock = makeFetchMock();
    const client = new TelemetryClient({ enabled: false }, { fetchImpl: fetchMock as unknown as typeof fetch });

    client.recordEvent('agent.spawned', { agentType: 'coder' });

    expect(client.isEnabled()).toBe(false);
    expect(client.bufferSize()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createTelemetry() returns a disabled client when config is undefined', () => {
    const client = createTelemetry(undefined);
    expect(client.isEnabled()).toBe(false);
  });

  it('buffers events when enabled', () => {
    const client = new TelemetryClient({ enabled: true, endpoint: 'https://example.test/v1/events' });
    client.recordEvent('review_loop.completed', { iterations: 2, approved: true });
    expect(client.bufferSize()).toBe(1);
  });
});

describe('TelemetryClient — event shape', () => {
  it('emits aistackVersion, nodeVersion, osFamily, ISO timestamp', () => {
    const client = new TelemetryClient(
      { enabled: true },
      { aistackVersion: '1.5.3', nodeVersion: '20', osFamily: 'linux' },
    );
    client.recordEvent('agent.spawned', { agentType: 'coder' });
    const [event] = client.drainBuffer();

    expect(event.type).toBe('agent.spawned');
    expect(event.aistackVersion).toBe('1.5.3');
    expect(event.nodeVersion).toBe('20');
    expect(event.osFamily).toBe('linux');
    expect(event.payload).toEqual({ agentType: 'coder' });
    expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
    expect(new Date(event.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('does not include sessionId when not provided', () => {
    const client = new TelemetryClient({ enabled: true });
    client.recordEvent('session.started');
    const [event] = client.drainBuffer();
    expect(event.sessionId).toBeUndefined();
  });

  it('drops payload keys whose values are not number|string|boolean', () => {
    const client = new TelemetryClient({ enabled: true });
    client.recordEvent('agent.spawned', {
      agentType: 'coder',
      count: 3,
      flag: true,
      // @ts-expect-error — intentionally invalid for the runtime test
      nested: { not: 'allowed' },
      // @ts-expect-error — intentionally invalid for the runtime test
      arr: [1, 2, 3],
    });
    const [event] = client.drainBuffer();
    expect(event.payload).toEqual({ agentType: 'coder', count: 3, flag: true });
  });

  it('truncates oversized string payload values to 200 chars', () => {
    const client = new TelemetryClient({ enabled: true });
    const big = 'x'.repeat(500);
    client.recordEvent('agent.spawned', { reason: big });
    const [event] = client.drainBuffer();
    expect((event.payload?.reason as string).length).toBe(200);
  });
});

describe('TelemetryClient — anonymization', () => {
  it('hashes session ID by default (SHA-256, 16 hex chars)', () => {
    const client = new TelemetryClient({ enabled: true });
    client.recordEvent('session.started', undefined, 'user-session-abc-123');
    const [event] = client.drainBuffer();

    expect(event.sessionId).toBeDefined();
    expect(event.sessionId).not.toBe('user-session-abc-123');
    expect(event.sessionId).toMatch(/^[0-9a-f]{16}$/);
    expect(event.sessionId).toBe(hashSessionId('user-session-abc-123'));
  });

  it('hashing is stable across calls', () => {
    expect(hashSessionId('abc')).toBe(hashSessionId('abc'));
    expect(hashSessionId('abc')).not.toBe(hashSessionId('abd'));
  });

  it('respects anonymizeSessionId: false (passes through raw ID)', () => {
    const client = new TelemetryClient({ enabled: true, anonymizeSessionId: false });
    client.recordEvent('session.started', undefined, 'raw-session-id');
    const [event] = client.drainBuffer();
    expect(event.sessionId).toBe('raw-session-id');
  });
});

describe('TelemetryClient — flush', () => {
  it('POSTs buffered events to the configured endpoint', async () => {
    const fetchMock = makeFetchMock(204);
    const client = new TelemetryClient(
      { enabled: true, endpoint: 'https://stats.example.test/v1/events' },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );

    client.recordEvent('agent.spawned', { agentType: 'coder' });
    client.recordEvent('agent.completed', { agentType: 'coder' });

    const result = await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://stats.example.test/v1/events');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers).toEqual({ 'content-type': 'application/json' });

    const body = JSON.parse(call[1]?.body as string);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].type).toBe('agent.spawned');

    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
    expect(client.bufferSize()).toBe(0);
  });

  it('counts events as failed when endpoint returns non-2xx', async () => {
    const fetchMock = makeFetchMock(500);
    const client = new TelemetryClient(
      { enabled: true, endpoint: 'https://stats.example.test/v1/events' },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    client.recordEvent('agent.spawned');
    const result = await client.flush();
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('silences network errors and returns failed=N', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new TelemetryClient(
      { enabled: true, endpoint: 'https://stats.example.test/v1/events' },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    client.recordEvent('agent.spawned');
    const result = await client.flush();
    expect(result.failed).toBe(1);
    expect(result.delivered).toBe(0);
  });

  it('drops events when no endpoint is configured', async () => {
    const fetchMock = makeFetchMock();
    const client = new TelemetryClient(
      { enabled: true }, // no endpoint
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    client.recordEvent('agent.spawned');
    const result = await client.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.endpoint).toBeUndefined();
  });

  it('returns zero counts when flushing an empty buffer', async () => {
    const fetchMock = makeFetchMock();
    const client = new TelemetryClient(
      { enabled: true, endpoint: 'https://stats.example.test/v1/events' },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    const result = await client.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('auto-flushes when buffer reaches batchSize', async () => {
    const fetchMock = makeFetchMock(204);
    const client = new TelemetryClient(
      { enabled: true, endpoint: 'https://stats.example.test/v1/events', batchSize: 2 },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    client.recordEvent('agent.spawned');
    client.recordEvent('agent.completed');
    // Auto-flush is fire-and-forget; let microtasks resolve.
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
