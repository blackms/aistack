import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReplayCache } from '../../../../src/auth/sso/replay-cache.js';
import {
  preflightSamlResponse,
  SamlSecurityError,
  validateAssertionWindow,
} from '../../../../src/auth/sso/saml-validator.js';
import {
  SamlProvider,
  type SamlLike,
  type SamlProfileRaw,
} from '../../../../src/auth/sso/saml.js';

/**
 * AIG-646 SAML security tests.
 *
 * Covers:
 *   - XXE / DOCTYPE / external entity rejection (SEC #2)
 *   - Weak algorithm rejection: SHA1, MD5 (SEC #1)
 *   - Unsigned response rejection (SEC #1)
 *   - NotBefore / NotOnOrAfter window enforcement (SEC #1)
 *   - Replay rejection on Assertion ID and InResponseTo (SEC #3)
 *   - Missing Assertion ID fails closed (SEC #3)
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  const migration = readFileSync(
    join(process.cwd(), 'migrations', '006_sso_provisioning.sql'),
    'utf-8'
  );
  // Also need a minimal users table because FK references it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );
  `);
  db.exec(migration);
  return db;
}

describe('preflightSamlResponse (SAML pre-parse hardening)', () => {
  it('rejects empty input', () => {
    expect(() => preflightSamlResponse('')).toThrow(SamlSecurityError);
  });

  it('rejects DOCTYPE / XXE attempts', () => {
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <samlp:Response><ds:Signature/></samlp:Response>`;
    expect(() => preflightSamlResponse(xml)).toThrow(/DOCTYPE|ENTITY|external/i);
  });

  it('rejects external ENTITY declarations even without DOCTYPE detection', () => {
    const xml = `<samlp:Response>
      <!ENTITY foo SYSTEM "http://evil/">
      <ds:Signature/>
    </samlp:Response>`;
    expect(() => preflightSamlResponse(xml)).toThrow(SamlSecurityError);
  });

  it('rejects SHA1 signature algorithm', () => {
    const xml =
      '<samlp:Response><ds:Signature><ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/></ds:Signature></samlp:Response>';
    expect(() => preflightSamlResponse(xml)).toThrow(/weak/i);
  });

  it('rejects MD5 digest algorithm', () => {
    const xml =
      '<samlp:Response><ds:Signature><ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#md5"/></ds:Signature></samlp:Response>';
    expect(() => preflightSamlResponse(xml)).toThrow(/weak/i);
  });

  it('rejects unsigned response (no Signature element)', () => {
    const xml = '<samlp:Response><foo>bar</foo></samlp:Response>';
    expect(() => preflightSamlResponse(xml)).toThrow(/unsigned/i);
  });

  it('accepts a minimally-signed response with SHA256', () => {
    const xml =
      '<samlp:Response><ds:Signature><ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha256"/></ds:Signature></samlp:Response>';
    expect(() => preflightSamlResponse(xml)).not.toThrow();
  });

  it('rejects responses exceeding size limit', () => {
    const big = 'a'.repeat(2 * 1024 * 1024);
    expect(() => preflightSamlResponse(big, { maxSize: 1024 })).toThrow(/size/);
  });
});

describe('validateAssertionWindow', () => {
  it('rejects assertion not yet valid (NotBefore in future)', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(() =>
      validateAssertionWindow({ notBefore: future, acceptedClockSkewSec: 1 })
    ).toThrow(/NotBefore/);
  });

  it('rejects expired assertion (NotOnOrAfter in past)', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(() =>
      validateAssertionWindow({ notOnOrAfter: past, acceptedClockSkewSec: 1 })
    ).toThrow(/expired/);
  });

  it('accepts assertion inside window', () => {
    const nb = new Date(Date.now() - 60_000).toISOString();
    const na = new Date(Date.now() + 60_000).toISOString();
    expect(() =>
      validateAssertionWindow({ notBefore: nb, notOnOrAfter: na })
    ).not.toThrow();
  });
});

describe('SamlProvider with stub factory', () => {
  let db: Database.Database;
  let cache: ReplayCache;

  beforeEach(() => {
    db = makeDb();
    cache = new ReplayCache(db);
  });

  afterEach(() => {
    cache.stop();
    db.close();
  });

  function makeProvider(profileOut: SamlProfileRaw | null) {
    const fake: SamlLike = {
      getAuthorizeUrlAsync: async () => 'https://idp.example/sso?SAMLRequest=xyz',
      validatePostResponseAsync: async () => ({
        profile: profileOut,
        loggedOut: false,
      }),
      getLogoutUrlAsync: async () => 'https://idp.example/slo',
    };
    return new SamlProvider(
      {
        providerName: 'test-idp',
        entityId: 'aistack',
        idpSsoUrl: 'https://idp.example/sso',
        idpCert: '-----BEGIN CERT-----stub-----END CERT-----',
        callbackUrl: 'https://app.example/acs',
      },
      cache,
      () => fake
    );
  }

  function signedXml(extra: string = ''): string {
    return (
      '<samlp:Response><ds:Signature><ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha256"/></ds:Signature>' +
      extra +
      '</samlp:Response>'
    );
  }

  it('returns IdP URL for getAuthURL', async () => {
    const provider = makeProvider(null);
    const url = await provider.getAuthURL('rs');
    expect(url).toContain('https://idp.example/sso');
  });

  it('rejects ACS with missing SAMLResponse', async () => {
    const provider = makeProvider(null);
    await expect(provider.handleACS('')).rejects.toThrow(/Missing SAMLResponse/);
  });

  it('rejects ACS when assertion has no ID (replay safety)', async () => {
    const provider = makeProvider({
      nameID: 'a@b.com',
      attributes: { email: 'a@b.com' },
      // no ID
    });
    const xml = signedXml();
    const b64 = Buffer.from(xml).toString('base64');
    await expect(provider.handleACS(b64)).rejects.toThrow(/replay protection/i);
  });

  it('rejects replayed assertion (same Assertion ID seen twice)', async () => {
    const provider = makeProvider({
      ID: 'assertion-1',
      nameID: 'a@b.com',
      attributes: { email: 'a@b.com' },
      notBefore: new Date(Date.now() - 60_000).toISOString(),
      notOnOrAfter: new Date(Date.now() + 60_000).toISOString(),
    });
    const xml = signedXml();
    const b64 = Buffer.from(xml).toString('base64');

    const profile = await provider.handleACS(b64);
    expect(profile.email).toBe('a@b.com');

    await expect(provider.handleACS(b64)).rejects.toThrow(/replay/i);
  });

  it('rejects ACS when XML pre-flight fails (XXE)', async () => {
    const provider = makeProvider({
      ID: 'assertion-2',
      nameID: 'a@b.com',
    });
    const xml = '<!DOCTYPE x [<!ENTITY foo SYSTEM "file:///etc/passwd">]><samlp:Response><ds:Signature/></samlp:Response>';
    const b64 = Buffer.from(xml).toString('base64');
    await expect(provider.handleACS(b64)).rejects.toThrow(SamlSecurityError);
  });

  it('extracts groups from attribute named via groupAttributeName', async () => {
    const fake: SamlLike = {
      getAuthorizeUrlAsync: async () => '',
      validatePostResponseAsync: async () => ({
        profile: {
          ID: 'a3',
          nameID: 'a@b.com',
          attributes: {
            email: 'a@b.com',
            'http://schemas.xmlsoap.org/claims/Group': ['admins', 'devs'],
          },
          notBefore: new Date(Date.now() - 1000).toISOString(),
          notOnOrAfter: new Date(Date.now() + 60_000).toISOString(),
        },
        loggedOut: false,
      }),
      getLogoutUrlAsync: async () => '',
    };
    const provider = new SamlProvider(
      {
        providerName: 'okta',
        entityId: 'aistack',
        idpSsoUrl: 'https://idp/sso',
        idpCert: 'stub',
        callbackUrl: 'https://app/acs',
        groupAttributeName: 'http://schemas.xmlsoap.org/claims/Group',
      },
      cache,
      () => fake
    );
    const b64 = Buffer.from(signedXml()).toString('base64');
    const profile = await provider.handleACS(b64);
    expect(profile.groups).toEqual(['admins', 'devs']);
  });

  it('rejects construction with weak signatureAlgorithm', () => {
    expect(
      () =>
        new SamlProvider(
          {
            providerName: 'x',
            entityId: 'a',
            idpSsoUrl: 'https://idp/sso',
            idpCert: 'c',
            callbackUrl: 'https://a/acs',
            // @ts-expect-error testing invalid value
            signatureAlgorithm: 'sha1',
          },
          cache,
          () => ({}) as SamlLike
        )
    ).toThrow(/Unsupported/);
  });
});
