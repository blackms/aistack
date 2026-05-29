/**
 * Agent card generator — translates aistack agent registry into an A2A
 * agent card document served at /.well-known/a2a-agent-card.json.
 */

import { listAgentDefinitions } from '../agents/registry.js';
import {
  A2A_PROTOCOL_VERSION,
  AgentCardSchema,
  type AgentCard,
  type A2ASkill,
} from './types.js';

export interface AgentCardOptions {
  /** Public URL where the A2A endpoint is reachable, e.g. https://host:8787 */
  url: string;
  /** Human-readable name of this agent fleet (default: "aistack") */
  name?: string;
  description?: string;
  version?: string;
  /** Restrict exposed skills to this allowlist of agent types. Empty = all. */
  exposedAgents?: string[];
  /** Authentication schemes to advertise. Default: bearer. */
  authSchemes?: Array<'bearer' | 'mtls' | 'none'>;
  provider?: {
    organization: string;
    url?: string;
  };
}

/**
 * Build an A2A agent card from current registry contents.
 *
 * Each registered aistack agent type becomes one A2A skill so that remote
 * callers can target a specific specialist (e.g. `coder`, `researcher`).
 */
export function generateAgentCard(options: AgentCardOptions): AgentCard {
  const allowed = options.exposedAgents && options.exposedAgents.length > 0
    ? new Set(options.exposedAgents)
    : null;

  const skills: A2ASkill[] = listAgentDefinitions()
    .filter((def) => (allowed ? allowed.has(def.type) : true))
    .map((def) => ({
      id: def.type,
      name: def.name,
      description: def.description,
      inputModes: ['text'],
      outputModes: ['text'],
      tags: def.capabilities,
    }));

  const card: AgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: options.name ?? 'aistack',
    description:
      options.description ??
      'aistack multi-agent orchestrator exposed via the A2A protocol for cross-runtime interop.',
    url: options.url.replace(/\/+$/, ''),
    provider: options.provider,
    version: options.version ?? '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    authentication: {
      schemes: options.authSchemes ?? ['bearer'],
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills,
  };

  // Round-trip through Zod to guarantee spec validity at construction time.
  return AgentCardSchema.parse(card);
}
