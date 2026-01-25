/**
 * WebSocket handler tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  handleWebSocketUpgrade,
  getClientCount,
  closeAllConnections,
  broadcastMessage,
} from '../../../src/web/websocket/handler.js';
import { resetEventBridge } from '../../../src/web/websocket/event-bridge.js';

// Mock socket
class MockSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;

  write(data: Buffer | string): boolean {
    this.written.push(typeof data === 'string' ? Buffer.from(data) : data);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

// Create mock request
function createMockRequest(headers: Record<string, string> = {}): IncomingMessage {
  return {
    url: '/ws',
    headers: {
      upgrade: 'websocket',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      ...headers,
    },
  } as unknown as IncomingMessage;
}

describe('WebSocket Handler', () => {
  beforeEach(() => {
    resetEventBridge();
    closeAllConnections();
  });

  afterEach(() => {
    closeAllConnections();
    resetEventBridge();
  });

  describe('handleWebSocketUpgrade', () => {
    it('should reject non-websocket upgrade', () => {
      const req = createMockRequest({ upgrade: 'http' });
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      expect((socket as unknown as MockSocket).written[0]?.toString()).toContain('400 Bad Request');
      expect((socket as unknown as MockSocket).destroyed).toBe(true);
    });

    it('should reject request without websocket key', () => {
      const req = {
        url: '/ws',
        headers: {
          upgrade: 'websocket',
        },
      } as unknown as IncomingMessage;
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      expect((socket as unknown as MockSocket).written[0]?.toString()).toContain('400 Bad Request');
    });

    it('should accept valid websocket upgrade', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      const response = (socket as unknown as MockSocket).written[0]?.toString() || '';
      expect(response).toContain('101 Switching Protocols');
      expect(response).toContain('Upgrade: websocket');
      expect(response).toContain('Sec-WebSocket-Accept:');
    });

    it('should increment client count', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      const initialCount = getClientCount();
      handleWebSocketUpgrade(req, socket, head);

      expect(getClientCount()).toBe(initialCount + 1);
    });

    it('should send welcome message after connection', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Second write is the welcome message (first is the upgrade response)
      const welcomeFrame = (socket as unknown as MockSocket).written[1];
      expect(welcomeFrame).toBeDefined();
    });

    it('should cleanup on socket close', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);
      const countAfterConnect = getClientCount();

      (socket as unknown as MockSocket).emit('close');

      expect(getClientCount()).toBe(countAfterConnect - 1);
    });

    it('should cleanup on socket error', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);
      const countAfterConnect = getClientCount();

      (socket as unknown as MockSocket).emit('error', new Error('test error'));

      expect(getClientCount()).toBe(countAfterConnect - 1);
    });

    it('should handle close frame from client', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send close frame (opcode 0x8)
      // Frame format: FIN(1) + opcode(4) = 0x88, mask bit + length = 0x00
      const closeFrame = Buffer.from([0x88, 0x00]);
      (socket as unknown as MockSocket).emit('data', closeFrame);

      expect((socket as unknown as MockSocket).destroyed).toBe(true);
    });

    it('should respond to ping with pong', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);
      const writtenBefore = (socket as unknown as MockSocket).written.length;

      // Send ping frame (opcode 0x9) with empty payload
      const pingFrame = Buffer.from([0x89, 0x00]);
      (socket as unknown as MockSocket).emit('data', pingFrame);

      // Should have written a pong response
      expect((socket as unknown as MockSocket).written.length).toBeGreaterThan(writtenBefore);
    });

    it('should handle text frame from client', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send text frame with JSON message (masked)
      const message = JSON.stringify({ type: 'ping' });
      const payload = Buffer.from(message, 'utf-8');
      const maskingKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      // Mask the payload
      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i]! ^ maskingKey[i % 4]!;
      }

      // Build frame: FIN + text opcode, masked + length, masking key, payload
      const frame = Buffer.concat([
        Buffer.from([0x81, 0x80 | payload.length]), // FIN + text, masked + length
        maskingKey,
        maskedPayload,
      ]);

      const writtenBefore = (socket as unknown as MockSocket).written.length;
      (socket as unknown as MockSocket).emit('data', frame);

      // Should have written a pong response to our ping message
      expect((socket as unknown as MockSocket).written.length).toBeGreaterThan(writtenBefore);
    });

    it('should handle subscribe message', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send subscribe message
      const message = JSON.stringify({ type: 'subscribe', events: ['agent:spawned'] });
      const payload = Buffer.from(message, 'utf-8');
      const maskingKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i]! ^ maskingKey[i % 4]!;
      }

      const frame = Buffer.concat([
        Buffer.from([0x81, 0x80 | payload.length]),
        maskingKey,
        maskedPayload,
      ]);

      // Should not throw
      expect(() => (socket as unknown as MockSocket).emit('data', frame)).not.toThrow();
    });

    it('should handle unsubscribe message', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send unsubscribe message
      const message = JSON.stringify({ type: 'unsubscribe', events: ['agent:spawned'] });
      const payload = Buffer.from(message, 'utf-8');
      const maskingKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i]! ^ maskingKey[i % 4]!;
      }

      const frame = Buffer.concat([
        Buffer.from([0x81, 0x80 | payload.length]),
        maskingKey,
        maskedPayload,
      ]);

      expect(() => (socket as unknown as MockSocket).emit('data', frame)).not.toThrow();
    });

    it('should handle invalid JSON in message', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send invalid JSON
      const payload = Buffer.from('not json', 'utf-8');
      const maskingKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i]! ^ maskingKey[i % 4]!;
      }

      const frame = Buffer.concat([
        Buffer.from([0x81, 0x80 | payload.length]),
        maskingKey,
        maskedPayload,
      ]);

      // Should not throw
      expect(() => (socket as unknown as MockSocket).emit('data', frame)).not.toThrow();
    });
  });

  describe('getClientCount', () => {
    it('should return 0 when no clients', () => {
      expect(getClientCount()).toBe(0);
    });

    it('should return correct count with clients', () => {
      const req1 = createMockRequest();
      const socket1 = new MockSocket() as unknown as Duplex;
      const req2 = createMockRequest();
      const socket2 = new MockSocket() as unknown as Duplex;

      handleWebSocketUpgrade(req1, socket1, Buffer.alloc(0));
      handleWebSocketUpgrade(req2, socket2, Buffer.alloc(0));

      expect(getClientCount()).toBe(2);
    });
  });

  describe('closeAllConnections', () => {
    it('should close all client connections', () => {
      const req1 = createMockRequest();
      const socket1 = new MockSocket() as unknown as Duplex;
      const req2 = createMockRequest();
      const socket2 = new MockSocket() as unknown as Duplex;

      handleWebSocketUpgrade(req1, socket1, Buffer.alloc(0));
      handleWebSocketUpgrade(req2, socket2, Buffer.alloc(0));

      closeAllConnections();

      expect(getClientCount()).toBe(0);
    });
  });

  describe('broadcastMessage', () => {
    it('should broadcast to all connected clients', () => {
      const req1 = createMockRequest();
      const socket1 = new MockSocket() as unknown as Duplex;
      const req2 = createMockRequest();
      const socket2 = new MockSocket() as unknown as Duplex;

      handleWebSocketUpgrade(req1, socket1, Buffer.alloc(0));
      handleWebSocketUpgrade(req2, socket2, Buffer.alloc(0));

      const writtenBefore1 = (socket1 as unknown as MockSocket).written.length;
      const writtenBefore2 = (socket2 as unknown as MockSocket).written.length;

      broadcastMessage({
        type: 'test',
        payload: { data: 'test' },
        timestamp: new Date().toISOString(),
      });

      expect((socket1 as unknown as MockSocket).written.length).toBeGreaterThan(writtenBefore1);
      expect((socket2 as unknown as MockSocket).written.length).toBeGreaterThan(writtenBefore2);
    });

    it('should handle no connected clients gracefully', () => {
      expect(() => broadcastMessage({
        type: 'test',
        payload: {},
        timestamp: new Date().toISOString(),
      })).not.toThrow();
    });
  });

  describe('Frame parsing edge cases', () => {
    it('should handle pong frame (opcode 0xa)', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send pong frame (opcode 0xa) with empty payload
      const pongFrame = Buffer.from([0x8a, 0x00]);
      expect(() => (socket as unknown as MockSocket).emit('data', pongFrame)).not.toThrow();
    });

    it('should handle binary frame (opcode 0x2)', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send binary frame with masked payload
      const payload = Buffer.from([0x01, 0x02, 0x03]);
      const maskingKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i]! ^ maskingKey[i % 4]!;
      }

      const frame = Buffer.concat([
        Buffer.from([0x82, 0x80 | payload.length]), // FIN + binary, masked + length
        maskingKey,
        maskedPayload,
      ]);

      expect(() => (socket as unknown as MockSocket).emit('data', frame)).not.toThrow();
    });

    it('should handle extended payload length (126)', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Create payload larger than 125 bytes
      const payload = Buffer.alloc(130).fill(0x41);
      const maskingKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i]! ^ maskingKey[i % 4]!;
      }

      // Frame with 126 length indicator
      const header = Buffer.alloc(4);
      header[0] = 0x81; // FIN + text
      header[1] = 0x80 | 126; // masked + 126 indicator
      header.writeUInt16BE(payload.length, 2);

      const frame = Buffer.concat([header, maskingKey, maskedPayload]);

      expect(() => (socket as unknown as MockSocket).emit('data', frame)).not.toThrow();
    });

    it('should handle incomplete frame gracefully', () => {
      const req = createMockRequest();
      const socket = new MockSocket() as unknown as Duplex;
      const head = Buffer.alloc(0);

      handleWebSocketUpgrade(req, socket, head);

      // Send incomplete frame (only first byte)
      const incompleteFrame = Buffer.from([0x81]);
      expect(() => (socket as unknown as MockSocket).emit('data', incompleteFrame)).not.toThrow();
    });
  });
});
