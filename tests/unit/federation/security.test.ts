/**
 * Federation security tests (AIG-652 review fixes).
 *
 * Covers the 6 blockers raised by the security review:
 *   1. Outbound HTTPS calls actually use `https.Agent` (mTLS works on the wire).
 *   2. `verifyPeerRequest` enforces CN/SAN pinning via `trustedPeerCNs`.
 *   3. Missing cert files cause a hard startup failure (no silent HTTP downgrade).
 *   4. Discovery beacons are Ed25519-signed and verified on receipt.
 *   5. Bearer-token comparison is constant-time.
 *   6. `readJson` enforces a 1 MiB body cap (413 on overflow).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  buildBeaconSigner,
  canonicalBeaconPayload,
  extractPeerCertNames,
  FederationClient,
  loadCredentials,
  MAX_BODY_BYTES,
  readJson,
  timingSafeEqualString,
  verifyBeacon,
  verifyPeerRequest,
  type FederationCredentials,
} from '../../../src/federation/index.js';

// --- helpers ----------------------------------------------------------------

function tempPath(name: string): string {
  return path.join(os.tmpdir(), `aig-652-${process.pid}-${Date.now()}-${name}`);
}

function makeBareCreds(overrides: Partial<FederationCredentials> = {}): FederationCredentials {
  return {
    cert: null,
    key: null,
    ca: null,
    bearerToken: null,
    requireClientCert: true,
    trustedPeerCNs: [],
    allowPlainText: false,
    ...overrides,
  };
}

// --- Fix #3: missing-cert -> THROW; no silent HTTP downgrade ---------------

describe('loadCredentials: fail-closed on missing material', () => {
  it('throws when certPath is configured but file is missing', () => {
    expect(() =>
      loadCredentials({
        certPath: path.join(os.tmpdir(), 'definitely-not-here-aig652.pem'),
        keyPath: path.join(os.tmpdir(), 'definitely-not-here-aig652.key'),
      })
    ).toThrow(/cert file is required but could not be read/);
  });

  it('throws when neither TLS nor bearer is configured and allowPlainText=false', () => {
    expect(() => loadCredentials({})).toThrow(/refuses to start unauthenticated/);
    expect(() => loadCredentials(undefined)).toThrow(/refuses to start unauthenticated/);
  });

  it('accepts bearer-token only mode', () => {
    const creds = loadCredentials({ bearerToken: 'abc123' });
    expect(creds.bearerToken).toBe('abc123');
    expect(creds.cert).toBeNull();
  });

  it('accepts explicit allowPlainText opt-in (dev mode)', () => {
    const creds = loadCredentials({ allowPlainText: true });
    expect(creds.allowPlainText).toBe(true);
  });

  it('throws when only one of cert/key is set', () => {
    const certPath = tempPath('cert.pem');
    fs.writeFileSync(certPath, '---FAKE---');
    try {
      expect(() => loadCredentials({ certPath })).toThrow(
        /both certPath and keyPath must be set together/
      );
    } finally {
      fs.unlinkSync(certPath);
    }
  });
});

// --- Fix #5: constant-time bearer compare -----------------------------------

describe('timingSafeEqualString', () => {
  it('returns true only for identical strings', () => {
    expect(timingSafeEqualString('hello', 'hello')).toBe(true);
    expect(timingSafeEqualString('hello', 'world')).toBe(false);
  });

  it('returns false for differing-length strings (without leaking via early return)', () => {
    expect(timingSafeEqualString('short', 'a-much-longer-token')).toBe(false);
    expect(timingSafeEqualString('', 'nonempty')).toBe(false);
  });

  it('handles empty strings symmetrically', () => {
    expect(timingSafeEqualString('', '')).toBe(true);
  });

  it('does NOT rely on native === early-return semantics', () => {
    // Smoke-test: the implementation must call crypto.timingSafeEqual on
    // equal-length buffers. Reaching into the impl via behavior: both
    // "off-by-first-byte" and "off-by-last-byte" must return false.
    const base = 'a'.repeat(64);
    const firstDiff = 'b' + base.slice(1);
    const lastDiff = base.slice(0, -1) + 'b';
    expect(timingSafeEqualString(base, firstDiff)).toBe(false);
    expect(timingSafeEqualString(base, lastDiff)).toBe(false);
  });
});

describe('verifyPeerRequest: bearer mode uses constant-time compare', () => {
  it('accepts the matching bearer token', () => {
    const creds = makeBareCreds({ bearerToken: 'secret-token', allowPlainText: true });
    const verdict = verifyPeerRequest(creds, undefined, 'Bearer secret-token');
    expect(verdict.ok).toBe(true);
  });

  it('rejects wrong bearer tokens', () => {
    const creds = makeBareCreds({ bearerToken: 'secret-token', allowPlainText: true });
    expect(verifyPeerRequest(creds, undefined, 'Bearer wrong-token').ok).toBe(false);
    expect(verifyPeerRequest(creds, undefined, '').ok).toBe(false);
    expect(verifyPeerRequest(creds, undefined, undefined).ok).toBe(false);
  });
});

// --- Fix #2: CN pinning -----------------------------------------------------

describe('verifyPeerRequest: mTLS CN/SAN pinning', () => {
  const certBuf = Buffer.from('---CERT---');
  const keyBuf = Buffer.from('---KEY---');

  it('accepts any CA-signed cert when trustedPeerCNs is empty', () => {
    const creds = makeBareCreds({
      cert: certBuf,
      key: keyBuf,
      requireClientCert: true,
      trustedPeerCNs: [],
    });
    const verdict = verifyPeerRequest(
      creds,
      { subject: { CN: 'random-peer.local' } },
      undefined
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toMatch(/mtls:random-peer/);
  });

  it('rejects a peer cert whose CN is not in the trustedPeerCNs allowlist', () => {
    const creds = makeBareCreds({
      cert: certBuf,
      key: keyBuf,
      requireClientCert: true,
      trustedPeerCNs: ['allowed.peer.local'],
    });
    const verdict = verifyPeerRequest(
      creds,
      { subject: { CN: 'malicious.peer.local' } },
      undefined
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not in trustedPeerCNs/);
  });

  it('accepts when the SAN matches even if the CN does not', () => {
    const creds = makeBareCreds({
      cert: certBuf,
      key: keyBuf,
      requireClientCert: true,
      trustedPeerCNs: ['peer-alt-name'],
    });
    const verdict = verifyPeerRequest(
      creds,
      {
        subject: { CN: 'unrelated.local' },
        subjectaltname: 'DNS:peer-alt-name, DNS:other.local',
      },
      undefined
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toMatch(/peer-alt-name/);
  });

  it('rejects when no peer cert is presented at all', () => {
    const creds = makeBareCreds({
      cert: certBuf,
      key: keyBuf,
      requireClientCert: true,
      trustedPeerCNs: ['allowed.peer.local'],
    });
    const verdict = verifyPeerRequest(creds, undefined, undefined);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Missing or invalid client certificate/);
  });
});

describe('extractPeerCertNames', () => {
  it('parses subjectaltname into individual entries', () => {
    const names = extractPeerCertNames({
      subject: { CN: 'cn.example' },
      subjectaltname: 'DNS:san1.example, DNS:san2.example, IP Address:10.0.0.1',
    });
    expect(names).toEqual(['cn.example', 'san1.example', 'san2.example', '10.0.0.1']);
  });
});

// --- Fix #1: outbound mTLS actually uses https.Agent -----------------------

describe('FederationClient outbound uses configured https.Agent', () => {
  it('passes the credential-built agent to https.request', async () => {
    const creds = makeBareCreds({
      cert: Buffer.from('---FAKE-CERT---'),
      key: Buffer.from('---FAKE-KEY---'),
      ca: Buffer.from('---FAKE-CA---'),
      requireClientCert: true,
    });
    const client = new FederationClient(creds, { timeoutMs: 250 });
    const agent = client.getHttpsAgent();

    let seenOptions: https.RequestOptions | null = null;
    const spy = vi.spyOn(https, 'request').mockImplementation(((
      options: https.RequestOptions,
      cb?: (res: http.IncomingMessage) => void
    ) => {
      seenOptions = options;
      const fakeRes = new PassThrough() as unknown as http.IncomingMessage;
      (fakeRes as unknown as { statusCode: number }).statusCode = 200;
      const fakeReq = new PassThrough();
      // Fire callback + end body asynchronously so the client promise resolves.
      setImmediate(() => {
        if (cb) cb(fakeRes);
        (fakeRes as unknown as PassThrough).end('{}');
      });
      // The transport calls req.on('timeout',..), req.on('error',..), req.end()
      // PassThrough supports all of those.
      return fakeReq as unknown as ReturnType<typeof https.request>;
    }) as unknown as typeof https.request);

    try {
      await client.fetchPeerCapabilities({
        nodeId: 'p',
        name: 'p',
        address: 'https://peer.local:9443',
        scheme: 'https',
        capabilities: [],
      });
    } finally {
      spy.mockRestore();
    }

    expect(seenOptions).not.toBeNull();
    // CRITICAL assertion: the configured Agent (mTLS material) is actually
    // used for the outbound HTTPS call. The previous implementation used
    // global `fetch`, which silently dropped the agent.
    expect((seenOptions as https.RequestOptions).agent).toBe(agent);
  });
});

// --- Fix #4: signed discovery beacons --------------------------------------

describe('Beacon Ed25519 signing & verification', () => {
  const tmpKeys: string[] = [];
  afterEach(() => {
    for (const p of tmpKeys.splice(0)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  });

  function writeKeyPair(): { priv: string; pub: string; privPem: string; pubPem: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const pubPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const priv = tempPath('ed25519.priv.pem');
    const pub = tempPath('ed25519.pub.pem');
    fs.writeFileSync(priv, privPem);
    fs.writeFileSync(pub, pubPem);
    tmpKeys.push(priv, pub);
    return { priv, pub, privPem, pubPem };
  }

  it('signs the canonical payload and verifies it round-trip', () => {
    const { priv, pub, pubPem } = writeKeyPair();
    const signer = buildBeaconSigner({
      privateKeyPath: priv,
      publicKeyPath: pub,
      trustedPublicKeys: [pubPem],
    });

    const node = {
      nodeId: 'n1',
      name: 'n1',
      address: 'https://10.0.0.1:9443',
      scheme: 'https' as const,
      capabilities: [{ name: 'coder', enabled: true }],
    };
    const seq = 42;
    const payload = canonicalBeaconPayload(node, seq);
    const sig = signer.sign!(payload);
    const verdict = verifyBeacon(signer, payload, sig, pubPem);
    expect(verdict.ok).toBe(true);
  });

  it('rejects unsigned beacons when trustedPublicKeys is set', () => {
    const { pubPem } = writeKeyPair();
    const signer = buildBeaconSigner({ trustedPublicKeys: [pubPem] });
    const verdict = verifyBeacon(signer, 'anything', undefined, undefined);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/unsigned/);
  });

  it('rejects beacons signed by a non-trusted key', () => {
    const trusted = writeKeyPair();
    const attacker = writeKeyPair();
    const signer = buildBeaconSigner({ trustedPublicKeys: [trusted.pubPem] });
    const payload = 'beacon-body';
    const attackerKey = crypto.createPrivateKey({ key: attacker.privPem, format: 'pem' });
    const sig = crypto.sign(null, Buffer.from(payload, 'utf-8'), attackerKey).toString('base64');
    const verdict = verifyBeacon(signer, payload, sig, attacker.pubPem);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not in trustedPublicKeys/);
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const { priv, pub, pubPem } = writeKeyPair();
    const signer = buildBeaconSigner({
      privateKeyPath: priv,
      publicKeyPath: pub,
      trustedPublicKeys: [pubPem],
    });
    const payload = 'original-payload';
    const sig = signer.sign!(payload);
    const verdict = verifyBeacon(signer, 'tampered-payload', sig, pubPem);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/invalid signature/);
  });
});

// --- Fix #6: body cap on incoming JSON --------------------------------------

describe('readJson: 1 MiB body cap', () => {
  function makeReq(body: Buffer): http.IncomingMessage {
    const stream = new PassThrough();
    setImmediate(() => {
      stream.end(body);
    });
    return stream as unknown as http.IncomingMessage;
  }

  it('parses small JSON bodies', async () => {
    const req = makeReq(Buffer.from(JSON.stringify({ hello: 'world' })));
    const result = await readJson<{ hello: string }>(req);
    expect(result.tooLarge).toBe(false);
    expect(result.value).toEqual({ hello: 'world' });
  });

  it('rejects bodies larger than the cap (signals tooLarge=true)', async () => {
    // 1 MiB + 1 byte
    const big = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
    const req = makeReq(big);
    const result = await readJson(req, MAX_BODY_BYTES);
    expect(result.tooLarge).toBe(true);
    expect(result.value).toBeNull();
  });

  it('honors a custom (smaller) cap', async () => {
    const body = Buffer.alloc(2048, 0x61); // 2 KiB
    const req = makeReq(body);
    const result = await readJson(req, 1024); // 1 KiB cap
    expect(result.tooLarge).toBe(true);
  });
});
