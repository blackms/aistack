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
 * All discoveries share the `Discovery` interface so they can be swapped at
 * runtime without touching the routing / transport layers.
 */

import { logger } from '../utils/logger.js';
import type {
  DiscoveryMethod,
  FederationConfig,
  NodeInfo,
} from './types.js';

const log = logger.child('federation:discovery');

const DEFAULT_MDNS_SERVICE_TYPE = '_aistack._tcp.local';

/**
 * Listener invoked when the set of known peers changes.
 */
export type PeerListener = (peers: NodeInfo[]) => void;

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
 */
export class StaticDiscovery extends BaseDiscovery {
  readonly method: DiscoveryMethod = 'static';
  private readonly staticPeers: NodeInfo[];

  constructor(staticPeers: NodeInfo[]) {
    super();
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
 */
export class MdnsDiscovery extends BaseDiscovery {
  readonly method: DiscoveryMethod = 'mdns';
  private readonly serviceType: string;
  private bonjour: unknown = null;
  private service: unknown = null;
  private browser: unknown = null;
  private static warnedMissing = false;

  constructor(serviceType: string = DEFAULT_MDNS_SERVICE_TYPE) {
    super();
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
      this.service = instance.publish({
        name: self.name,
        type: this.serviceType.replace(/^_/, '').replace(/\._tcp\.local$/, ''),
        port: url.port,
        txt: {
          nodeId: self.nodeId,
          scheme: self.scheme,
          capabilities: self.capabilities.map((c) => c.name).join(','),
          version: self.version ?? '',
        },
      });
      log.info('mDNS advertise started', { name: self.name, port: url.port });
    }

    this.browser = instance.find(
      { type: this.serviceType.replace(/^_/, '').replace(/\._tcp\.local$/, '') },
      (svc) => {
        try {
          const peer = bonjourServiceToNodeInfo(svc);
          if (peer) this.upsertPeer(peer);
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
 * The expected wire shape is `{ nodes: NodeInfo[] }`. POST /register on the
 * same base URL is used to advertise this node when `advertise` is true.
 */
export class RegistryDiscovery extends BaseDiscovery {
  readonly method: DiscoveryMethod = 'registry';
  private readonly registryUrl: string;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;

  constructor(registryUrl: string, pollIntervalMs: number = 15000) {
    super();
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
    await fetch(`${this.registryUrl}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(self),
    });
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.registryUrl}/nodes`);
      if (!res.ok) {
        log.debug('Registry refresh non-ok', { status: res.status });
        return;
      }
      const body = (await res.json()) as { nodes?: NodeInfo[] };
      const incoming = body.nodes ?? [];
      const incomingIds = new Set(incoming.map((p) => p.nodeId));
      // Add / update
      for (const p of incoming) this.upsertPeer(p);
      // Remove gone peers
      for (const id of Array.from(this.knownPeers.keys())) {
        if (!incomingIds.has(id)) this.removePeer(id);
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
  staticPeers: NodeInfo[]
): Discovery {
  switch (config.discoveryMethod) {
    case 'mdns':
      return new MdnsDiscovery(config.mdnsServiceType);
    case 'registry':
      if (!config.registryUrl) {
        log.warn('registry discovery selected but no registryUrl - falling back to static');
        return new StaticDiscovery(staticPeers);
      }
      return new RegistryDiscovery(config.registryUrl);
    case 'static':
    default:
      return new StaticDiscovery(staticPeers);
  }
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
