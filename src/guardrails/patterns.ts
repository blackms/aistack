/**
 * Pattern library for built-in guardrails.
 *
 * Every regex/source documents:
 *   - WHAT it catches
 *   - WHERE it came from (vendor doc / OWASP / public blog)
 *   - last review date — so we can bump them on cadence
 *
 * Patterns are intentionally *narrow* (favor precision over recall) so the
 * regex layer can act as a cheap first line. Recall is delegated to the
 * heavier adversarial loop. See `docs/GUARDRAILS.md` for the trade-offs.
 *
 * REVIEW CADENCE: re-check vendor docs every quarter.
 * Last review: 2026-05.
 *
 * CONCURRENCY NOTE:
 *   RegExp objects with the `/g` flag carry mutable `lastIndex` state
 *   between calls. When two parallel invocations (e.g. the guardrail
 *   runner racing inputs) share the same instance via `.exec()` / `.test()`,
 *   one can clobber the other's iteration cursor and produce silent
 *   false-negatives. To stay safe under concurrency:
 *     - Treat every exported regex literal here as a *template*.
 *     - Consumers MUST clone via `cloneRegex(...)` before using `.exec`
 *       (or use a non-stateful API like `String.prototype.matchAll()`).
 */

/**
 * Clone a regex into a fresh instance with independent `lastIndex`.
 * Use this in any code path that may run concurrently with other
 * consumers of the same exported pattern.
 */
export function cloneRegex(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}

// ---------------------------------------------------------------------------
// SECRETS
// ---------------------------------------------------------------------------

/**
 * Canonical secret prefixes published by vendors.
 *
 * Sources:
 *   - AWS:    https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html
 *   - GitHub: https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/
 *   - OpenAI: https://platform.openai.com/docs/api-reference (sk- prefix)
 *   - Slack:  https://api.slack.com/authentication/token-types
 *   - Google: https://cloud.google.com/iam/docs/keys-list-get (AIza...)
 *   - Stripe: https://docs.stripe.com/keys
 */
export const SECRET_PATTERNS: ReadonlyArray<{
  name: string;
  regex: RegExp;
  source: string;
}> = [
  {
    name: 'aws-access-key-id',
    // AKIA = long-lived IAM, ASIA = STS temp creds, ABIA/ACCA = service roles
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    source: 'AWS IAM identifier reference',
  },
  {
    name: 'github-token',
    // ghp_/gho_/ghu_/ghs_/ghr_ — 36 chars base62
    regex: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g,
    source: 'GitHub blog (2021-04-05)',
  },
  {
    name: 'openai-api-key',
    // sk-... — historically 48 chars, project keys (sk-proj-) are longer.
    // We accept >= 32 chars after the prefix to cover both formats.
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
    source: 'OpenAI platform docs',
  },
  {
    name: 'anthropic-api-key',
    // sk-ant-... — see Anthropic console
    regex: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g,
    source: 'Anthropic console',
  },
  {
    name: 'slack-token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    source: 'Slack auth docs',
  },
  {
    name: 'google-api-key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    source: 'Google Cloud docs',
  },
  {
    name: 'stripe-secret-key',
    regex: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{24,}\b/g,
    source: 'Stripe docs',
  },
  {
    name: 'private-key-pem',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    source: 'OpenSSL / OpenSSH conventions',
  },
];

/**
 * Generic high-entropy detector. Used as a *last* resort because it has
 * the highest false-positive rate. Length >= 40 is the commonly cited
 * sweet spot for catching opaque tokens without flagging hex hashes.
 */
export const HIGH_ENTROPY_TOKEN = /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g;

// ---------------------------------------------------------------------------
// PII
// ---------------------------------------------------------------------------

/**
 * PII patterns. We intentionally limit to formats with low false-positive
 * rates AND a structural checksum where available (LUHN for credit cards,
 * checksum-style validation can be added per-locale by custom guardrails).
 *
 * Sources:
 *   - Email: RFC 5322 simplified production
 *   - US SSN: SSA format AAA-GG-SSSS, excludes well-known invalid ranges
 *   - IT Codice Fiscale: 16-char alphanumeric per Agenzia delle Entrate spec
 *   - IPv4: standard dotted quad with byte bounds
 */
/**
 * Email — tightened to reduce false-positives on transactional / machine
 * addresses such as `cron-job+id@svc-01.internal.k8s` style identifiers:
 *   - local-part must start AND end with an alphanumeric (rejects leading
 *     `.`/`+`/`-` artifacts often produced by log scrubbers)
 *   - domain labels cannot start or end with `-`
 *   - TLD limited to 2-24 ASCII letters (covers every IANA TLD as of 2026
 *     while rejecting trailing UUID hex chunks like `…@host.0a1b2c3d`)
 *   - host label limited to 63 chars (RFC 1035) — prevents catastrophic
 *     backtracking on pathological inputs.
 *
 * Callers can whitelist legitimate addresses via the consumer guardrail's
 * `allowDomains` option (see `piiGuardrail`).
 */
export const EMAIL_PATTERN =
  /\b[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,4}[A-Za-z]{2,24}\b/g;

/**
 * US SSN — excludes ranges the SSA never issues (000, 666, 9xx for area;
 * 00 for group; 0000 for serial). Hyphens optional but flagged.
 */
export const US_SSN_PATTERN =
  /\b(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g;

/**
 * Italian Codice Fiscale: 6 letters + 2 digits + letter + 2 digits +
 * letter + 3 alphanumerics + 1 letter. Doesn't validate checksum (delegate
 * that to a domain-specific guardrail if needed).
 */
export const IT_CODICE_FISCALE_PATTERN =
  /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z][0-9A-Z]{3}[A-Z]\b/g;

/**
 * Credit card *candidate* — 13 to 19 digits, optionally separated by
 * spaces or hyphens. Caller MUST run LUHN to confirm; the regex alone is
 * far too noisy.
 */
export const CREDIT_CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;

/**
 * IPv4 dotted quad with byte bounds. Opt-in (IP is debatable PII).
 */
export const IPV4_PATTERN =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

/**
 * LUHN checksum validator for credit card candidates.
 * Returns true if the supplied digits pass LUHN.
 */
export function luhnCheck(input: string): boolean {
  const digits = input.replace(/[\s-]/g, '');
  if (digits.length < 13 || digits.length > 19 || !/^\d+$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// PROMPT INJECTION
// ---------------------------------------------------------------------------

/**
 * Prompt-injection / jailbreak patterns. As of 2026 these are TRIVIALLY
 * bypassable by rephrasing — they exist as a *first* layer only. The
 * adversarial loop (AIG-641) provides semantic detection.
 *
 * Sources:
 *   - OWASP LLM Top 10 (LLM01: Prompt Injection)
 *   - ClawGuard pattern set (open-source regex scanner)
 *   - OpenRouter prompt-injection guardrail patterns
 *   - Public DAN / jailbreak forum corpora
 */
export const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{
  name: string;
  regex: RegExp;
  severity: 'low' | 'high';
}> = [
  {
    name: 'ignore-previous-instructions',
    regex:
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?|messages?)\b/i,
    severity: 'high',
  },
  {
    name: 'dan-jailbreak',
    // "you are now DAN", "act as DAN", "pretend to be DAN" and variants
    regex:
      /\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as)\s+(?:DAN|STAN|DUDE|jailbroken|unrestricted|developer\s+mode)\b/i,
    severity: 'high',
  },
  {
    name: 'system-role-spoofing',
    // attempts to fake a system-role turn in plaintext input
    regex: /(?:^|\n)\s*(?:system|assistant)\s*:\s*(?:you\s+are|new\s+instructions?|override)/i,
    severity: 'high',
  },
  {
    name: 'xml-tag-spoofing',
    // attempts to smuggle fake structural tags from data
    regex: /<\s*\/?\s*(?:system|instructions?|admin|policy|guardrail)\s*>/i,
    severity: 'high',
  },
  {
    name: 'developer-mode',
    regex: /\b(?:enable|activate|turn\s+on)\s+(?:developer|debug|god|admin|sudo)\s+mode\b/i,
    severity: 'high',
  },
  {
    name: 'reveal-system-prompt',
    regex:
      /\b(?:reveal|show|print|repeat|output|leak)\s+(?:the\s+|your\s+)?(?:system\s+prompt|hidden\s+instructions?|initial\s+prompt|preamble)\b/i,
    severity: 'high',
  },
  {
    name: 'base64-payload-marker',
    // Heuristic: text explicitly asking to decode base64 instructions
    regex: /\b(?:decode|run|execute)\s+(?:this\s+)?(?:base64|b64|hex)\b/i,
    severity: 'low',
  },
];
