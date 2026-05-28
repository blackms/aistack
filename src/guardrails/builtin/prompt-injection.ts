/**
 * Built-in prompt-injection guardrail.
 *
 * Layer-1 defense only — see `patterns.ts` and `docs/GUARDRAILS.md` for
 * the rationale. Intended for INPUT direction (user-supplied content
 * arriving at an agent), but can be applied to output as well to catch
 * agents being baited into emitting jailbreak text.
 */

import type { Guardrail, GuardrailResult } from '../types.js';
import { PROMPT_INJECTION_PATTERNS, cloneRegex } from '../patterns.js';

export interface PromptInjectionGuardrailOptions {
  direction?: 'input' | 'output' | 'both';
  /** Additional caller-supplied patterns. */
  extraPatterns?: ReadonlyArray<{
    name: string;
    regex: RegExp;
    severity?: 'low' | 'high';
  }>;
}

export function promptInjectionGuardrail(
  opts: PromptInjectionGuardrailOptions = {}
): Guardrail {
  const patterns = [...PROMPT_INJECTION_PATTERNS, ...(opts.extraPatterns ?? [])];
  return {
    name: 'prompt-injection',
    direction: opts.direction ?? 'input',
    description: 'Detects common prompt-injection / jailbreak patterns',
    validate(payload): GuardrailResult {
      const text = coerce(payload);
      if (!text) return { pass: true };
      const matches: NonNullable<GuardrailResult['matches']> = [];
      let maxSeverity: 'low' | 'high' = 'low';

      for (const p of patterns) {
        // Clone defensively — guards against a future maintainer adding
        // `/g` to one of these patterns and silently introducing a race.
        const m = cloneRegex(p.regex).exec(text);
        if (m) {
          matches.push({ kind: p.name, sample: truncate(m[0]), index: m.index });
          if ((p.severity ?? 'high') === 'high') maxSeverity = 'high';
        }
      }

      if (matches.length === 0) return { pass: true };
      return {
        pass: false,
        severity: maxSeverity,
        reason: `prompt-injection pattern(s) matched: ${matches
          .map((m) => m.kind)
          .join(', ')}`,
        matches,
      };
    },
  };
}

function coerce(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload == null) return '';
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function truncate(s: string, max = 80): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
