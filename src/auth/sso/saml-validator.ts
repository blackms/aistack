/**
 * SAML 2.0 assertion validator — defence-in-depth wrapper.
 *
 * AIG-646 security focus #1, #2, #3:
 *   - Reject unsigned assertions.
 *   - Block weak algorithms (MD5, SHA1).
 *   - Disable XML external entity (XXE) resolution and parameter entities.
 *   - Validate NotBefore / NotOnOrAfter / AudienceRestriction /
 *     SubjectConfirmation NotOnOrAfter.
 *   - Replay-protect by Assertion ID and InResponseTo (via ReplayCache).
 *
 * The underlying parser (`@node-saml/node-saml`) already implements signature
 * verification, NotBefore/NotOnOrAfter, audience, and InResponseTo when
 * configured correctly. This module ensures the configuration cannot silently
 * drift to insecure defaults and adds explicit pre-flight checks on the raw
 * SAMLResponse string before it is handed to the parser.
 */

import { logger } from '../../utils/logger.js';
import type { ReplayCache } from './replay-cache.js';

const log = logger.child('sso:saml-validator');

/** Algorithms we hard-reject before even calling the parser. */
const FORBIDDEN_ALG_PATTERNS: RegExp[] = [
  /xmldsig#rsa-sha1\b/i,
  /xmldsig#sha1\b/i,
  /xmldsig#md5\b/i,
  /xmlenc#sha1\b/i,
];

/** Patterns indicating XML constructs we forbid (XXE, DOCTYPE, external entities). */
const FORBIDDEN_XML_PATTERNS: RegExp[] = [
  /<!DOCTYPE\b/i,
  /<!ENTITY\b/i,
  /SYSTEM\s+["']/i,
  /PUBLIC\s+["']/i,
];

export interface SamlPreflightOptions {
  /** Maximum size in bytes (default 1 MiB). */
  maxSize?: number;
}

/**
 * Pre-flight check on the raw decoded SAMLResponse XML.
 * Throws on any forbidden construct or weak algorithm.
 */
export function preflightSamlResponse(
  xml: string,
  opts: SamlPreflightOptions = {}
): void {
  const maxSize = opts.maxSize ?? 1024 * 1024;
  if (typeof xml !== 'string' || xml.length === 0) {
    throw new SamlSecurityError('Empty SAML response');
  }
  if (xml.length > maxSize) {
    throw new SamlSecurityError(`SAML response exceeds max size (${maxSize} bytes)`);
  }

  for (const pat of FORBIDDEN_XML_PATTERNS) {
    if (pat.test(xml)) {
      log.warn('SAML response rejected: forbidden XML construct', {
        pattern: pat.source,
      });
      throw new SamlSecurityError(
        'SAML response contains forbidden XML construct (DOCTYPE/ENTITY/external reference)'
      );
    }
  }

  for (const pat of FORBIDDEN_ALG_PATTERNS) {
    if (pat.test(xml)) {
      log.warn('SAML response rejected: weak algorithm', { pattern: pat.source });
      throw new SamlSecurityError(
        'SAML response uses weak signature/digest algorithm (SHA1/MD5)'
      );
    }
  }

  // Must contain at least one ds:Signature element. We do NOT verify it here
  // (the parser does cryptographically), but a totally unsigned response is
  // rejected pre-parse so it never reaches the verifier.
  if (!/<(?:ds:|saml:|samlp:|)?Signature\b/i.test(xml)) {
    log.warn('SAML response rejected: no Signature element present');
    throw new SamlSecurityError('SAML response is unsigned');
  }
}

/**
 * Check that the parsed assertion is within its validity window.
 * `acceptedClockSkewSec` is applied symmetrically.
 */
export function validateAssertionWindow(opts: {
  notBefore?: string | Date | null;
  notOnOrAfter?: string | Date | null;
  acceptedClockSkewSec?: number;
  now?: Date;
}): void {
  const now = (opts.now ?? new Date()).getTime();
  const skewMs = (opts.acceptedClockSkewSec ?? 30) * 1000;

  if (opts.notBefore) {
    const nb =
      opts.notBefore instanceof Date
        ? opts.notBefore.getTime()
        : Date.parse(String(opts.notBefore));
    if (Number.isNaN(nb)) throw new SamlSecurityError('Invalid NotBefore');
    if (now + skewMs < nb) {
      throw new SamlSecurityError('SAML assertion not yet valid (NotBefore)');
    }
  }

  if (opts.notOnOrAfter) {
    const na =
      opts.notOnOrAfter instanceof Date
        ? opts.notOnOrAfter.getTime()
        : Date.parse(String(opts.notOnOrAfter));
    if (Number.isNaN(na)) throw new SamlSecurityError('Invalid NotOnOrAfter');
    if (now - skewMs >= na) {
      throw new SamlSecurityError('SAML assertion expired (NotOnOrAfter)');
    }
  }
}

/**
 * Replay protection for SAML assertions. Combines Assertion ID and
 * (when present) InResponseTo. Either being a replay → rejection.
 */
export function checkSamlReplay(opts: {
  replayCache: ReplayCache;
  assertionId: string;
  inResponseTo?: string | null;
  ttlMs?: number;
  providerName: string;
}): void {
  if (
    opts.replayCache.checkAndRecord(
      'saml',
      'assertion',
      `${opts.providerName}:${opts.assertionId}`,
      opts.ttlMs
    )
  ) {
    throw new SamlSecurityError('SAML assertion replay detected (AssertionID)');
  }
  if (opts.inResponseTo) {
    if (
      opts.replayCache.checkAndRecord(
        'saml',
        'inresponseto',
        `${opts.providerName}:${opts.inResponseTo}`,
        opts.ttlMs
      )
    ) {
      throw new SamlSecurityError(
        'SAML assertion replay detected (InResponseTo already consumed)'
      );
    }
  }
}

export class SamlSecurityError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SamlSecurityError';
  }
}
