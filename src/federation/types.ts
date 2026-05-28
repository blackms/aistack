/**
 * Federation types - shared types for multi-machine federation layer.
 *
 * AIG-652 introduces a federation module that allows multiple aistack nodes
 * to discover each other, advertise capabilities, and route task work across
 * machines without exposing sensitive payload data.
 */

/**
 * Capability advertised by a federation node. A capability represents an
 * agent type the node can run plus optional metadata used for routing
 * (e.g. concurrency budget, current load, supported models).
 */
export interface Capability {
  /** Capability identifier (typically the agent type, e.g. "coder"). */
  name: string;
  /** Capability version (for forward compatibility). */
  version?: string;
  /** Max concurrent tasks the node is willing to accept for this capability. */
  maxConcurrent?: number;
  /** Optional metadata for capability-match policy. */
  metadata?: Record<string, unknown>;
}

/**
 * Information published by a federation node when it joins the cluster.
 *
 * NOTE: NodeInfo intentionally does NOT include any task payload, code, or
 * memory snippets. Only routing-relevant data is advertised, which keeps
 * the no-egress guarantee documented in docs/FEDERATION.md.
 */
export interface NodeInfo {
  /** Stable node identifier (random UUID at first join, persisted). */
  nodeId: string;
  /** Human-readable node name. */
  name: string;
  /** Reachable address (host:port or full URL). */
  address: string;
  /** TLS/transport scheme: 'https' (mTLS) or 'http' (insecure, dev only). */
  scheme: 'https' | 'http';
  /** Capabilities advertised by the node. */
  capabilities: Capability[];
  /** Current load (0..1) reported by the node, used by least-loaded policy. */
  load?: number;
  /** Tags useful for routing filters (region, env, hardware class, ...). */
  tags?: string[];
  /** Last time we successfully fetched capabilities from this node. */
  lastSeen?: Date;
  /** Software version of the running aistack node. */
  version?: string;
}

/**
 * Discovery method used by a federation node to find peers.
 *
 * - 'mdns'      uses multicast DNS / Bonjour on the local network. Requires
 *               the optional `bonjour-service` peer dependency.
 * - 'registry'  uses a central HTTP registry (URL configured separately).
 * - 'static'    uses the static peer list from configuration (no discovery).
 */
export type DiscoveryMethod = 'mdns' | 'registry' | 'static';

/**
 * Routing policy used by `delegateTask` to pick a peer.
 *
 * - 'round-robin'        cycles through peers that advertise the capability.
 * - 'least-loaded'       picks the peer with lowest reported `load`.
 * - 'capability-match'   picks the peer whose capability metadata best
 *                        matches the task hint (tags, model, region).
 */
export type RoutingPolicy = 'round-robin' | 'least-loaded' | 'capability-match';

/**
 * Task delegation request sent from coordinator to a remote node.
 *
 * NOTE: `input` should be redacted task metadata, never source code or
 * other sensitive payload. The transport layer enforces this by stripping
 * unknown keys before sending.
 */
export interface TaskDelegation {
  /** Task identifier on the origin node. */
  taskId: string;
  /** Agent type to spawn on the remote. */
  agentType: string;
  /** Sanitized task input (truncated to maxInputLength). */
  input: string;
  /** Optional routing hints. */
  hints?: {
    requiredCapabilities?: string[];
    preferredTags?: string[];
    estimatedTokens?: number;
  };
}

/**
 * Decision returned by the router when delegating a task.
 *
 * If `peer` is null, no remote node is suitable and the caller should
 * execute the task locally. This is the opt-in escape hatch that keeps
 * the federation layer non-intrusive for existing coordinators.
 */
export interface RoutingDecision {
  /** Chosen peer, or null if no suitable peer was found. */
  peer: NodeInfo | null;
  /** Reason text useful for logging and debugging. */
  reason: string;
  /** Policy that produced this decision. */
  policy: RoutingPolicy;
}

/**
 * Result returned by a remote node after running a delegated task.
 */
export interface TaskDelegationResult {
  taskId: string;
  status: 'completed' | 'failed' | 'rejected';
  /** Sanitized result (no raw code / no memory dumps). */
  summary?: string;
  /** Error message when status === 'failed'. */
  error?: string;
  /** Remote node id that produced the result. */
  executedBy: string;
}

/**
 * TLS configuration for mTLS transport.
 *
 * All paths are read from the local filesystem at startup. Never embed
 * certs/keys in the config file itself.
 */
export interface FederationTlsConfig {
  /** Path to the client/server certificate (PEM). */
  certPath?: string;
  /** Path to the private key (PEM). */
  keyPath?: string;
  /** Path to the CA bundle used to verify peers (PEM). */
  caPath?: string;
  /** When true, refuse connections from peers without a valid client cert. */
  requireClientCert?: boolean;
  /** Fallback bearer token for environments without mTLS (NOT recommended in prod). */
  bearerToken?: string;
}

/**
 * Federation configuration consumed by `createFederation()`.
 *
 * Sibling of the existing top-level config slots — adding the federation
 * key does not require touching any other module.
 */
export interface FederationConfig {
  /** Master switch. When false, the federation module is a no-op. */
  enabled: boolean;
  /** Stable node id (auto-generated if absent). */
  nodeId?: string;
  /** Human-readable name for this node. */
  name?: string;
  /** Discovery strategy. */
  discoveryMethod: DiscoveryMethod;
  /** Whether to advertise this node's capabilities to peers. */
  advertise: boolean;
  /** Static peer list (used by 'static' discovery and as bootstrap for others). */
  peers: string[];
  /** Registry URL for 'registry' discovery. */
  registryUrl?: string;
  /** mDNS service type, default '_aistack._tcp.local'. */
  mdnsServiceType?: string;
  /** Bind address for the federation server. */
  bindAddress?: string;
  /** Bind port for the federation server. */
  bindPort?: number;
  /** Routing policy used by delegateTask when none is explicitly passed. */
  routingPolicy: RoutingPolicy;
  /** Hard cap on task input size sent over the wire (chars). Default 4096. */
  maxInputLength?: number;
  /** TLS configuration. */
  tls?: FederationTlsConfig;
  /** Network timeout for peer calls (ms). */
  requestTimeoutMs?: number;
}

/**
 * Status snapshot returned by `aistack federation status`.
 */
export interface FederationStatus {
  enabled: boolean;
  nodeId: string;
  name: string;
  address: string;
  peers: NodeInfo[];
  discoveryMethod: DiscoveryMethod;
  joinedAt?: Date;
}
