/**
 * Configuration management for aistack
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import type { AgentStackConfig } from '../types.js';
import { logger } from './logger.js';

// Configuration schema using Zod
const VectorSearchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.string().optional(),
  model: z.string().optional(),
});

// AIG-640: opt-in sub-blocks for Anthropic Memory Tool integration.
const MemoryToolAdapterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  namespace: z.string().optional(),
  root: z.string().optional(),
});

const DreamingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMs: z.number().min(1000).optional(),
  batchSize: z.number().min(1).max(1000).optional(),
  minClusterSize: z.number().min(2).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  namespace: z.string().optional(),
  dreamNamespace: z.string().optional(),
});

const MemorySyncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  watchPath: z.string().optional(),
  namespace: z.string().optional(),
  pollIntervalMs: z.number().min(500).optional(),
  exportEnabled: z.boolean().optional(),
  importEnabled: z.boolean().optional(),
});

const MemoryConfigSchema = z.object({
  path: z.string().default('./data/aistack.db'),
  defaultNamespace: z.string().default('default'),
  vectorSearch: VectorSearchConfigSchema.default({}),
  toolAdapter: MemoryToolAdapterConfigSchema.optional(),
  dreaming: DreamingConfigSchema.optional(),
  sync: MemorySyncConfigSchema.optional(),
});

const AnthropicConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().optional(),
});

const OpenAIConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().optional(),
});

const OllamaConfigSchema = z.object({
  baseUrl: z.string().default('http://localhost:11434'),
  model: z.string().optional(),
});

const ProvidersConfigSchema = z.object({
  default: z.string().default('anthropic'),
  anthropic: AnthropicConfigSchema.optional(),
  openai: OpenAIConfigSchema.optional(),
  ollama: OllamaConfigSchema.optional(),
});

const AgentsConfigSchema = z.object({
  maxConcurrent: z.number().min(1).max(20).default(5),
  defaultTimeout: z.number().min(10).max(3600).default(300),
});

const GitHubConfigSchema = z.object({
  enabled: z.boolean().default(false),
  useGhCli: z.boolean().optional(),
  token: z.string().optional(),
});

const PluginsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().default('./plugins'),
});

const MCPConfigSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  port: z.number().optional(),
  host: z.string().optional(),
});

const HooksConfigSchema = z.object({
  sessionStart: z.boolean().default(true),
  sessionEnd: z.boolean().default(true),
  preTask: z.boolean().default(true),
  postTask: z.boolean().default(true),
});

const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().optional(),
  channel: z.string().optional(),
  username: z.string().optional(),
  iconEmoji: z.string().optional(),
  notifyOnAgentSpawn: z.boolean().default(false),
  notifyOnWorkflowComplete: z.boolean().default(true),
  notifyOnErrors: z.boolean().default(true),
  notifyOnReviewLoop: z.boolean().default(true),
  notifyOnResourceWarning: z.boolean().default(true),
  notifyOnResourceIntervention: z.boolean().default(true),
});

/**
 * Drift Detection Configuration Schema
 *
 * Controls semantic drift detection for task creation.
 *
 * @property enabled - Enable drift detection (requires vector search provider)
 * @property threshold - Similarity threshold (0.0-1.0) to trigger drift detection
 * @property warningThreshold - Optional lower threshold for warnings only
 * @property ancestorDepth - How many ancestor tasks to check (1-10)
 * @property behavior - 'warn' logs and allows, 'prevent' blocks task creation
 * @property asyncEmbedding - When true (default), task indexing is non-blocking.
 *   WARNING: This creates a race condition where child tasks created immediately
 *   after a parent may not have the parent's embedding available for drift checking.
 *   Set to false for strict drift detection at the cost of slower task creation.
 */
const DriftDetectionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  threshold: z.number().min(0).max(1).default(0.95),
  warningThreshold: z.number().min(0).max(1).optional(),
  ancestorDepth: z.number().min(1).max(10).default(3),
  behavior: z.enum(['warn', 'prevent']).default('warn'),
  asyncEmbedding: z.boolean().default(true),
}).refine(
  (data) => !data.warningThreshold || data.warningThreshold < data.threshold,
  {
    message: 'warningThreshold must be less than threshold',
    path: ['warningThreshold'],
  }
);

const ResourceThresholdsSchema = z.object({
  maxFilesAccessed: z.number().min(1).max(1000).default(50),
  maxApiCalls: z.number().min(1).max(10000).default(100),
  maxSubtasksSpawned: z.number().min(1).max(100).default(20),
  maxTimeWithoutDeliverableMs: z.number().min(60000).max(7200000).default(1800000),
  maxTokensConsumed: z.number().min(1000).max(10000000).default(500000),
});

const ResourceExhaustionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  thresholds: ResourceThresholdsSchema.default({}),
  warningThresholdPercent: z.number().min(0.1).max(0.99).default(0.7),
  checkIntervalMs: z.number().min(1000).max(60000).default(10000),
  autoTerminate: z.boolean().default(false),
  requireConfirmationOnIntervention: z.boolean().default(true),
  pauseOnIntervention: z.boolean().default(true),
});

const ConsensusConfigSchema = z.object({
  enabled: z.boolean().default(false),
  requireForRiskLevels: z.array(z.enum(['low', 'medium', 'high'])).default(['high', 'medium']),
  reviewerStrategy: z.enum(['adversarial', 'different-model', 'human']).default('adversarial'),
  timeout: z.number().min(30000).max(3600000).default(300000),
  maxDepth: z.number().min(1).max(10).default(5),
  autoReject: z.boolean().default(false),
  // Risk estimation configuration
  highRiskAgentTypes: z.array(z.string()).default(['coder', 'devops', 'security-auditor']),
  mediumRiskAgentTypes: z.array(z.string()).default(['architect', 'coordinator', 'analyst']),
  highRiskPatterns: z.array(z.string()).default([
    'delete', 'remove', 'drop', 'deploy', 'production',
    'credentials', 'secret', 'password', 'token', 'api key',
  ]),
  mediumRiskPatterns: z.array(z.string()).default([
    'modify', 'update', 'change', 'configure', 'install',
  ]),
});

/**
 * Telemetry Configuration Schema (AIG-655)
 *
 * Opt-in anonymous usage telemetry. Disabled by default (privacy-first).
 * When enabled, posts anonymized events (review_loop.completed, agent.spawned)
 * to a configurable HTTPS endpoint. See docs/TELEMETRY.md.
 */
const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().url().optional(),
  anonymizeSessionId: z.boolean().default(true),
  flushIntervalMs: z.number().min(1000).max(3600000).default(60000),
  batchSize: z.number().min(1).max(1000).default(20),
});

/**
 * Audit Log Configuration Schema (AIG-635)
 *
 * Controls the hash-chained append-only audit log for SOC2/ISO27001/HIPAA evidence.
 *
 * @property enabled - Enable audit logging (creates a separate SQLite file at `<memory.path>.audit.db` by default)
 * @property path - Override audit DB path
 * @property signatureKey - HMAC-SHA256 key; prefer env var AISTACK_AUDIT_KEY over inlining here
 * @property retentionDays - Informational retention hint; chain itself is append-only and never auto-pruned
 * @property redactFields - Top-level payload fields to redact before hashing/storage
 */
const AuditConfigSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().optional(),
  signatureKey: z.string().optional(),
  retentionDays: z.number().min(1).max(36500).optional(),
  redactFields: z.array(z.string()).default([]),
});

/**
 * Sandbox Configuration Schema (AIG-634)
 *
 * Controls sandboxed code execution for the coder agent and any caller of
 * `createSandbox()`. Disabled by default — opt-in by setting
 * `sandbox.provider` to one of 'docker' | 'e2b' | 'daytona'.
 *
 * Security defaults are intentionally conservative:
 *   - network: false (no egress from Docker)
 *   - memory: 512MB, cpus: 1, pidsLimit: 100
 *   - timeout: 30s wall clock
 * See docs/SANDBOX.md "Security Model" for the full threat model.
 */
const SandboxConfigSchema = z.object({
  provider: z.enum(['none', 'docker', 'e2b', 'daytona']).default('none'),
  timeout: z.number().min(1000).max(600_000).default(30_000),
  memoryMb: z.number().min(64).max(8192).default(512),
  cpus: z.number().min(0.1).max(8).default(1),
  pidsLimit: z.number().min(10).max(4096).default(100),
  network: z.boolean().default(false),
  images: z
    .object({
      python: z.string().optional(),
      javascript: z.string().optional(),
      typescript: z.string().optional(),
      bash: z.string().optional(),
    })
    .partial()
    .optional(),
  e2bApiKey: z.string().optional(),
  daytonaApiUrl: z.string().url().optional(),
  daytonaApiKey: z.string().optional(),
});

const PostgresIntegrationSchema = z.object({
  enabled: z.boolean().optional(),
  connectionString: z.string().optional(),
  packageName: z.string().optional(),
});

const GithubRemoteIntegrationSchema = z.object({
  enabled: z.boolean().optional(),
  token: z.string().optional(),
  toolsets: z.array(z.string()).optional(),
  image: z.string().optional(),
});

const SentryIntegrationSchema = z.object({
  enabled: z.boolean().optional(),
  authToken: z.string().optional(),
  organization: z.string().optional(),
  host: z.string().optional(),
  packageName: z.string().optional(),
});

const PlaywrightIntegrationSchema = z.object({
  enabled: z.boolean().optional(),
  browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
  headless: z.boolean().optional(),
  userDataDir: z.string().optional(),
  packageName: z.string().optional(),
});

const SlackMcpIntegrationSchema = z.object({
  enabled: z.boolean().optional(),
  botToken: z.string().optional(),
  teamId: z.string().optional(),
  channelIds: z.array(z.string()).optional(),
  packageName: z.string().optional(),
});

const IntegrationsConfigSchema = z.object({
  postgres: PostgresIntegrationSchema.optional(),
  githubRemote: GithubRemoteIntegrationSchema.optional(),
  sentry: SentryIntegrationSchema.optional(),
  playwright: PlaywrightIntegrationSchema.optional(),
  slack: SlackMcpIntegrationSchema.optional(),
});

const GuardrailsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  builtin: z.array(z.string()).default([]),
  customPaths: z.array(z.string()).optional(),
  timeoutMs: z.number().min(50).max(60000).default(2000),
  killSwitch: z.boolean().default(true),
});

const SmartDispatcherConfigSchema = z.object({
  enabled: z.boolean().default(true),
  cacheEnabled: z.boolean().default(true),
  cacheTTLMs: z.number().min(60000).max(86400000).default(3600000),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  fallbackAgentType: z.string().default('coder'),
  maxDescriptionLength: z.number().min(100).max(10000).default(1000),
  // Claude 4.5 models: claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929, claude-opus-4-5-20251101
  dispatchModel: z.string().default('claude-haiku-4-5-20251001'),
});

/** AIG-636 — daemon (background headless runner). Sibling field, no overlap with other agents. */
const DaemonConfigSchema = z.object({
  enabled: z.boolean().default(false),
  dataDir: z.string().optional(),
  queueBackend: z.enum(['file', 'redis']).default('file'),
  redisUrl: z.string().optional(),
  webhook: z.object({
    enabled: z.boolean().default(true),
    port: z.number().min(0).max(65535).default(8787),
    host: z.string().default('127.0.0.1'),
    hmacSecret: z.string().optional(),
  }).default({}),
  maxConcurrent: z.number().min(1).max(64).default(4),
  pollIntervalMs: z.number().min(50).max(60000).default(500),
  logRotationBytes: z.number().min(1024).default(5 * 1024 * 1024),
});

/**
 * Durable execution / checkpointing config.
 *
 * When `enabled` is true, agent state is serialized after every step to
 * the `agent_checkpoints` table (see migrations/004_add_checkpoints.sql),
 * making workflows resumable via `aistack workflow resume <session-id>`
 * after a crash.
 *
 * @property enabled - Master switch. Default false (opt-in).
 * @property granularity - 'step' (default): write after every step.
 *   'agent': write only when an agent completes. Trade fidelity for write volume.
 * @property retentionPerSession - Keep only the latest N checkpoints per session.
 *   Default 50. Set to 0 to keep every checkpoint forever (unbounded growth).
 */
const CheckpointingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  granularity: z.enum(['step', 'agent']).default('step'),
  retentionPerSession: z.number().int().min(0).max(10000).default(50),
});

// --- SSO (AIG-646) sub-field schemas. Validates SAML/OIDC/SCIM settings at
// config load time. Providers themselves are wired only when the SSO module
// is initialised (lazy require of @node-saml/node-saml, openid-client).
const RoleEnum = z.enum(['admin', 'developer', 'viewer']);
const GroupRoleMapSchema = z.record(z.string(), RoleEnum);

const SsoSamlConfigSchema = z
  .object({
    providerName: z.string().min(1),
    entityId: z.string().min(1),
    idpSsoUrl: z.string().url(),
    idpSloUrl: z.string().url().optional(),
    idpCert: z.string().min(1),
    callbackUrl: z.string().url(),
    spPrivateKey: z.string().optional(),
    spCert: z.string().optional(),
    signatureAlgorithm: z.enum(['sha256', 'sha512']).optional(),
    digestAlgorithm: z.enum(['sha256', 'sha512']).optional(),
    acceptedClockSkewSec: z.number().min(0).max(300).optional(),
    requestIdExpirationMs: z.number().min(60000).max(3600000).optional(),
    groupRoleMap: GroupRoleMapSchema.optional(),
    groupAttributeName: z.string().optional(),
    emailAttributeName: z.string().optional(),
    usernameAttributeName: z.string().optional(),
  })
  .passthrough();

const SsoOidcConfigSchema = z
  .object({
    providerName: z.string().min(1),
    issuerUrl: z.string().url(),
    clientId: z.string().min(1),
    clientSecret: z.string().optional(),
    pkceRequired: z.boolean().optional(),
    redirectUri: z.string().url(),
    scopes: z.array(z.string()).optional(),
    jwksUri: z.string().url().optional(),
    groupsClaim: z.string().optional(),
    groupRoleMap: GroupRoleMapSchema.optional(),
  })
  .passthrough();

const SsoScimConfigSchema = z
  .object({
    enabled: z.boolean(),
    bearerToken: z.string().min(16),
    mutationsPerMinute: z.number().min(1).max(10000).optional(),
    groupRoleMap: GroupRoleMapSchema.optional(),
  })
  .passthrough();

const SsoConfigSchema = z.object({
  saml: SsoSamlConfigSchema.optional(),
  oidc: SsoOidcConfigSchema.optional(),
  scim: SsoScimConfigSchema.optional(),
  defaultRole: RoleEnum.optional(),
  strictIdentityBinding: z.boolean().optional(),
});

const AuthConfigSchema = z.object({
  sso: SsoConfigSchema.optional(),
});

const ConfigSchema = z.object({
  version: z.string().default('1.0.0'),
  memory: MemoryConfigSchema.default({}),
  providers: ProvidersConfigSchema.default({}),
  agents: AgentsConfigSchema.default({}),
  github: GitHubConfigSchema.default({}),
  plugins: PluginsConfigSchema.default({}),
  mcp: MCPConfigSchema.default({}),
  hooks: HooksConfigSchema.default({}),
  slack: SlackConfigSchema.default({}),
  driftDetection: DriftDetectionConfigSchema.default({}),
  resourceExhaustion: ResourceExhaustionConfigSchema.default({}),
  consensus: ConsensusConfigSchema.default({}),
  smartDispatcher: SmartDispatcherConfigSchema.default({}),
  daemon: DaemonConfigSchema.default({}),
  telemetry: TelemetryConfigSchema.default({}),
  audit: AuditConfigSchema.default({}),
  checkpointing: CheckpointingConfigSchema.default({}),
  sandbox: SandboxConfigSchema.default({}),
  integrations: IntegrationsConfigSchema.optional(),
  guardrails: GuardrailsConfigSchema.default({}),
  auth: AuthConfigSchema.optional(),
});

const CONFIG_FILE_NAME = 'aistack.config.json';

/**
 * Interpolate `${VAR_NAME}` placeholders in config values from process.env.
 *
 * Throws when a referenced env var is unset — silently substituting "" hides
 * misconfiguration (e.g. an empty Postgres connection string would fall back
 * to libpq defaults and connect to the wrong DB). Callers that want
 * best-effort interpolation can catch and downgrade.
 *
 * Escape with `$${VAR}` if you need a literal `${VAR}` in your config.
 */
function interpolateEnvVars(obj: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof obj === 'string') {
    // Honor the `$${VAR}` escape: protect, substitute, then restore.
    const ESCAPE_SENTINEL = 'ESC_DOLLAR';
    const protectedStr = obj.replace(/\$\$\{/g, ESCAPE_SENTINEL);
    const substituted = protectedStr.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_, envVar: string) => {
      const value = env[envVar];
      if (value === undefined) {
        throw new Error(
          `Environment variable \${${envVar}} referenced in aistack.config.json is not set. ` +
          `Export it before starting aistack, or remove the reference.`
        );
      }
      return value;
    });
    return substituted.replace(new RegExp(ESCAPE_SENTINEL, 'g'), '${');
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateEnvVars(item, env));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value, env);
    }
    return result;
  }
  return obj;
}

/**
 * Find config file by walking up directories
 */
function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (true) {
    const configPath = join(currentDir, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      return configPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Load and validate configuration
 */
export function loadConfig(configPath?: string): AgentStackConfig {
  const path = configPath ?? findConfigFile();

  let rawConfig: unknown = {};

  if (path && existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      rawConfig = JSON.parse(content);
      logger.debug('Loaded config from file', { path });
    } catch (error) {
      logger.warn('Failed to parse config file, using defaults', {
        path,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    logger.debug('No config file found, using defaults');
  }

  // Interpolate environment variables
  const interpolated = interpolateEnvVars(rawConfig);

  // Validate and apply defaults
  const result = ConfigSchema.safeParse(interpolated);

  if (!result.success) {
    logger.warn('Config validation errors, using defaults for invalid fields', {
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return ConfigSchema.parse({});
  }

  return result.data as AgentStackConfig;
}

/**
 * Get default config
 */
export function getDefaultConfig(): AgentStackConfig {
  return ConfigSchema.parse({}) as AgentStackConfig;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: AgentStackConfig, configPath?: string): void {
  const path = configPath ?? join(process.cwd(), CONFIG_FILE_NAME);

  // Ensure directory exists
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(config, null, 2));
  logger.info('Configuration saved', { path });
}

/**
 * Validate a configuration object
 */
export function validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
  const result = ConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}

// Singleton config instance
let cachedConfig: AgentStackConfig | null = null;

/**
 * Get the current configuration (cached)
 */
export function getConfig(): AgentStackConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Reset the cached configuration
 */
export function resetConfig(): void {
  cachedConfig = null;
}
