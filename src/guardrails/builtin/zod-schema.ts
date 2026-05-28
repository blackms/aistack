/**
 * Built-in zod-schema guardrail factory.
 *
 * Usage:
 *   const g = zodSchemaGuardrail(z.object({ ... }).strict(), { name: 'task-input' });
 *
 * `.strict()` is recommended so extra fields trigger a failure (typical
 * threat model: smuggled fields in agent outputs).
 */

import { z } from 'zod';
import type { Guardrail, GuardrailResult } from '../types.js';

export interface ZodSchemaGuardrailOptions {
  /** Override the default guardrail name. */
  name?: string;
  direction?: 'input' | 'output' | 'both';
  description?: string;
  severity?: 'low' | 'high';
}

export function zodSchemaGuardrail(
  schema: z.ZodTypeAny,
  opts: ZodSchemaGuardrailOptions = {}
): Guardrail {
  return {
    name: opts.name ?? 'zod-schema',
    direction: opts.direction ?? 'output',
    description: opts.description ?? 'Validates payload against a zod schema',
    validate(payload): GuardrailResult {
      const result = schema.safeParse(payload);
      if (result.success) return { pass: true };
      const issues = result.error.issues.slice(0, 10);
      return {
        pass: false,
        severity: opts.severity ?? 'high',
        reason: `schema validation failed: ${issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`,
        matches: issues.map((i) => ({
          kind: 'schema-issue',
          sample: `${i.path.join('.') || '<root>'}: ${i.message}`,
        })),
      };
    },
  };
}
