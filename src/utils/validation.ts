/**
 * Input validation utilities using Zod
 */

import { z } from 'zod';
import type { AgentType } from '../types.js';

// Agent type validation
export const VALID_AGENT_TYPES: AgentType[] = [
  'coder',
  'researcher',
  'tester',
  'reviewer',
  'architect',
  'coordinator',
  'analyst',
];

export const AgentTypeSchema = z.enum([
  'coder',
  'researcher',
  'tester',
  'reviewer',
  'architect',
  'coordinator',
  'analyst',
]);

// Extended agent type (core + custom)
export const ExtendedAgentTypeSchema = z.string().min(1).max(50);

// Common schemas
export const IdSchema = z.string().uuid();
export const NameSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const NamespaceSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const KeySchema = z.string().min(1).max(500);
export const ContentSchema = z.string().min(1).max(1_000_000); // 1MB max

// Memory schemas
export const MemoryStoreInputSchema = z.object({
  key: KeySchema,
  content: ContentSchema,
  namespace: NamespaceSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  generateEmbedding: z.boolean().optional(),
});

export const MemorySearchInputSchema = z.object({
  query: z.string().min(1).max(1000),
  namespace: NamespaceSchema.optional(),
  limit: z.number().min(1).max(100).optional(),
  threshold: z.number().min(0).max(1).optional(),
  useVector: z.boolean().optional(),
});

export const MemoryGetInputSchema = z.object({
  key: KeySchema,
  namespace: NamespaceSchema.optional(),
});

export const MemoryDeleteInputSchema = z.object({
  key: KeySchema,
  namespace: NamespaceSchema.optional(),
});

export const MemoryListInputSchema = z.object({
  namespace: NamespaceSchema.optional(),
  limit: z.number().min(1).max(1000).optional(),
  offset: z.number().min(0).optional(),
});

// Agent schemas
export const AgentSpawnInputSchema = z.object({
  type: ExtendedAgentTypeSchema,
  name: NameSchema.optional(),
  sessionId: IdSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const AgentStopInputSchema = z.object({
  id: IdSchema.optional(),
  name: NameSchema.optional(),
}).refine(data => data.id !== undefined || data.name !== undefined, {
  message: 'Either id or name must be provided',
});

export const AgentStatusInputSchema = z.object({
  id: IdSchema.optional(),
  name: NameSchema.optional(),
});

// Task schemas
export const TaskCreateInputSchema = z.object({
  agentType: ExtendedAgentTypeSchema,
  input: z.string().optional(),
  sessionId: IdSchema.optional(),
});

export const TaskAssignInputSchema = z.object({
  taskId: IdSchema,
  agentId: IdSchema,
});

export const TaskCompleteInputSchema = z.object({
  taskId: IdSchema,
  output: z.string().optional(),
  status: z.enum(['completed', 'failed']).optional(),
});

// Session schemas
export const SessionStartInputSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
});

export const SessionEndInputSchema = z.object({
  sessionId: IdSchema,
});

// GitHub schemas
export const GitHubIssueCreateInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1).max(256),
  body: z.string().max(65536).optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
});

export const GitHubIssueListInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).optional(),
  limit: z.number().min(1).max(100).optional(),
});

export const GitHubPRCreateInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1).max(256),
  body: z.string().max(65536).optional(),
  head: z.string().min(1),
  base: z.string().min(1),
  draft: z.boolean().optional(),
});

export const GitHubPRListInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).optional(),
  limit: z.number().min(1).max(100).optional(),
});

// Validation helper
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}

// Type guards
export function isValidAgentType(type: string): type is AgentType {
  return VALID_AGENT_TYPES.includes(type as AgentType);
}
