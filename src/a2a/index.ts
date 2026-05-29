/**
 * A2A (Agent-to-Agent) protocol — public barrel.
 *
 * See docs/A2A.md for an architectural overview and usage examples.
 */

export {
  A2A_PROTOCOL_VERSION,
  AgentCardSchema,
  A2AMessageSchema,
  A2AResponseSchema,
  A2AErrorSchema,
  textMessage,
  responseText,
  type AgentCard,
  type A2ASkill,
  type A2ACapabilities,
  type A2AAuth,
  type A2AMessage,
  type A2AResponse,
  type A2AError,
} from './types.js';

export { generateAgentCard, type AgentCardOptions } from './agent-card.js';

export {
  registerA2ARoutes,
  handleMessage,
  AGENT_CARD_PATH,
  MESSAGE_PATH,
  type A2AServerConfig,
  type RegisterA2AOptions,
} from './server.js';

export {
  a2aCall,
  fetchAgentCard,
  A2AClientError,
  type A2ACallOptions,
} from './client.js';
