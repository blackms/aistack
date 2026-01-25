/**
 * Web module - HTTP + WebSocket server for AgentStack
 */

export {
  WebServer,
  startWebServer,
  stopWebServer,
  getWebServer,
  defaultWebConfig,
} from './server.js';

export { Router, sendJson, sendError, sendPaginated } from './router.js';

export {
  agentEvents,
  getEventBridge,
  resetEventBridge,
  handleWebSocketUpgrade,
  getClientCount,
  broadcastMessage,
  closeAllConnections,
} from './websocket/index.js';

export * from './types.js';
