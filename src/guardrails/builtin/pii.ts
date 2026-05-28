/**
 * Built-in PII guardrail. Detects emails, US SSN, Italian Codice Fiscale,
 * credit cards (with LUHN validation) and optionally IPv4 addresses.
 */

import type { Guardrail, GuardrailResult } from '../types.js';
import {
  CREDIT_CARD_CANDIDATE,
  EMAIL_PATTERN,
  IPV4_PATTERN,
  IT_CODICE_FISCALE_PATTERN,
  US_SSN_PATTERN,
  luhnCheck,
} from '../patterns.js';

export interface PIIGuardrailOptions {
  /** Detect email addresses. Default `true`. */
  email?: boolean;
  /** Detect US SSN. Default `true`. */
  ssn?: boolean;
  /** Detect Italian Codice Fiscale. Default `true`. */
  codiceFiscale?: boolean;
  /** Detect credit cards (LUHN-validated). Default `true`. */
  creditCard?: boolean;
  /** Detect IPv4 addresses (debatable PII). Default `false`. */
  ipv4?: boolean;
  direction?: 'input' | 'output' | 'both';
  /** Failure severity. Default `'high'`. */
  severity?: 'low' | 'high';
}

export function piiGuardrail(opts: PIIGuardrailOptions = {}): Guardrail {
  const enabled = {
    email: opts.email ?? true,
    ssn: opts.ssn ?? true,
    cf: opts.codiceFiscale ?? true,
    cc: opts.creditCard ?? true,
    ipv4: opts.ipv4 ?? false,
  };

  return {
    name: 'pii',
    direction: opts.direction ?? 'both',
    description: 'Detects PII: emails, SSN, codice fiscale, credit cards, IPv4',
    validate(payload): GuardrailResult {
      const text = coerce(payload);
      if (!text) return { pass: true };
      const matches: NonNullable<GuardrailResult['matches']> = [];

      if (enabled.email) collect(text, EMAIL_PATTERN, 'email', matches);
      if (enabled.ssn) collect(text, US_SSN_PATTERN, 'us-ssn', matches);
      if (enabled.cf)
        collect(text, IT_CODICE_FISCALE_PATTERN, 'it-codice-fiscale', matches);
      if (enabled.cc) {
        CREDIT_CARD_CANDIDATE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CREDIT_CARD_CANDIDATE.exec(text)) !== null) {
          if (luhnCheck(m[0])) {
            matches.push({ kind: 'credit-card', sample: redact(m[0]), index: m.index });
            if (matches.length >= 50) break;
          }
        }
      }
      if (enabled.ipv4) collect(text, IPV4_PATTERN, 'ipv4', matches);

      if (matches.length === 0) return { pass: true };
      return {
        pass: false,
        severity: opts.severity ?? 'high',
        reason: `${matches.length} PII match(es): ${[
          ...new Set(matches.map((m) => m.kind)),
        ].join(', ')}`,
        matches,
      };
    },
  };
}

function collect(
  text: string,
  regex: RegExp,
  kind: string,
  out: NonNullable<GuardrailResult['matches']>
): void {
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    out.push({ kind, sample: redact(m[0]), index: m.index });
    if (out.length >= 50) break;
  }
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

function redact(s: string): string {
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}***${s.slice(-1)}`;
}
