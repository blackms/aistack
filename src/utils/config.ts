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

const MemoryConfigSchema = z.object({
  path: z.string().default('./data/aistack.db'),
  defaultNamespace: z.string().default('default'),
  vectorSearch: VectorSearchConfigSchema.default({}),
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
});

const CONFIG_FILE_NAME = 'aistack.config.json';

/**
 * Interpolate environment variables in config values
 */
function interpolateEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
      return process.env[envVar] ?? '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
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
