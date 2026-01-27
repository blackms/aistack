/**
 * Resource Exhaustion Service - monitors and prevents runaway agents
 */

import { randomUUID } from 'node:crypto';
import type { SQLiteStore } from '../memory/sqlite-store.js';
import type {
  AgentResourceMetrics,
  ResourceExhaustionConfig,
  ResourceExhaustionPhase,
  ResourceExhaustionAction,
  ResourceExhaustionEvent,
  ResourceThresholds,
  DeliverableType,
  DeliverableCheckpoint,
} from '../types.js';
import { logger } from '../utils/logger.js';
import { getMetricsCollector } from './metrics.js';

const log = logger.child('resource-exhaustion');

export interface ResourceExhaustionMetricsSummary {
  totalAgentsTracked: number;
  agentsByPhase: Record<ResourceExhaustionPhase, number>;
  pausedAgents: number;
  totalWarnings: number;
  totalInterventions: number;
  totalTerminations: number;
  recentEvents: ResourceExhaustionEvent[];
}

/**
 * Service for tracking and managing agent resource consumption
 */
export class ResourceExhaustionService {
  private store: SQLiteStore;
  private config: ResourceExhaustionConfig;
  private metricsCache: Map<string, AgentResourceMetrics> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private pauseCallbacks: Map<string, (resume: boolean) => void> = new Map();
  private agentTypes: Map<string, string> = new Map(); // agentId -> agentType

  constructor(store: SQLiteStore, config: ResourceExhaustionConfig) {
    this.store = store;
    this.config = config;

    // Load existing metrics from database on startup
    if (this.isEnabled()) {
      this.loadMetricsFromDatabase();
    }
  }

  /**
   * Check if the service is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): ResourceExhaustionConfig {
    return { ...this.config };
  }

  /**
   * Initialize tracking for a new agent
   */
  initializeAgent(agentId: string, agentType: string): AgentResourceMetrics {
    const now = new Date();
    const metrics: AgentResourceMetrics = {
      agentId,
      filesRead: 0,
      filesWritten: 0,
      filesModified: 0,
      apiCallsCount: 0,
      subtasksSpawned: 0,
      tokensConsumed: 0,
      startedAt: now,
      lastDeliverableAt: null,
      lastActivityAt: now,
      phase: 'normal',
      pausedAt: null,
      pauseReason: null,
    };

    this.metricsCache.set(agentId, metrics);
    this.agentTypes.set(agentId, agentType);

    // Persist to database
    this.store.saveAgentResourceMetrics(metrics);

    log.debug('Initialized agent resource tracking', { agentId, agentType });

    return metrics;
  }

  /**
   * Record a file operation
   */
  recordFileOperation(agentId: string, op: 'read' | 'write' | 'modify'): void {
    if (!this.isEnabled()) return;

    const metrics = this.getOrCreateMetrics(agentId);
    if (!metrics) return;

    switch (op) {
      case 'read':
        metrics.filesRead++;
        break;
      case 'write':
        metrics.filesWritten++;
        break;
      case 'modify':
        metrics.filesModified++;
        break;
    }

    metrics.lastActivityAt = new Date();
    this.updateMetrics(agentId, metrics);

    // Update Prometheus metrics
    const collector = getMetricsCollector();
    collector.observeHistogram('agent_files_accessed', this.getTotalFilesAccessed(metrics));
  }

  /**
   * Record an API call
   */
  recordApiCall(agentId: string, tokens?: number): void {
    if (!this.isEnabled()) return;

    const metrics = this.getOrCreateMetrics(agentId);
    if (!metrics) return;

    metrics.apiCallsCount++;
    if (tokens) {
      metrics.tokensConsumed += tokens;
    }
    metrics.lastActivityAt = new Date();

    this.updateMetrics(agentId, metrics);

    // Update Prometheus metrics
    const collector = getMetricsCollector();
    collector.observeHistogram('agent_api_calls', metrics.apiCallsCount);
    if (tokens) {
      collector.observeHistogram('agent_tokens_consumed', metrics.tokensConsumed);
    }
  }

  /**
   * Record a subtask spawn
   */
  recordSubtaskSpawn(agentId: string): void {
    if (!this.isEnabled()) return;

    const metrics = this.getOrCreateMetrics(agentId);
    if (!metrics) return;

    metrics.subtasksSpawned++;
    metrics.lastActivityAt = new Date();

    this.updateMetrics(agentId, metrics);
  }

  /**
   * Record a deliverable checkpoint
   */
  recordDeliverable(
    agentId: string,
    type: DeliverableType,
    description?: string,
    artifacts?: string[]
  ): DeliverableCheckpoint {
    const metrics = this.getOrCreateMetrics(agentId);
    const now = new Date();

    // Create checkpoint
    const checkpoint = this.store.createDeliverableCheckpoint({
      id: randomUUID(),
      agentId,
      type,
      description,
      artifacts,
    });

    // Update metrics
    if (metrics) {
      metrics.lastDeliverableAt = now;
      metrics.lastActivityAt = now;

      // Reset phase to normal if we were in warning
      if (metrics.phase === 'warning') {
        metrics.phase = 'normal';
      }

      this.updateMetrics(agentId, metrics);
    }

    log.info('Recorded deliverable checkpoint', { agentId, type, description });

    return checkpoint;
  }

  /**
   * Evaluate agent's current phase based on resource consumption
   */
  evaluateAgent(agentId: string): ResourceExhaustionPhase {
    if (!this.isEnabled()) return 'normal';

    const metrics = this.metricsCache.get(agentId);
    if (!metrics) return 'normal';

    const thresholds = this.config.thresholds;
    const warningPercent = this.config.warningThresholdPercent;

    // Check each threshold
    const checks: Array<{ key: keyof ResourceThresholds; value: number; max: number }> = [
      { key: 'maxFilesAccessed', value: this.getTotalFilesAccessed(metrics), max: thresholds.maxFilesAccessed },
      { key: 'maxApiCalls', value: metrics.apiCallsCount, max: thresholds.maxApiCalls },
      { key: 'maxSubtasksSpawned', value: metrics.subtasksSpawned, max: thresholds.maxSubtasksSpawned },
      { key: 'maxTokensConsumed', value: metrics.tokensConsumed, max: thresholds.maxTokensConsumed },
    ];

    // Check time without deliverable
    const timeSinceDeliverable = metrics.lastDeliverableAt
      ? Date.now() - metrics.lastDeliverableAt.getTime()
      : Date.now() - metrics.startedAt.getTime();

    checks.push({
      key: 'maxTimeWithoutDeliverableMs',
      value: timeSinceDeliverable,
      max: thresholds.maxTimeWithoutDeliverableMs,
    });

    // Determine phase based on highest threshold breach
    let newPhase: ResourceExhaustionPhase = 'normal';
    let triggeredBy: keyof ResourceThresholds | null = null;

    for (const check of checks) {
      const ratio = check.value / check.max;

      if (ratio >= 1) {
        // Exceeded threshold - intervention (upgrade from warning or normal)
        if (newPhase === 'normal' || newPhase === 'warning') {
          newPhase = 'intervention';
          triggeredBy = check.key;
        }
      } else if (ratio >= warningPercent) {
        // Warning threshold (only upgrade from normal)
        if (newPhase === 'normal') {
          newPhase = 'warning';
          triggeredBy = check.key;
        }
      }
    }

    // Handle phase transition
    if (newPhase !== metrics.phase) {
      this.handlePhaseTransition(agentId, metrics.phase, newPhase, triggeredBy!);
      metrics.phase = newPhase;
      this.updateMetrics(agentId, metrics);
    }

    return newPhase;
  }

  /**
   * Check all active agents
   */
  checkAllAgents(): void {
    if (!this.isEnabled()) return;

    for (const agentId of this.metricsCache.keys()) {
      this.evaluateAgent(agentId);
    }
  }

  /**
   * Pause an agent
   */
  async pauseAgent(agentId: string, reason: string): Promise<boolean> {
    const metrics = this.metricsCache.get(agentId);
    if (!metrics) return false;

    metrics.pausedAt = new Date();
    metrics.pauseReason = reason;
    this.updateMetrics(agentId, metrics);

    // Update Prometheus metrics
    const collector = getMetricsCollector();
    collector.setGauge('agents_paused_current', this.getPausedAgentCount());

    log.info('Agent paused', { agentId, reason });

    // If there's a pending callback (agent waiting to execute), resolve it with false
    const callback = this.pauseCallbacks.get(agentId);
    if (callback) {
      callback(false);
      this.pauseCallbacks.delete(agentId);
    }

    return true;
  }

  /**
   * Resume a paused agent
   */
  resumeAgent(agentId: string): boolean {
    const metrics = this.metricsCache.get(agentId);
    if (!metrics || !metrics.pausedAt) return false;

    metrics.pausedAt = null;
    metrics.pauseReason = null;

    // Reset phase to warning if it was at intervention
    if (metrics.phase === 'intervention') {
      metrics.phase = 'warning';
    }

    this.updateMetrics(agentId, metrics);

    // Update Prometheus metrics
    const collector = getMetricsCollector();
    collector.setGauge('agents_paused_current', this.getPausedAgentCount());

    log.info('Agent resumed', { agentId });

    return true;
  }

  /**
   * Check if an agent is paused
   */
  isAgentPaused(agentId: string): boolean {
    const metrics = this.metricsCache.get(agentId);
    return metrics?.pausedAt !== null;
  }

  /**
   * Terminate an agent due to resource exhaustion
   */
  terminateAgent(agentId: string, reason: string): boolean {
    const metrics = this.metricsCache.get(agentId);
    if (!metrics) return false;

    // Trigger termination phase transition
    this.handlePhaseTransition(agentId, metrics.phase, 'termination', 'maxTimeWithoutDeliverableMs');
    metrics.phase = 'termination';
    this.updateMetrics(agentId, metrics);

    log.info('Agent terminated', { agentId, reason });

    return true;
  }

  /**
   * Wait for an agent to be unpaused (returns true if resumed, false if terminated)
   */
  async waitForResume(agentId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.pauseCallbacks.set(agentId, resolve);
    });
  }

  /**
   * Get metrics for a specific agent
   */
  getAgentMetrics(agentId: string): AgentResourceMetrics | null {
    return this.metricsCache.get(agentId) ?? null;
  }

  /**
   * Get a summary of resource exhaustion metrics
   */
  getResourceMetrics(since?: Date): ResourceExhaustionMetricsSummary {
    const dbMetrics = this.store.getResourceExhaustionMetrics(since);
    const events = this.store.getResourceExhaustionEvents({ limit: 10, since });

    const agentsByPhase: Record<ResourceExhaustionPhase, number> = {
      normal: 0,
      warning: 0,
      intervention: 0,
      termination: 0,
    };

    for (const metrics of this.metricsCache.values()) {
      agentsByPhase[metrics.phase]++;
    }

    return {
      totalAgentsTracked: this.metricsCache.size,
      agentsByPhase,
      pausedAgents: this.getPausedAgentCount(),
      totalWarnings: dbMetrics.warningCount,
      totalInterventions: dbMetrics.interventionCount,
      totalTerminations: dbMetrics.terminationCount,
      recentEvents: events,
    };
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 10): ResourceExhaustionEvent[] {
    return this.store.getResourceExhaustionEvents({ limit });
  }

  /**
   * Start the background monitoring interval
   */
  start(): void {
    if (!this.isEnabled() || this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAllAgents();
    }, this.config.checkIntervalMs);

    log.info('Resource exhaustion monitoring started', {
      checkIntervalMs: this.config.checkIntervalMs,
    });
  }

  /**
   * Stop the background monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      log.info('Resource exhaustion monitoring stopped');
    }
  }

  /**
   * Clean up tracking for an agent
   */
  cleanupAgent(agentId: string): void {
    const metrics = this.metricsCache.get(agentId);

    // Update final histograms before cleanup
    if (metrics) {
      const collector = getMetricsCollector();
      collector.observeHistogram('agent_files_accessed', this.getTotalFilesAccessed(metrics));
      collector.observeHistogram('agent_api_calls', metrics.apiCallsCount);
      collector.observeHistogram('agent_tokens_consumed', metrics.tokensConsumed);
    }

    this.metricsCache.delete(agentId);
    this.agentTypes.delete(agentId);
    this.pauseCallbacks.delete(agentId);

    // Clean up from database
    this.store.deleteAgentResourceMetrics(agentId);
    this.store.deleteDeliverableCheckpoints(agentId);

    log.debug('Cleaned up agent resource tracking', { agentId });
  }

  // Private methods

  private getOrCreateMetrics(agentId: string): AgentResourceMetrics | null {
    let metrics = this.metricsCache.get(agentId);

    if (!metrics) {
      // Try to load from database
      metrics = this.store.getAgentResourceMetrics(agentId) ?? undefined;
      if (metrics) {
        this.metricsCache.set(agentId, metrics);
      }
    }

    return metrics ?? null;
  }

  private updateMetrics(agentId: string, metrics: AgentResourceMetrics): void {
    this.metricsCache.set(agentId, metrics);
    this.store.saveAgentResourceMetrics(metrics);
  }

  private getTotalFilesAccessed(metrics: AgentResourceMetrics): number {
    return metrics.filesRead + metrics.filesWritten + metrics.filesModified;
  }

  private getPausedAgentCount(): number {
    let count = 0;
    for (const metrics of this.metricsCache.values()) {
      if (metrics.pausedAt !== null) {
        count++;
      }
    }
    return count;
  }

  private loadMetricsFromDatabase(): void {
    const savedMetrics = this.store.listAgentResourceMetrics();
    for (const metrics of savedMetrics) {
      this.metricsCache.set(metrics.agentId, metrics);
    }
    log.debug('Loaded metrics from database', { count: savedMetrics.length });
  }

  private handlePhaseTransition(
    agentId: string,
    oldPhase: ResourceExhaustionPhase,
    newPhase: ResourceExhaustionPhase,
    triggeredBy: keyof ResourceThresholds
  ): void {
    const metrics = this.metricsCache.get(agentId);
    if (!metrics) return;

    const agentType = this.agentTypes.get(agentId) ?? 'unknown';
    let action: ResourceExhaustionAction = 'allowed';

    // Update Prometheus metrics
    const collector = getMetricsCollector();

    if (newPhase === 'warning') {
      action = 'warned';
      collector.incrementCounter('resource_exhaustion_warnings_total');
      log.warn('Agent approaching resource limits', {
        agentId,
        agentType,
        triggeredBy,
        phase: newPhase,
      });
    } else if (newPhase === 'intervention') {
      action = 'paused';
      collector.incrementCounter('resource_exhaustion_interventions_total');
      log.error('Agent exceeded resource limits', {
        agentId,
        agentType,
        triggeredBy,
        phase: newPhase,
      });

      // Auto-pause if configured
      if (this.config.pauseOnIntervention) {
        this.pauseAgent(agentId, `Resource threshold exceeded: ${triggeredBy}`);
      }
    } else if (newPhase === 'termination') {
      action = 'terminated';
      collector.incrementCounter('resource_exhaustion_terminations_total');
      log.error('Agent terminated due to resource exhaustion', {
        agentId,
        agentType,
        triggeredBy,
        phase: newPhase,
      });
    }

    // Log event to database
    const event: ResourceExhaustionEvent = {
      id: randomUUID(),
      agentId,
      agentType,
      phase: newPhase,
      actionTaken: action,
      metrics: { ...metrics },
      thresholds: { ...this.config.thresholds },
      triggeredBy,
      createdAt: new Date(),
    };

    this.store.saveResourceExhaustionEvent(event);
  }
}

// Singleton management
let instance: ResourceExhaustionService | null = null;
let lastConfig: ResourceExhaustionConfig | null = null;

/**
 * Get or create the ResourceExhaustionService singleton
 */
export function getResourceExhaustionService(
  store: SQLiteStore,
  config: ResourceExhaustionConfig,
  forceNew: boolean = false
): ResourceExhaustionService {
  // Check if config has changed
  const configChanged = lastConfig !== null && (
    lastConfig.enabled !== config.enabled ||
    lastConfig.warningThresholdPercent !== config.warningThresholdPercent ||
    lastConfig.checkIntervalMs !== config.checkIntervalMs ||
    lastConfig.autoTerminate !== config.autoTerminate ||
    lastConfig.pauseOnIntervention !== config.pauseOnIntervention ||
    JSON.stringify(lastConfig.thresholds) !== JSON.stringify(config.thresholds)
  );

  if (!instance || forceNew || configChanged) {
    // Stop existing instance if any
    if (instance) {
      instance.stop();
    }

    instance = new ResourceExhaustionService(store, config);
    lastConfig = { ...config };

    // Start monitoring if enabled
    if (config.enabled) {
      instance.start();
    }
  }

  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetResourceExhaustionService(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
  lastConfig = null;
}
