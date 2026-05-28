/**
 * A2A (Agent-to-Agent) protocol type definitions.
 *
 * Based on the A2A protocol spec v1 (https://a2a-protocol.org) used by
 * CrewAI 1.10, Microsoft Agent Framework 1.0, OpenAI Agents SDK, Mastra,
 * and Letta. We model the subset required for request/response messaging
 * and capability discovery; streaming and cancellation are reserved for
 * a follow-up issue.
 */

import { z } from 'zod';

/**
 * Protocol version implemented by this build. Bump when we extend coverage
 * (e.g. add streaming endpoints).
 */
export const A2A_PROTOCOL_VERSION = '1.0';

/**
 * Agent skill — a discrete capability exposed via the A2A endpoint.
 * Loosely corresponds to a CrewAI "task" or an OpenAI "tool".
 */
export const A2ASkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  inputModes: z.array(z.string()).default(['text']),
  outputModes: z.array(z.string()).default(['text']),
  tags: z.array(z.string()).optional(),
});
export type A2ASkill = z.infer<typeof A2ASkillSchema>;

/**
 * Capability flags — feature subset supported by this agent endpoint.
 */
export const A2ACapabilitiesSchema = z.object({
  streaming: z.boolean().default(false),
  pushNotifications: z.boolean().default(false),
  stateTransitionHistory: z.boolean().default(false),
});
export type A2ACapabilities = z.infer<typeof A2ACapabilitiesSchema>;

/**
 * Authentication scheme advertised on the agent card.
 */
export const A2AAuthSchema = z.object({
  schemes: z.array(z.enum(['bearer', 'mtls', 'none'])).default(['bearer']),
});
export type A2AAuth = z.infer<typeof A2AAuthSchema>;

/**
 * Agent card served at /.well-known/a2a-agent-card.json.
 * Acceptance criterion 1: must be a valid A2A v1 agent card.
 */
export const AgentCardSchema = z.object({
  protocolVersion: z.string().default(A2A_PROTOCOL_VERSION),
  name: z.string().min(1),
  description: z.string(),
  url: z.string().url(),
  provider: z
    .object({
      organization: z.string(),
      url: z.string().url().optional(),
    })
    .optional(),
  version: z.string(),
  capabilities: A2ACapabilitiesSchema,
  authentication: A2AAuthSchema,
  defaultInputModes: z.array(z.string()).default(['text']),
  defaultOutputModes: z.array(z.string()).default(['text']),
  skills: z.array(A2ASkillSchema),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

/**
 * Inbound A2A message accepted at POST /v1/a2a/message.
 *
 * `skillId` selects which exposed agent type / skill should handle the
 * message. If omitted, the server falls back to its default skill (first
 * in the list).
 */
export const A2AMessageSchema = z.object({
  messageId: z.string().min(1),
  skillId: z.string().optional(),
  role: z.enum(['user', 'agent']).default('user'),
  parts: z
    .array(
      z.object({
        kind: z.enum(['text', 'data', 'file']).default('text'),
        text: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        mimeType: z.string().optional(),
      }),
    )
    .min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type A2AMessage = z.infer<typeof A2AMessageSchema>;

/**
 * Successful response envelope returned by the server and parsed by the
 * client. Mirrors the A2A v1 spec "task result" shape (simplified — we do
 * not yet expose task IDs because we execute synchronously).
 */
export const A2AResponseSchema = z.object({
  messageId: z.string(),
  inReplyTo: z.string().optional(),
  role: z.literal('agent').default('agent'),
  status: z.enum(['completed', 'failed', 'pending']),
  parts: z.array(
    z.object({
      kind: z.enum(['text', 'data']),
      text: z.string().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type A2AResponse = z.infer<typeof A2AResponseSchema>;

/**
 * Error envelope. Returned with non-2xx HTTP statuses.
 */
export const A2AErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type A2AError = z.infer<typeof A2AErrorSchema>;

/**
 * Helper — convenience parts factory for plain text messages.
 */
export function textMessage(messageId: string, text: string, skillId?: string): A2AMessage {
  return {
    messageId,
    skillId,
    role: 'user',
    parts: [{ kind: 'text', text }],
  };
}

/**
 * Helper — extract concatenated text from a response.
 */
export function responseText(response: A2AResponse): string {
  return response.parts
    .filter((p) => p.kind === 'text' && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n');
}
