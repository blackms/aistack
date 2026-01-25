/**
 * WebSocket handler
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { getEventBridge, type EventName } from './event-bridge.js';
import type { WSClientInfo, WSMessage } from '../types.js';

const log = logger.child('web:websocket');

// WebSocket client connections
const clients: Map<string, {
  socket: Duplex;
  info: WSClientInfo;
  unsubscribe: () => void;
}> = new Map();

/**
 * Handle WebSocket upgrade request
 */
export function handleWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  // Verify WebSocket upgrade request
  const upgradeHeader = req.headers.upgrade?.toLowerCase();
  if (upgradeHeader !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  // Get WebSocket key
  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  // Calculate accept key
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const acceptKey = createHash('sha1')
    .update(wsKey + GUID)
    .digest('base64');

  // Send upgrade response
  const response = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    '',
  ].join('\r\n');

  socket.write(response);

  // Create client info
  const clientId = randomUUID();
  const clientInfo: WSClientInfo = {
    id: clientId,
    connectedAt: new Date(),
    subscriptions: new Set(['*']), // Subscribe to all by default
  };

  // Subscribe to events
  const eventBridge = getEventBridge();
  const unsubscribe = eventBridge.subscribe((event, data) => {
    sendMessage(socket, {
      type: event,
      payload: data,
      timestamp: new Date().toISOString(),
    });
  });

  // Store client
  clients.set(clientId, { socket, info: clientInfo, unsubscribe });

  log.info('WebSocket client connected', { clientId });

  // Handle incoming data
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Try to parse frames
    while (buffer.length >= 2) {
      const frame = parseWebSocketFrame(buffer);
      if (!frame) break;

      buffer = buffer.subarray(frame.totalLength);

      // Handle frame
      if (frame.opcode === 0x8) {
        // Close frame
        log.info('WebSocket client disconnected (close frame)', { clientId });
        cleanupClient(clientId);
        return;
      }

      if (frame.opcode === 0x9) {
        // Ping - send pong
        const pongFrame = createWebSocketFrame(0xa, frame.payload);
        socket.write(pongFrame);
        continue;
      }

      if (frame.opcode === 0xa) {
        // Pong - ignore
        continue;
      }

      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        // Text or binary frame
        handleClientMessage(clientId, frame.payload.toString('utf-8'));
      }
    }
  });

  socket.on('close', () => {
    log.info('WebSocket client disconnected (socket close)', { clientId });
    cleanupClient(clientId);
  });

  socket.on('error', (error) => {
    log.error('WebSocket error', { clientId, error: error.message });
    cleanupClient(clientId);
  });

  // Send welcome message
  sendMessage(socket, {
    type: 'connected',
    payload: { clientId },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Parse WebSocket frame
 */
function parseWebSocketFrame(buffer: Buffer): {
  opcode: number;
  payload: Buffer;
  totalLength: number;
} | null {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0]!;
  const secondByte = buffer[1]!;

  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;

  let offset = 2;

  // Extended payload length
  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    // For simplicity, we'll only handle 32-bit lengths
    payloadLength = buffer.readUInt32BE(6);
    offset = 10;
  }

  // Masking key
  let maskingKey: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskingKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  // Payload
  if (buffer.length < offset + payloadLength) return null;

  let payload = buffer.subarray(offset, offset + payloadLength);

  // Unmask if needed
  if (maskingKey) {
    const unmasked = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      unmasked[i] = payload[i]! ^ maskingKey[i % 4]!;
    }
    payload = unmasked;
  }

  return {
    opcode,
    payload,
    totalLength: offset + payloadLength,
  };
}

/**
 * Create WebSocket frame
 */
function createWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const payloadLength = payload.length;
  let header: Buffer;

  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN + opcode
    header[1] = payloadLength;
  } else if (payloadLength < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payloadLength, 6);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Send message to WebSocket client
 */
function sendMessage(socket: Duplex, message: WSMessage): void {
  try {
    const payload = Buffer.from(JSON.stringify(message), 'utf-8');
    const frame = createWebSocketFrame(0x1, payload); // 0x1 = text frame
    socket.write(frame);
  } catch (error) {
    log.error('Failed to send WebSocket message', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Handle message from client
 */
function handleClientMessage(clientId: string, message: string): void {
  const client = clients.get(clientId);
  if (!client) return;

  try {
    const parsed = JSON.parse(message);

    // Handle subscription changes
    if (parsed.type === 'subscribe') {
      const events = parsed.events as string[];
      if (Array.isArray(events)) {
        for (const event of events) {
          client.info.subscriptions.add(event);
        }
        log.debug('Client subscribed to events', { clientId, events });
      }
    }

    if (parsed.type === 'unsubscribe') {
      const events = parsed.events as string[];
      if (Array.isArray(events)) {
        for (const event of events) {
          client.info.subscriptions.delete(event);
        }
        log.debug('Client unsubscribed from events', { clientId, events });
      }
    }

    // Handle ping
    if (parsed.type === 'ping') {
      sendMessage(client.socket, {
        type: 'pong',
        payload: {},
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    log.warn('Failed to parse client message', { clientId, message });
  }
}

/**
 * Cleanup disconnected client
 */
function cleanupClient(clientId: string): void {
  const client = clients.get(clientId);
  if (client) {
    client.unsubscribe();
    try {
      client.socket.destroy();
    } catch {
      // Ignore errors during cleanup
    }
    clients.delete(clientId);
  }
}

/**
 * Get connected client count
 */
export function getClientCount(): number {
  return clients.size;
}

/**
 * Broadcast message to all clients
 */
export function broadcastMessage(message: WSMessage): void {
  for (const client of clients.values()) {
    sendMessage(client.socket, message);
  }
}

/**
 * Close all connections
 */
export function closeAllConnections(): void {
  for (const clientId of clients.keys()) {
    cleanupClient(clientId);
  }
}
