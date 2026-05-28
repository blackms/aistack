/**
 * Built-in secrets guardrail. Catches accidental leakage of API keys,
 * tokens, and private key blobs in agent input/output.
 */

import type { Guardrail, GuardrailResult } from '../types.js';
import { HIGH_ENTROPY_TOKEN, SECRET_PATTERNS, cloneRegex } from '../patterns.js';

export interface SecretsGuardrailOptions {
  /**
   * Whether to additionally check for high-entropy opaque tokens.
   * Default `false` (high false-positive rate).
   */
  highEntropy?: boolean;
  /** Override the default direction. Default `'both'`. */
  direction?: 'input' | 'output' | 'both';
}

export function secretsGuardrail(opts: SecretsGuardrailOptions = {}): Guardrail {
  return {
    name: 'secrets',
    direction: opts.direction ?? 'both',
    description: 'Detects accidental leakage of API keys & private keys',
    validate(payload): GuardrailResult {
      const text = coerce(payload);
      if (!text) return { pass: true };
      const matches: NonNullable<GuardrailResult['matches']> = [];

      for (const { name, regex } of SECRET_PATTERNS) {
        // Clone per-invocation: the exported pattern is a TEMPLATE — using
        // it directly would let parallel runs clobber each other's
        // `lastIndex` and silently miss matches. See `patterns.ts` header.
        const re = cloneRegex(regex);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          matches.push({ kind: name, sample: redact(m[0]), index: m.index });
          // Cap per-pattern to avoid pathological scans
          if (matches.length >= 50) break;
        }
        if (matches.length >= 50) break;
      }

      if (opts.highEntropy && matches.length === 0) {
        const re = cloneRegex(HIGH_ENTROPY_TOKEN);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          matches.push({
            kind: 'high-entropy-token',
            sample: redact(m[0]),
            index: m.index,
          });
          if (matches.length >= 20) break;
        }
      }

      if (matches.length === 0) return { pass: true };
      return {
        pass: false,
        severity: 'high',
        reason: `${matches.length} potential secret(s) detected: ${[
          ...new Set(matches.map((m) => m.kind)),
        ].join(', ')}`,
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

/** Redact all but the first 4 chars — enough to identify, not leak. */
function redact(s: string): string {
  if (s.length <= 6) return '***';
  return `${s.slice(0, 4)}***[len=${s.length}]`;
}
