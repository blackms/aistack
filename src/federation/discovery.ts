/**
 * Discovery layer for federation peers.
 *
 * Two strategies are provided out of the box:
 *
 *   - MdnsDiscovery       Bonjour / multicast DNS on the local network.
 *                         Uses the optional `bonjour-service` package; when the
 *                         package is not installed the discovery is a no-op and
 *                         emits a warning. This keeps the dependency optional.
 *   - RegistryDiscovery   Central HTTP registry that exposes a list of nodes.
 *
 * A simple 'static' discovery (just the configured peers list) is provided by
 * `StaticDiscovery` and is used as bootstrap for the other strategies.
 *
 * Beacon signing (AIG-652 review fix #4):
 *   Discovery beacons are unauthenticated on the wire (mDNS especially is
 *   trivially spoofable on a LAN). We layer Ed25519 signatures on top: each
 *   beacon carries `sig` + `pub`, peers verify on receive, unsigned/unknown
 *   beacons are dropped when the local node has a `trustedPublicKeys`
 *   allowlist configured.
 *
 * All discoveries share the `Discovery` interface so they can be swapped at
 * runtime without touching the routing / transport layers.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { logger } from '../utils/logger.js';
import type {
  DiscoveryMethod,
  FederationConfig,
  FederationDiscoverySigningConfig,
  NodeInfo,
} from './types.js';

const log = logger.child('federation:discovery');

const DEFAULT_MDNS_SERVICE_TYPE = '_aistack._tcp.local';

/**
 * Listener invoked when the set of known peers changes.
 */
export type PeerListener = (peers: NodeInfo[]) => void;

/**
 * Materialized signer state. `signer` is null when no private key is
 * configured (we still verify incoming beacons against `trustedPublicKeys`).
 */
export interface BeaconSigner {
  /** PEM-encoded Ed25519 public key (also embedded in outgoing beacons). */
  publicKeyPem: string | null;
  /** Private key wrapper used to sign outgoing beacons. */
  sign: ((payload: string) => string) | null;
  /** Allowlist of peer public keys (PEM, normalized). When empty, verification is best-effort. */
  trustedPublicKeys: Set<string>;
  /** True if at least one peer key is pinned (verification becomes mandatory). */
  enforceTrust: boolean;
}

/**
 * Build the BeaconSigner from FederationDiscoverySigningConfig.
 * Throws on misconfiguration (e.g. unreadable key file).
 */
export function buildBeaconSigner(
  cfg: FederationDiscoverySigningConfig | undefined
): BeaconSigner {
  const signer: BeaconSigner = {
    publicKeyPem: null,
    sign: null,
    trustedPublicKeys: new Set(),
    enforceTrust: false,
  };

  if (cfg?.publicKeyPath) {
    try {
      signer.publicKeyPem = normalizePem(fs.readFileSync(cfg.publicKeyPath, 'utf-8'));
    } catch (err) {
      throw new Error(
        `Federation discovery publicKeyPath could not be read at "${cfg.publicKeyPath}": ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  if (cfg?.privateKeyPath) {
    let pem: string;
    try {
      pem = fs.readFileSync(cfg.privateKeyPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `Federation discovery privateKeyPath could not be read at "${cfg.privateKeyPath}": ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
    const keyObj = crypto.createPrivateKey({ key: pem, format: 'pem' });
    if (keyObj.asymmetricKeyType !== 'ed25519') {
      throw new Error(
        `Federation discovery privateKey must be Ed25519 (got ${keyObj.asymmetricKeyType}).`
      );
    }
    signer.sign = (payload: string): string => {
      const sigBuf = crypto.sign(null, Buffer.from(payload, 'utf-8'), keyObj);
      return sigBuf.toString('base64');
    };
  }

  if (Array.isArray(cfg?.trustedPublicKeys)) {
    for (const pem of cfg!.trustedPublicKeys!) {
      signer.trustedPublicKeys.add(normalizePem(pem));
    }
    signer.enforceTrust = signer.trustedPublicKeys.size > 0;
  }

  if (!signer.sign && !signer.enforceTrust) {
    log.warn(
      'Federation discovery beacons are UNSIGNED. Configure ' +
        'federation.discoverySigning to enable Ed25519 beacon signing.'
    );
  }

  return signer;
}

/**
 * Verify a beacon signature using the embedded `pub` key. Also enforces
 * that the embedded key is in the local trust allowlist when one is set.
 *
 * Returns `true` when the beacon is acceptable, `false` otherwise.
 */
export function verifyBeacon(
  signer: BeaconSigner,
  payload: string,
  signatureB64: string | undefined,
  publicKeyPem: string | undefined
): { ok: boolean; reason: string } {
  if (!signatureB64 || !publicKeyPem) {
    if (signer.enforceTrust) {
      return { ok: false, reason: 'beacon is unsigned' };
    }
    // Best-effort mode: accept unsigned beacons but tag them.
    return { ok: true, reason: 'unsigned (best-effort mode)' };
  }
  const pem = normalizePem(publicKeyPem);
  if (signer.enforceTrust && !signer.trustedPublicKeys.has(pem)) {
    return { ok: false, reason: 'beacon signer not in trustedPublicKeys' };
  }
  try {
    const keyObj = crypto.createPublicKey({ key: pem, format: 'pem' });
    if (keyObj.asymmetricKeyType !== 'ed25519') {
      return { ok: false, reason: 'beacon public key is not Ed25519' };
    }
    const ok = crypto.verify(
      null,
      Buffer.from(payload, 'utf-8'),
      keyObj,
      Buffer.from(signatureB64, 'base64')
    );
    return ok ? { ok: true, reason: 'verified' } : { ok: false, reason: 'invalid signature' };
  } catch (err) {
    return {
      ok: false,
      reason: `beacon verify error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Canonical JSON payload representing the signed portion of a beacon. We
 * intentionally include nodeId, address, scheme, capabilities + a sequence
 * number ("seq") so an attacker cannot replay an old capability list while
 * the node changes its real capabilities.
 */
export function canonicalBeaconPayload(node: NodeInfo, seq: number): string {
  // Stable key order; whitespace-free; capabilities reduced to names.
  return JSON.stringify({
    nodeId: node.nodeId,
    name: node.name,
    address: node.address,
    scheme: node.scheme,
    capabilities: (node.capabilities || []).map((c) => c.name).sort(),
    version: node.version ?? '',
    seq,
  });
}

function normalizePem(pem: string): string {
  return pem.replace(/\r\n/g, '\n').trim();
}

/**
 * Common shape for all discovery implementations.
 */
export interface Discovery {
  /** Strategy name (matches FederationConfig.discoveryMethod). */
  readonly method: DiscoveryMethod;
  /** Start advertising (if `advertise` is true) and start watching for peers. */
  start(self: NodeInfo, advertise: boolean): Promise<void>;
  /** Stop discovery and release resources. */
  stop(): Promise<void>;
  /** Currently known peers (excluding `self`). */
  peers(): NodeInfo[];
  /** Subscribe to peer-set changes. Returns an unsubscribe handle. */
  onChange(listener: PeerListener): () => void;
}

/**
 * Internal helper - manages listener list + dedup.
 */
abstract class BaseDiscovery implements Discovery {
  abstract readonly method: DiscoveryMethod;
  protected knownPeers = new Map<string, NodeInfo>();
  private listeners = new Set<PeerListener>();
  protected selfId: string | null = null;
  protected signer: BeaconSigner;

  constructor(signer: BeaconSigner) {
    this.signer = signer;
  }

  abstract start(self: NodeInfo, advertise: boolean): Promise<void>;
  abstract stop(): Promise<void>;

  peers(): NodeInfo[] {
    return Array.from(this.knownPeers.values());
  }

  onChange(listener: PeerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected upsertPeer(peer: NodeInfo): void {
    if (this.selfId && peer.nodeId === this.selfId) {
      return; // never include self
    }
    const existing = this.knownPeers.get(peer.nodeId);
    const merged: NodeInfo = existing ? { ...existing, ...peer } : peer;
    this.knownPeers.set(peer.nodeId, merged);
    this.notify();
  }

  protected removePeer(nodeId: string): void {
    if (this.knownPeers.delete(nodeId)) {
      this.notify();
    }
  }

  protected notify(): void {
    const snapshot = this.peers();
    for (const l of this.listeners) {
      try {
        l(snapshot);
      } catch (err) {
        log.warn('Peer listener threw', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

/**
 * StaticDiscovery just exposes a fixed list of peers from configuration.
 *
 * Useful for tests, air-gapped deployments, and as a bootstrap for the other
 * strategies (the static peers are merged in by the FederationManager).
 *
 * Static peers are configured locally and are NOT subject to beacon
 * verification (the operator already trusted them by hard-coding them).
 */
export class StaticDiscovery extends BaseDiscovery {
  readonly method: DiscoveryMethod = 'static';
  private readonly staticPeers: NodeInfo[];

  constructor(staticPeers: NodeInfo[], signer: BeaconSigner = noopSigner()) {
    super(signer);
    this.staticPeers = staticPeers;
  }

  async start(self: NodeInfo): Promise<void> {
    this.selfId = self.nodeId;
    for (const p of this.staticPeers) {
      this.upsertPeer(p);
    }
    log.info('Static discovery started', { peers: this.staticPeers.length });
  }

  async stop(): Promise<void> {
    this.knownPeers.clear();
  }
}

/**
 * MdnsDiscovery uses Bonjour / multicast DNS on the local network.
 *
 * The `bonjour-service` package is loaded dynamically so that aistack works
 * without it. If the package is missing, discovery degrades to a no-op and
 * a warning is logged once.
 *
 * Each advertised TXT record carries `sig` (base64 Ed25519 signature) and
 * `pub` (base64-or-PEM Ed25519 public key). Incoming services without a
 * valid signature are dropped when the local node enforces signing.
 */
export class MdnsDiscovery extends BaseDiscovery {
  readonly method: DiscoveryMethod = 'mdns';
  private readonly serviceType: string;
  private bonjour: unknown = null;
  private service: unknown = null;
  private browser: unknown = null;
  private static warnedMissing = false;

  constructor(serviceType: string = DEFAULT_MDNS_SERVICE_TYPE, signer: BeaconSigner = noopSigner()) {
    super(signer);
    this.serviceType = serviceType;
  }

  async start(self: NodeInfo, advertise: boolean): Promise<void> {
    this.selfId = self.nodeId;
    const lib = await this.tryLoadBonjour();
    if (!lib) return;

    type BonjourCtor = new () => {
      publish(opts: Record<string, unknown>): unknown;
      find(opts: Record<string, unknown>, cb: (svc: Record<string, unknown>) => void): unknown;
      destroy(): void;
    };
    const Ctor = lib as BonjourCtor;
    const instance = new Ctor();
    this.bonjour = instance;

    if (advertise) {
      // Parse host:port from self.address
      const url = parseAddress(self.address);
      const seq = Date.now();
      const payload = canonicalBeaconPayload(self, seq);
      const sig = this.signer.sign ? this.signer.sign(payload) : '';
      const pubB64 = this.signer.publicKeyPem
        ? Buffer.from(this.signer.publicKeyPem, 'utf-8').toString('base64')
        : '';
      this.service = instance.publish({
        name: self.name,
        type: this.serviceType.replace(/^_/, '').replace(/\._tcp\.local$/, ''),
        port: url.port,
        txt: {
          nodeId: self.nodeId,
          scheme: self.scheme,
          capabilities: self.capabilities.map((c) => c.name).join(','),
          version: self.version ?? '',
          seq: String(seq),
          sig,
          pub: pubB64,
        },
      });
      log.info('mDNS advertise started', { name: self.name, port: url.port, signed: !!sig });
    }

    this.browser = instance.find(
      { type: this.serviceType.replace(/^_/, '').replace(/\._tcp\.local$/, '') },
      (svc) => {
        try {
          const peer = bonjourServiceToNodeInfo(svc);
          if (!peer) return;
          // Verify the beacon signature before accepting.
          const txt = (svc.txt ?? {}) as Record<string, string>;
          const seq = Number.parseInt(txt.seq ?? '0', 10);
          const payload = canonicalBeaconPayload(peer, Number.isFinite(seq) ? seq : 0);
          const pubPem = txt.pub
            ? Buffer.from(txt.pub, 'base64').toString('utf-8')
            : undefined;
          const verdict = verifyBeacon(this.signer, payload, txt.sig, pubPem);
          if (!verdict.ok) {
            log.warn('Dropping mDNS beacon - signature check failed', {
              peer: peer.nodeId,
              reason: verdict.reason,
            });
            return;
          }
          this.upsertPeer(peer);
        } catch (err) {
          log.debug('mDNS service parse failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    );
  }

  async stop(): Promise<void> {
    try {
      type Destroyable = { destroy?: () => void; stop?: () => void };
      const svc = this.service as Destroyable | null;
      const br = this.browser as Destroyable | null;
      const bj = this.bonjour as Destroyable | null;
      if (svc?.stop) svc.stop();
      if (br?.stop) br.stop();
      if (bj?.destroy) bj.destroy();
    } catch (err) {
      log.warn('mDNS stop error', { error: err instanceof Error ? err.message : String(err) });
    }
    this.knownPeers.clear();
  }

  private async tryLoadBonjour(): Promise<unknown> {
    try {
      const mod = (await import('bonjour-service' as string)) as Record<string, unknown>;
      return (mod.Bonjour as unknown) ?? (mod.default as unknown);
    } catch {
      if (!MdnsDiscovery.warnedMissing) {
        MdnsDiscovery.warnedMissing = true;
        log.warn(
          'bonjour-service package is not installed - mDNS discovery disabled. ' +
            'Run `npm install bonjour-service` to enable LAN auto-discovery.'
        );
      }
      return null;
    }
  }
}

/**
 * RegistryDiscovery polls a central HTTP endpoint that returns a JSON array
 * of NodeInfo entries.
 *
 * Wire format (signed):
 *   POST /register { node: NodeInfo, seq: number, sig: string, pub: string }
 *   GET  /nodes    -> { nodes: [{ node, seq, sig, pub }] }
 *
 * Incoming entries are dropped if the signature does not verify (and the
 * local node has a trustedPublicKeys allowlist).
 */
export class RegistryDiscovery extends BaseDiscovery {
  readonly method: DiscoveryMethod = 'registry';
  private readonly registryUrl: string;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;

  constructor(registryUrl: string, signer: BeaconSigner = noopSigner(), pollIntervalMs: number = 15000) {
    super(signer);
    this.registryUrl = registryUrl.replace(/\/$/, '');
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(self: NodeInfo, advertise: boolean): Promise<void> {
    this.selfId = self.nodeId;

    if (advertise) {
      await this.register(self).catch((err) =>
        log.warn('Registry register failed', { error: err instanceof Error ? err.message : String(err) })
      );
    }

    await this.refresh();
    this.pollHandle = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, this.pollIntervalMs);
    // Don't keep the process alive solely for the registry poll.
    if (this.pollHandle && typeof (this.pollHandle as unknown as { unref?: () => void }).unref === 'function') {
      (this.pollHandle as unknown as { unref: () => void }).unref();
    }
  }

  async stop(): Promise<void> {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.knownPeers.clear();
  }

  private async register(self: NodeInfo): Promise<void> {
    const seq = Date.now();
    const payload = canonicalBeaconPayload(self, seq);
    const sig = this.signer.sign ? this.signer.sign(payload) : '';
    const pub = this.signer.publicKeyPem ?? '';
    await fetch(`${this.registryUrl}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: self, seq, sig, pub }),
    });
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.registryUrl}/nodes`);
      if (!res.ok) {
        log.debug('Registry refresh non-ok', { status: res.status });
        return;
      }
      const body = (await res.json()) as {
        nodes?: Array<
          | NodeInfo
          | { node: NodeInfo; seq?: number; sig?: string; pub?: string }
        >;
      };
      const incoming = body.nodes ?? [];
      const validIds = new Set<string>();
      for (const entry of incoming) {
        // Accept both legacy (bare NodeInfo) and signed envelope shapes.
        const isEnvelope = (entry as { node?: NodeInfo }).node !== undefined;
        const node = isEnvelope ? (entry as { node: NodeInfo }).node : (entry as NodeInfo);
        const sig = isEnvelope ? (entry as { sig?: string }).sig : undefined;
        const pub = isEnvelope ? (entry as { pub?: string }).pub : undefined;
        const seq = isEnvelope ? (entry as { seq?: number }).seq ?? 0 : 0;
        const payload = canonicalBeaconPayload(node, seq);
        const verdict = verifyBeacon(this.signer, payload, sig, pub);
        if (!verdict.ok) {
          log.warn('Dropping registry entry - signature check failed', {
            peer: node.nodeId,
            reason: verdict.reason,
          });
          continue;
        }
        validIds.add(node.nodeId);
        this.upsertPeer(node);
      }
      // Remove gone peers
      for (const id of Array.from(this.knownPeers.keys())) {
        if (!validIds.has(id)) this.removePeer(id);
      }
    } catch (err) {
      log.debug('Registry refresh failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Factory that returns a Discovery instance matching the configured method.
 * The caller is responsible for calling `start` and `stop`.
 */
export function createDiscovery(
  config: FederationConfig,
  staticPeers: NodeInfo[],
  signer: BeaconSigner = noopSigner()
): Discovery {
  switch (config.discoveryMethod) {
    case 'mdns':
      return new MdnsDiscovery(config.mdnsServiceType, signer);
    case 'registry':
      if (!config.registryUrl) {
        log.warn('registry discovery selected but no registryUrl - falling back to static');
        return new StaticDiscovery(staticPeers, signer);
      }
      return new RegistryDiscovery(config.registryUrl, signer);
    case 'static':
    default:
      return new StaticDiscovery(staticPeers, signer);
  }
}

/** Signer that performs no signing and accepts unsigned beacons (legacy). */
export function noopSigner(): BeaconSigner {
  return {
    publicKeyPem: null,
    sign: null,
    trustedPublicKeys: new Set(),
    enforceTrust: false,
  };
}

/* ---------- helpers ---------- */

function parseAddress(addr: string): { host: string; port: number } {
  // Accept host:port, https://host:port, http://host:port
  let s = addr.trim();
  s = s.replace(/^https?:\/\//, '');
  const [host, portStr] = s.split(':');
  const port = Number.parseInt(portStr ?? '0', 10);
  return { host: host || 'localhost', port: Number.isFinite(port) ? port : 0 };
}

function bonjourServiceToNodeInfo(svc: Record<string, unknown>): NodeInfo | null {
  const txt = (svc.txt ?? {}) as Record<string, string>;
  const nodeId = txt.nodeId;
  if (!nodeId) return null;
  const host = (svc.host as string) ?? (svc.referer as { address?: string } | undefined)?.address ?? 'localhost';
  const port = (svc.port as number) ?? 0;
  const scheme = (txt.scheme as 'https' | 'http') ?? 'https';
  const capabilities = (txt.capabilities ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, enabled: true }));
  return {
    nodeId,
    name: (svc.name as string) ?? nodeId,
    address: `${scheme}://${host}:${port}`,
    scheme,
    capabilities: capabilities as NodeInfo['capabilities'],
    version: txt.version || undefined,
    lastSeen: new Date(),
  };
}
