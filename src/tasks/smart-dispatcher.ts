/**
 * Smart Dispatcher Service
 * Uses LLM to automatically select the best agent type based on task description
 */

import type {
  AgentStackConfig,
  SmartDispatcherConfig,
  DispatchDecision,
  LLMProvider,
} from '../types.js';
import { getProvider, AnthropicProvider } from '../providers/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('smart-dispatcher');

const DEFAULT_CONFIG: SmartDispatcherConfig = {
  enabled: true,
  cacheEnabled: true,
  cacheTTLMs: 3600000, // 1 hour
  confidenceThreshold: 0.7,
  fallbackAgentType: 'coder',
  maxDescriptionLength: 1000,
  dispatchModel: 'claude-haiku-4-5-20251001', // Fast & cost-effective, alternatives: claude-sonnet-4-5-20250929, claude-opus-4-5-20251101
};

const SYSTEM_PROMPT = `You are an AI task router. Your job is to analyze a task description and select the most appropriate agent type to handle it.

Available agents and their capabilities:
- coder: write-code, edit-code, refactor, debug, implement features, fix bugs
- researcher: search-code, analyze-patterns, explore-codebase, find information
- tester: write-tests, run-tests, coverage-analysis, test automation
- reviewer: code-review, security-review, best-practices, quality assurance
- adversarial: break-code, edge-case-analysis, security testing, fault injection
- architect: system-design, technical-decisions, architecture planning
- coordinator: task-decomposition, workflow-management, orchestration
- analyst: data-analysis, performance-profiling, metrics evaluation
- devops: ci-cd-setup, containerization, kubernetes, deployment, infrastructure
- documentation: api-docs, user-guides, tutorials, technical writing
- security-auditor: vulnerability-scanning, compliance, security assessment

Analyze the task and respond ONLY with a JSON object in this exact format:
{"agentType":"<type>","confidence":<0.0-1.0>,"reasoning":"<brief explanation>"}

Do not include any other text, markdown formatting, or code blocks. Just the raw JSON.`;

interface CacheEntry {
  decision: DispatchDecision;
  expiresAt: number;
}

export class SmartDispatcher {
  private config: SmartDispatcherConfig;
  private appConfig: AgentStackConfig;
  private cache: Map<string, CacheEntry>;
  private provider: LLMProvider | null;

  constructor(appConfig: AgentStackConfig) {
    this.config = { ...DEFAULT_CONFIG, ...appConfig.smartDispatcher };
    this.appConfig = appConfig;
    this.cache = new Map();
    this.provider = this.createProvider();

    log.debug('Smart dispatcher initialized', {
      enabled: this.config.enabled,
      cacheEnabled: this.config.cacheEnabled,
      cacheTTLMs: this.config.cacheTTLMs,
    });
  }

  /**
   * Create the LLM provider for dispatching
   * Uses configurable model (defaults to Haiku for low latency)
   */
  private createProvider(): LLMProvider | null {
    try {
      // Try to get Anthropic provider with configured dispatch model
      if (this.appConfig.providers.anthropic?.apiKey) {
        return new AnthropicProvider(
          this.appConfig.providers.anthropic.apiKey,
          this.config.dispatchModel
        );
      }

      // Fall back to default provider
      const provider = getProvider(this.appConfig.providers.default, this.appConfig);
      return provider;
    } catch (error) {
      log.warn('Failed to create dispatch provider', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Check if the dispatcher is enabled and operational
   */
  isEnabled(): boolean {
    return this.config.enabled && this.provider !== null;
  }

  /**
   * Get the current configuration
   */
  getConfig(): SmartDispatcherConfig {
    return { ...this.config };
  }

  /**
   * Dispatch a task to the appropriate agent type
   */
  async dispatch(description: string): Promise<{
    success: boolean;
    decision?: DispatchDecision;
    error?: string;
  }> {
    if (!this.isEnabled()) {
      return {
        success: false,
        error: 'Smart dispatcher is not enabled or no provider available',
      };
    }

    const startTime = Date.now();

    try {
      // Truncate description if too long
      const truncatedDesc = description.slice(0, this.config.maxDescriptionLength);

      // Check cache first
      if (this.config.cacheEnabled) {
        const cached = this.getCachedDecision(truncatedDesc);
        if (cached) {
          log.debug('Cache hit for dispatch', { description: truncatedDesc.slice(0, 50) });
          return {
            success: true,
            decision: {
              ...cached,
              cached: true,
              latencyMs: Date.now() - startTime,
            },
          };
        }
      }

      // Call LLM to select agent type
      const decision = await this.selectAgentType(truncatedDesc);
      decision.latencyMs = Date.now() - startTime;
      decision.cached = false;

      // Apply confidence threshold
      if (decision.confidence < this.config.confidenceThreshold) {
        log.debug('Low confidence dispatch, using fallback', {
          confidence: decision.confidence,
          threshold: this.config.confidenceThreshold,
          selectedType: decision.agentType,
          fallbackType: this.config.fallbackAgentType,
        });
        decision.agentType = this.config.fallbackAgentType;
        decision.reasoning = `Low confidence (${decision.confidence.toFixed(2)}), using fallback agent`;
      }

      // Cache the decision
      if (this.config.cacheEnabled) {
        this.cacheDecision(truncatedDesc, decision);
      }

      log.info('Task dispatched', {
        agentType: decision.agentType,
        confidence: decision.confidence,
        latencyMs: decision.latencyMs,
      });

      return { success: true, decision };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Dispatch failed, using fallback', { error: errorMessage });

      return {
        success: true,
        decision: {
          agentType: this.config.fallbackAgentType,
          confidence: 0,
          reasoning: `Dispatch failed: ${errorMessage}. Using fallback agent.`,
          cached: false,
          latencyMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Select the best agent type for a task description using LLM
   */
  async selectAgentType(description: string): Promise<DispatchDecision> {
    if (!this.provider) {
      throw new Error('No provider available');
    }

    const response = await this.provider.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: description },
      ],
      {
        maxTokens: 100,
        temperature: 0,
      }
    );

    return this.parseResponse(response.content);
  }

  /**
   * Parse the LLM response into a DispatchDecision
   */
  private parseResponse(content: string): DispatchDecision {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        agentType?: string;
        confidence?: number;
        reasoning?: string;
      };

      // Validate required fields
      if (!parsed.agentType || typeof parsed.agentType !== 'string') {
        throw new Error('Invalid or missing agentType');
      }

      const validAgentTypes = [
        'coder', 'researcher', 'tester', 'reviewer', 'adversarial',
        'architect', 'coordinator', 'analyst', 'devops', 'documentation',
        'security-auditor',
      ];

      // Normalize agent type
      const normalizedType = parsed.agentType.toLowerCase().replace(/[_\s]/g, '-');
      const agentType = validAgentTypes.includes(normalizedType)
        ? normalizedType
        : this.config.fallbackAgentType;

      return {
        agentType,
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
        reasoning: typeof parsed.reasoning === 'string'
          ? parsed.reasoning
          : 'No reasoning provided',
        cached: false,
        latencyMs: 0,
      };
    } catch (error) {
      log.warn('Failed to parse LLM response', {
        content,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        agentType: this.config.fallbackAgentType,
        confidence: 0,
        reasoning: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
        cached: false,
        latencyMs: 0,
      };
    }
  }

  /**
   * Get a cached decision if available and not expired
   */
  private getCachedDecision(description: string): DispatchDecision | null {
    const key = this.getCacheKey(description);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.decision;
  }

  /**
   * Cache a dispatch decision
   */
  private cacheDecision(description: string, decision: DispatchDecision): void {
    const key = this.getCacheKey(description);
    this.cache.set(key, {
      decision,
      expiresAt: Date.now() + this.config.cacheTTLMs,
    });

    // Clean up old entries periodically
    if (this.cache.size > 1000) {
      this.cleanCache();
    }
  }

  /**
   * Generate a cache key from a description using FNV-1a hash
   * FNV-1a provides better distribution and fewer collisions than simple hash
   */
  private getCacheKey(description: string): string {
    // FNV-1a 32-bit hash parameters
    const FNV_PRIME = 0x01000193;
    const FNV_OFFSET_BASIS = 0x811c9dc5;

    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < description.length; i++) {
      hash ^= description.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }

    // Convert to unsigned 32-bit and then to hex for readable key
    const unsignedHash = hash >>> 0;
    return `dispatch:${unsignedHash.toString(16)}`;
  }

  /**
   * Clean expired cache entries
   */
  private cleanCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.cache.clear();
    log.debug('Dispatch cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.config.cacheEnabled,
    };
  }
}

// Singleton instance
let instance: SmartDispatcher | null = null;
let instanceConfig: SmartDispatcherConfig | null = null;

/**
 * Get or create the smart dispatcher instance
 */
export function getSmartDispatcher(
  config: AgentStackConfig,
  forceNew: boolean = false
): SmartDispatcher {
  const newConfig = config.smartDispatcher;

  if (forceNew || !instance || !configEquals(instanceConfig, newConfig)) {
    instance = new SmartDispatcher(config);
    instanceConfig = newConfig ? { ...newConfig } : null;
  }

  return instance;
}

/**
 * Compare two smart dispatcher configs for equality
 */
function configEquals(
  a: SmartDispatcherConfig | null | undefined,
  b: SmartDispatcherConfig | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.enabled === b.enabled &&
    a.cacheEnabled === b.cacheEnabled &&
    a.cacheTTLMs === b.cacheTTLMs &&
    a.confidenceThreshold === b.confidenceThreshold &&
    a.fallbackAgentType === b.fallbackAgentType &&
    a.maxDescriptionLength === b.maxDescriptionLength &&
    a.dispatchModel === b.dispatchModel
  );
}

/**
 * Reset the smart dispatcher instance
 */
export function resetSmartDispatcher(): void {
  instance = null;
  instanceConfig = null;
}
