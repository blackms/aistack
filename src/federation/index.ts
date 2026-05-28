/**
 * Federation module - public surface.
 *
 * The `FederationManager` wires together discovery + routing + transport +
 * server and exposes a small high-level API:
 *
 *   const fed = createFederation(config);
 *   await fed.join();
 *   const decision = fed.delegateTask({ taskId, agentType, input });
 *   if (decision.peer) await fed.submitTask(decision.peer, task);
 *   await fed.leave();
 *
 * The manager is opt-in: nothing else in aistack imports it directly.
 * Coordinators can call `delegateTask` only when they want to spread work.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { createDiscovery, Discovery } from './discovery.js';
import { TaskRouter } from './routing.js';
import {
  FederationClient,
  FederationCredentials,
  loadCredentials,
} from './transport.js';
import { FederationServer, type TaskHandler } from './server.js';
import type {
  Capability,
  FederationConfig,
  FederationStatus,
  NodeInfo,
  RoutingDecision,
  RoutingPolicy,
  TaskDelegation,
  TaskDelegationResult,
} from './types.js';

export * from './types.js';
export { TaskRouter } from './routing.js';
export {
  loadCredentials,
  buildHttpsAgent,
  verifyPeerRequest,
  sanitizeDelegation,
  FederationClient,
} from './transport.js';
export {
  StaticDiscovery,
  MdnsDiscovery,
  RegistryDiscovery,
  createDiscovery,
} from './discovery.js';
export { FederationServer } from './server.js';

const log = logger.child('federation');

/**
 * Federation default config shared with the Zod schema in utils/config.ts.
 */
export const FEDERATION_DEFAULTS: FederationConfig = {
  enabled: false,
  discoveryMethod: 'static',
  advertise: false,
  peers: [],
  bindAddress: '0.0.0.0',
  bindPort: 0,
  routingPolicy: 'least-loaded',
  maxInputLength: 4096,
  requestTimeoutMs: 10_000,
  mdnsServiceType: '_aistack._tcp.local',
};

/**
 * High-level federation orchestrator.
 *
 * The manager is intentionally stateless w.r.t. running tasks: when a peer
 * accepts a delegated task, the local coordinator is the one waiting on the
 * `submitTask` promise.
 */
export class FederationManager {
  private readonly config: Required<Pick<FederationConfig, 'discoveryMethod' | 'advertise' | 'peers' | 'routingPolicy' | 'maxInputLength'>> &
    FederationConfig;
  private readonly credentials: FederationCredentials;
  private readonly client: FederationClient;
  private readonly router: TaskRouter;
  private discovery: Discovery | null = null;
  private server: FederationServer | null = null;
  private selfInfo: NodeInfo;
  private joinedAt?: Date;
  private localCapabilities: Capability[] = [];
  private taskHandler: TaskHandler | null = null;

  constructor(config: FederationConfig) {
    this.config = { ...FEDERATION_DEFAULTS, ...config };
    this.credentials = loadCredentials(this.config.tls);
    this.client = new FederationClient(this.credentials, {
      maxInputLength: this.config.maxInputLength,
      timeoutMs: this.config.requestTimeoutMs,
    });
    this.router = new TaskRouter();

    const nodeId = this.config.nodeId ?? randomUUID();
    const name = this.config.name ?? `aistack-${nodeId.slice(0, 8)}`;
    const scheme: 'https' | 'http' =
      this.credentials.cert && this.credentials.key ? 'https' : 'http';
    const host = this.config.bindAddress ?? '0.0.0.0';
    const port = this.config.bindPort ?? 0;
    this.selfInfo = {
      nodeId,
      name,
      address: `${scheme}://${host}:${port}`,
      scheme,
      capabilities: [],
    };
  }

  /**
   * Register the local capabilities advertised to peers. Should be called
   * after spawner / registry are initialized.
   */
  setLocalCapabilities(caps: Capability[]): void {
    this.localCapabilities = caps;
    this.selfInfo = { ...this.selfInfo, capabilities: caps };
  }

  /**
   * Register the local task handler invoked when a peer submits work.
   * If not registered, incoming tasks are rejected with status `rejected`.
   */
  setTaskHandler(handler: TaskHandler): void {
    this.taskHandler = handler;
  }

  /**
   * Join the federation cluster: start the server, then start discovery.
   * Safe to call when `config.enabled === false` — it becomes a no-op.
   */
  async join(): Promise<void> {
    if (!this.config.enabled) {
      log.info('Federation disabled - join is a no-op');
      return;
    }

    // Start server first so we have a real port before advertising.
    this.server = new FederationServer({
      credentials: this.credentials,
      selfInfo: () => this.selfInfo,
      onTask: async (task) => this.dispatchIncomingTask(task),
      bindAddress: this.config.bindAddress,
      bindPort: this.config.bindPort,
    });
    await this.server.start();
    const bound = this.server.getBoundAddress();
    if (bound) {
      this.selfInfo = {
        ...this.selfInfo,
        address: `${this.selfInfo.scheme}://${bound.host}:${bound.port}`,
      };
    }

    // Discovery
    const staticPeers = parseStaticPeers(this.config.peers);
    this.discovery = createDiscovery(this.config, staticPeers);
    await this.discovery.start(this.selfInfo, this.config.advertise);

    this.joinedAt = new Date();
    log.info('Federation joined', {
      nodeId: this.selfInfo.nodeId,
      method: this.config.discoveryMethod,
      advertise: this.config.advertise,
    });
  }

  /** Leave the federation: stop discovery, stop server. */
  async leave(): Promise<void> {
    if (this.discovery) {
      await this.discovery.stop();
      this.discovery = null;
    }
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
    this.joinedAt = undefined;
    log.info('Federation left');
  }

  /** Snapshot of current federation state. */
  status(): FederationStatus {
    return {
      enabled: this.config.enabled,
      nodeId: this.selfInfo.nodeId,
      name: this.selfInfo.name,
      address: this.selfInfo.address,
      peers: this.discovery?.peers() ?? [],
      discoveryMethod: this.config.discoveryMethod,
      joinedAt: this.joinedAt,
    };
  }

  /** Currently known peers (empty when not joined). */
  peers(): NodeInfo[] {
    return this.discovery?.peers() ?? [];
  }

  /**
   * Pick a peer for the given task. Returns a RoutingDecision with
   * `peer === null` when no peer is suitable (caller should run locally).
   *
   * This is the opt-in hook that coordinators call - no other module
   * is forced to import federation.
   */
  delegateTask(
    task: TaskDelegation,
    policy?: RoutingPolicy
  ): RoutingDecision {
    if (!this.config.enabled) {
      return { peer: null, policy: this.config.routingPolicy, reason: 'federation disabled' };
    }
    return this.router.delegateTask(task, this.peers(), policy ?? this.config.routingPolicy);
  }

  /** Send a task to a peer and await the result. */
  async submitTask(peer: NodeInfo, task: TaskDelegation): Promise<TaskDelegationResult> {
    return this.client.submitTask(peer, task);
  }

  /** Fetch (and refresh) a peer's capabilities. */
  async fetchPeerCapabilities(peer: NodeInfo): Promise<NodeInfo | null> {
    return this.client.fetchPeerCapabilities(peer);
  }

  /**
   * Called by the server when a peer submits a task. If no local handler is
   * registered, the task is politely rejected.
   */
  private async dispatchIncomingTask(task: TaskDelegation): Promise<TaskDelegationResult> {
    if (!this.taskHandler) {
      return {
        taskId: task.taskId,
        status: 'rejected',
        error: 'No local task handler registered',
        executedBy: this.selfInfo.nodeId,
      };
    }
    const result = await this.taskHandler(task);
    return { ...result, executedBy: this.selfInfo.nodeId };
  }
}

/**
 * Factory: build a `FederationManager` from a sibling config block.
 * Caller is responsible for `join()` / `leave()` lifecycle.
 */
export function createFederation(config: FederationConfig): FederationManager {
  return new FederationManager(config);
}

/* ---------- helpers ---------- */

function parseStaticPeers(peers: string[]): NodeInfo[] {
  return peers.map((p, idx): NodeInfo => {
    const url = p.includes('://') ? p : `https://${p}`;
    const scheme: 'https' | 'http' = url.startsWith('https://') ? 'https' : 'http';
    return {
      nodeId: `static-${idx}`,
      name: `static-${idx}`,
      address: url,
      scheme,
      capabilities: [],
    };
  });
}

