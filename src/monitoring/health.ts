/**
 * Enhanced health check system
 */

import { logger } from '../utils/logger.js';
import type { AgentStackConfig } from '../types.js';
import { getMemoryManager } from '../memory/index.js';

const log = logger.child('health');

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: HealthCheck;
    memory: HealthCheck;
    providers: HealthCheck;
    disk: HealthCheck;
    system: HealthCheck;
  };
  timestamp: string;
  uptime: number;
  version: string;
}

export interface HealthCheck {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  details?: Record<string, unknown>;
}

export class HealthMonitor {
  private config: AgentStackConfig;
  private startTime: number = Date.now();

  constructor(config: AgentStackConfig) {
    this.config = config;
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkMemory(),
      this.checkProviders(),
      this.checkDisk(),
      this.checkSystem(),
    ]);

    const [database, memory, providers, disk, system] = checks;

    // Determine overall status
    const hasFailures = Object.values({ database, memory, providers, disk, system }).some(
      (check) => check.status === 'fail'
    );
    const hasWarnings = Object.values({ database, memory, providers, disk, system }).some(
      (check) => check.status === 'warn'
    );

    const overallStatus = hasFailures ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy';

    const result: HealthCheckResult = {
      status: overallStatus,
      checks: { database, memory, providers, disk, system },
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000,
      version: this.config.version,
    };

    log.debug('Health check completed', { status: overallStatus });
    return result;
  }

  /**
   * Check database health
   */
  private async checkDatabase(): Promise<HealthCheck> {
    try {
      const manager = getMemoryManager(this.config);
      const count = manager.count();

      return {
        status: 'pass',
        message: 'Database is accessible',
        details: {
          entries: count,
          path: this.config.memory.path,
        },
      };
    } catch (error) {
      log.error('Database health check failed', { error });
      return {
        status: 'fail',
        message: 'Database is not accessible',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Check memory health
   */
  private async checkMemory(): Promise<HealthCheck> {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    if (heapUsedPercent > 90) {
      return {
        status: 'fail',
        message: 'Memory usage critical',
        details: {
          heapUsedPercent: Math.round(heapUsedPercent),
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
        },
      };
    }

    if (heapUsedPercent > 75) {
      return {
        status: 'warn',
        message: 'Memory usage high',
        details: {
          heapUsedPercent: Math.round(heapUsedPercent),
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
        },
      };
    }

    return {
      status: 'pass',
      message: 'Memory usage normal',
      details: {
        heapUsedPercent: Math.round(heapUsedPercent),
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external,
      },
    };
  }

  /**
   * Check provider health
   */
  private async checkProviders(): Promise<HealthCheck> {
    const providers = this.config.providers;
    const defaultProvider = providers.default;

    // Check if default provider is configured
    if (defaultProvider === 'anthropic' && !providers.anthropic?.apiKey) {
      return {
        status: 'warn',
        message: 'Default provider (Anthropic) not configured',
        details: { defaultProvider },
      };
    }

    if (defaultProvider === 'openai' && !providers.openai?.apiKey) {
      return {
        status: 'warn',
        message: 'Default provider (OpenAI) not configured',
        details: { defaultProvider },
      };
    }

    return {
      status: 'pass',
      message: 'Provider configuration valid',
      details: {
        defaultProvider,
        configured: Object.keys(providers).filter(
          (k) => k !== 'default' && providers[k as keyof typeof providers]
        ),
      },
    };
  }

  /**
   * Check disk health (simplified)
   */
  private async checkDisk(): Promise<HealthCheck> {
    // Note: For a more complete implementation, use a library like 'diskusage'
    // This is a simplified version
    return {
      status: 'pass',
      message: 'Disk space check not implemented',
      details: {
        note: 'Implement with diskusage library for production',
      },
    };
  }

  /**
   * Check system health
   */
  private async checkSystem(): Promise<HealthCheck> {
    const cpuUsage = process.cpuUsage();
    const uptime = (Date.now() - this.startTime) / 1000;

    // Calculate CPU percentage
    const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000 / uptime) * 100;

    if (cpuPercent > 90) {
      return {
        status: 'warn',
        message: 'High CPU usage detected',
        details: {
          cpuPercent: Math.round(cpuPercent),
          uptime,
        },
      };
    }

    return {
      status: 'pass',
      message: 'System resources normal',
      details: {
        cpuPercent: Math.round(cpuPercent),
        uptime,
        platform: process.platform,
        nodeVersion: process.version,
      },
    };
  }

  /**
   * Simple liveness check (always returns healthy if service is running)
   */
  livenessCheck(): { status: 'ok'; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness check (checks if service is ready to accept requests)
   */
  async readinessCheck(): Promise<{ status: 'ready' | 'not_ready'; reason?: string }> {
    try {
      // Check database connectivity
      const manager = getMemoryManager(this.config);
      manager.count();

      return { status: 'ready' };
    } catch (error) {
      return {
        status: 'not_ready',
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Singleton instance
let instance: HealthMonitor | null = null;

export function getHealthMonitor(config?: AgentStackConfig): HealthMonitor {
  if (!instance && config) {
    instance = new HealthMonitor(config);
  }
  if (!instance) {
    throw new Error('Health monitor not initialized');
  }
  return instance;
}

export function resetHealthMonitor(): void {
  instance = null;
}
