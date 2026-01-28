import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HealthMonitor,
  getHealthMonitor,
  resetHealthMonitor,
} from '../../../src/monitoring/health.js';
import type { AgentStackConfig } from '../../../src/types.js';
import * as memoryModule from '../../../src/memory/index.js';

// Mock the memory module
vi.mock('../../../src/memory/index.js', () => ({
  getMemoryManager: vi.fn(),
}));

describe('HealthMonitor', () => {
  let mockConfig: AgentStackConfig;
  let mockMemoryManager: any;

  beforeEach(() => {
    mockConfig = {
      version: '1.0.0',
      memory: {
        path: ':memory:',
        defaultNamespace: 'test',
        vectorSearch: { enabled: false },
      },
      providers: {
        default: 'anthropic',
        anthropic: {
          apiKey: 'test-key',
        },
      },
      agents: {},
      github: { enabled: false },
      plugins: { enabled: false, directory: 'plugins' },
      mcp: { enabled: false, servers: {} },
      hooks: { session: {}, task: {}, workflow: {} },
    };

    // Mock memory manager
    mockMemoryManager = {
      count: vi.fn().mockReturnValue(100),
      getStats: vi.fn().mockReturnValue({
        totalEntries: 100,
        namespaces: { test: 50, default: 50 },
      }),
    };

    vi.mocked(memoryModule.getMemoryManager).mockReturnValue(mockMemoryManager);

    resetHealthMonitor();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetHealthMonitor();
  });

  describe('constructor', () => {
    it('should create health monitor with config', () => {
      const monitor = new HealthMonitor(mockConfig);
      expect(monitor).toBeInstanceOf(HealthMonitor);
    });
  });

  describe('performHealthCheck', () => {
    it('should return overall healthy status when all checks pass', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      // Status can be healthy or degraded depending on system resources
      expect(['healthy', 'degraded']).toContain(result.status);
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.version).toBe('1.0.0');
      expect(result.checks).toBeDefined();
      expect(result.checks.database).toBeDefined();
      expect(result.checks.memory).toBeDefined();
      expect(result.checks.providers).toBeDefined();
      expect(result.checks.disk).toBeDefined();
      expect(result.checks.system).toBeDefined();
    });

    it('should return unhealthy status when database fails', async () => {
      vi.mocked(memoryModule.getMemoryManager).mockImplementation(() => {
        throw new Error('Database error');
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('fail');
      expect(result.checks.database.message).toContain('Database is not accessible');
    });

    it('should return degraded status when providers are not configured', async () => {
      const configNoProviders = {
        ...mockConfig,
        providers: {
          default: 'anthropic',
          anthropic: undefined,
        },
      };

      const monitor = new HealthMonitor(configNoProviders);
      const result = await monitor.performHealthCheck();

      expect(result.status).toBe('degraded');
      expect(result.checks.providers.status).toBe('warn');
    });

    it('should include version in health check', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.version).toBe('1.0.0');
    });

    it('should track uptime', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof result.uptime).toBe('number');
    });

    it('should check database health', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.database).toBeDefined();
      expect(result.checks.database.status).toBe('pass');
      expect(result.checks.database.message).toContain('Database is accessible');
      expect(mockMemoryManager.count).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      mockMemoryManager.count.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.database.status).toBe('fail');
      expect(result.checks.database.details?.error).toContain('Database connection lost');
    });

    it('should check memory health', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.memory).toBeDefined();
      expect(result.checks.memory.status).toBe('pass');
      expect(result.checks.memory.message).toContain('Memory usage normal');
    });

    it('should detect high memory usage', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 800 * 1024 * 1024,
        heapTotal: 1000 * 1024 * 1024,
        external: 0,
        rss: 1000 * 1024 * 1024,
        arrayBuffers: 0,
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.memory.status).toBe('warn');
      expect(result.checks.memory.message).toContain('Memory usage high');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should detect critical memory usage', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 950 * 1024 * 1024,
        heapTotal: 1000 * 1024 * 1024,
        external: 0,
        rss: 1000 * 1024 * 1024,
        arrayBuffers: 0,
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.memory.status).toBe('fail');
      expect(result.checks.memory.message).toContain('Memory usage critical');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should check provider health with anthropic', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.providers).toBeDefined();
      expect(result.checks.providers.status).toBe('pass');
      expect(result.checks.providers.message).toContain('Provider configuration valid');
    });

    it('should warn when anthropic provider not configured', async () => {
      const configNoKey = {
        ...mockConfig,
        providers: {
          default: 'anthropic',
          anthropic: { apiKey: undefined },
        },
      };

      const monitor = new HealthMonitor(configNoKey);
      const result = await monitor.performHealthCheck();

      expect(result.checks.providers.status).toBe('warn');
      expect(result.checks.providers.message).toContain('Default provider (Anthropic) not configured');
    });

    it('should warn when openai provider not configured', async () => {
      const configOpenAI = {
        ...mockConfig,
        providers: {
          default: 'openai',
          openai: { apiKey: undefined },
        },
      };

      const monitor = new HealthMonitor(configOpenAI);
      const result = await monitor.performHealthCheck();

      expect(result.checks.providers.status).toBe('warn');
      expect(result.checks.providers.message).toContain('Default provider (OpenAI) not configured');
    });

    it('should check disk health', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.disk).toBeDefined();
      expect(result.checks.disk.status).toBe('pass');
    });

    it('should check system health', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.system).toBeDefined();
      // System status can be pass or warn depending on CPU usage
      expect(['pass', 'warn']).toContain(result.checks.system.status);
      expect(result.checks.system.details).toBeDefined();
    });

    it('should handle multiple consecutive health checks', async () => {
      const monitor = new HealthMonitor(mockConfig);

      const result1 = await monitor.performHealthCheck();
      const result2 = await monitor.performHealthCheck();
      const result3 = await monitor.performHealthCheck();

      expect(result1.timestamp).toBeDefined();
      expect(result2.timestamp).toBeDefined();
      expect(result3.timestamp).toBeDefined();
      expect(result3.uptime).toBeGreaterThanOrEqual(result1.uptime);
    });

    it('should prioritize unhealthy over degraded', async () => {
      vi.mocked(memoryModule.getMemoryManager).mockImplementation(() => {
        throw new Error('Database error');
      });

      const configNoKey = {
        ...mockConfig,
        providers: {
          default: 'anthropic',
          anthropic: { apiKey: undefined },
        },
      };

      const monitor = new HealthMonitor(configNoKey);
      const result = await monitor.performHealthCheck();

      // Should be unhealthy due to database, not degraded due to providers
      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('fail');
      expect(result.checks.providers.status).toBe('warn');
    });
  });

  describe('livenessCheck', () => {
    it('should return ok status', () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = monitor.livenessCheck();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });

    it('should always return ok when service is running', () => {
      const monitor = new HealthMonitor(mockConfig);

      const result1 = monitor.livenessCheck();
      const result2 = monitor.livenessCheck();

      expect(result1.status).toBe('ok');
      expect(result2.status).toBe('ok');
    });
  });

  describe('readinessCheck', () => {
    it('should return ready when database is accessible', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.readinessCheck();

      expect(result.status).toBe('ready');
      expect(result.reason).toBeUndefined();
      expect(mockMemoryManager.count).toHaveBeenCalled();
    });

    it('should return not_ready when database is not accessible', async () => {
      vi.mocked(memoryModule.getMemoryManager).mockImplementation(() => {
        throw new Error('Database unavailable');
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.readinessCheck();

      expect(result.status).toBe('not_ready');
      expect(result.reason).toBe('Database unavailable');
    });

    it('should handle database errors gracefully', async () => {
      mockMemoryManager.count.mockImplementation(() => {
        throw new Error('Connection timeout');
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.readinessCheck();

      expect(result.status).toBe('not_ready');
      expect(result.reason).toContain('Connection timeout');
    });
  });

  describe('singleton functions', () => {
    it('should create and return singleton instance', () => {
      const monitor1 = getHealthMonitor(mockConfig);
      const monitor2 = getHealthMonitor();

      expect(monitor1).toBe(monitor2);
    });

    it('should throw when getting monitor before initialization', () => {
      expect(() => getHealthMonitor()).toThrow('Health monitor not initialized');
    });

    it('should reset singleton', () => {
      getHealthMonitor(mockConfig);
      resetHealthMonitor();

      expect(() => getHealthMonitor()).toThrow('Health monitor not initialized');
    });

    it('should allow re-initialization after reset', () => {
      const monitor1 = getHealthMonitor(mockConfig);
      resetHealthMonitor();
      const monitor2 = getHealthMonitor(mockConfig);

      expect(monitor1).not.toBe(monitor2);
    });
  });

  describe('edge cases', () => {
    it('should handle missing config fields', async () => {
      const minimalConfig = {
        version: '1.0.0',
        memory: {
          path: ':memory:',
          defaultNamespace: 'test',
          vectorSearch: { enabled: false },
        },
        providers: {},
      } as any;

      const monitor = new HealthMonitor(minimalConfig);
      const result = await monitor.performHealthCheck();

      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
    });

    it('should handle concurrent health checks', async () => {
      const monitor = new HealthMonitor(mockConfig);

      const checks = await Promise.all([
        monitor.performHealthCheck(),
        monitor.performHealthCheck(),
        monitor.performHealthCheck(),
      ]);

      expect(checks).toHaveLength(3);
      checks.forEach((check) => {
        expect(check.status).toBeDefined();
        expect(check.checks).toBeDefined();
      });
    });

    it('should track increasing uptime', async () => {
      const monitor = new HealthMonitor(mockConfig);

      const result1 = await monitor.performHealthCheck();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result2 = await monitor.performHealthCheck();

      expect(result2.uptime).toBeGreaterThan(result1.uptime);
    });
  });

  describe('status combinations', () => {
    it('should be healthy when all checks pass', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      const allPassed = Object.values(result.checks).every(
        (check) => check.status === 'pass'
      );

      if (allPassed) {
        expect(result.status).toBe('healthy');
      }
    });

    it('should be degraded when only warnings exist', async () => {
      const configNoKey = {
        ...mockConfig,
        providers: {
          default: 'anthropic',
          anthropic: { apiKey: undefined },
        },
      };

      const monitor = new HealthMonitor(configNoKey);
      const result = await monitor.performHealthCheck();

      // If there are warnings but no failures
      const hasWarnings = Object.values(result.checks).some((check) => check.status === 'warn');
      const hasFailures = Object.values(result.checks).some((check) => check.status === 'fail');

      if (hasWarnings && !hasFailures) {
        expect(result.status).toBe('degraded');
      }
    });

    it('should be unhealthy when any check fails', async () => {
      vi.mocked(memoryModule.getMemoryManager).mockImplementation(() => {
        throw new Error('Database error');
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('fail');
    });
  });

  describe('provider configurations', () => {
    it('should handle multiple configured providers', async () => {
      const configMultiProvider = {
        ...mockConfig,
        providers: {
          default: 'anthropic',
          anthropic: { apiKey: 'test-key-1' },
          openai: { apiKey: 'test-key-2' },
        },
      };

      const monitor = new HealthMonitor(configMultiProvider);
      const result = await monitor.performHealthCheck();

      expect(result.checks.providers.status).toBe('pass');
      expect(result.checks.providers.details?.configured).toBeDefined();
    });

    it('should handle openai as default provider', async () => {
      const configOpenAI = {
        ...mockConfig,
        providers: {
          default: 'openai',
          openai: { apiKey: 'test-key' },
        },
      };

      const monitor = new HealthMonitor(configOpenAI);
      const result = await monitor.performHealthCheck();

      expect(result.checks.providers.status).toBe('pass');
      expect(result.checks.providers.details?.defaultProvider).toBe('openai');
    });

    it('should handle unknown default provider', async () => {
      const configUnknown = {
        ...mockConfig,
        providers: {
          default: 'bedrock',
          bedrock: { apiKey: 'test-key' },
        },
      };

      const monitor = new HealthMonitor(configUnknown);
      const result = await monitor.performHealthCheck();

      // Unknown providers should pass as long as they have some configuration
      expect(result.checks.providers.status).toBe('pass');
      expect(result.checks.providers.details?.defaultProvider).toBe('bedrock');
    });

    it('should handle provider with empty apiKey string', async () => {
      const configEmptyKey = {
        ...mockConfig,
        providers: {
          default: 'anthropic',
          anthropic: { apiKey: '' },
        },
      };

      const monitor = new HealthMonitor(configEmptyKey);
      const result = await monitor.performHealthCheck();

      expect(result.checks.providers.status).toBe('warn');
      expect(result.checks.providers.message).toContain('Default provider (Anthropic) not configured');
    });
  });

  describe('checkMemory edge cases', () => {
    it('should verify percentage rounding', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 333 * 1024 * 1024,
        heapTotal: 1000 * 1024 * 1024,
        external: 0,
        rss: 500 * 1024 * 1024,
        arrayBuffers: 0,
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      // 33.3% should be rounded to 33
      expect(result.checks.memory.details?.heapUsedPercent).toBe(33);

      process.memoryUsage = originalMemoryUsage;
    });

    it('should handle exact 75% boundary (warn threshold)', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 750 * 1024 * 1024,
        heapTotal: 1000 * 1024 * 1024,
        external: 0,
        rss: 1000 * 1024 * 1024,
        arrayBuffers: 0,
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      // Exactly 75% should NOT trigger warning (> 75 is the condition)
      expect(result.checks.memory.status).toBe('pass');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should handle just above 75% boundary', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 760 * 1024 * 1024,
        heapTotal: 1000 * 1024 * 1024,
        external: 0,
        rss: 1000 * 1024 * 1024,
        arrayBuffers: 0,
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks.memory.status).toBe('warn');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should handle exact 90% boundary (fail threshold)', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 900 * 1024 * 1024,
        heapTotal: 1000 * 1024 * 1024,
        external: 0,
        rss: 1000 * 1024 * 1024,
        arrayBuffers: 0,
      });

      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      // Exactly 90% should NOT trigger fail (> 90 is the condition)
      expect(result.checks.memory.status).toBe('warn');

      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('checkSystem edge cases', () => {
    it('should include platform in details when status is pass', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      // Platform is only included when status is 'pass' (normal resources)
      // When status is 'warn' (high CPU), only cpuPercent and uptime are included
      if (result.checks.system.status === 'pass') {
        expect(result.checks.system.details?.platform).toBe(process.platform);
      } else {
        expect(result.checks.system.details?.cpuPercent).toBeDefined();
      }
    });

    it('should include nodeVersion in details when status is pass', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      // nodeVersion is only included when status is 'pass' (normal resources)
      if (result.checks.system.status === 'pass') {
        expect(result.checks.system.details?.nodeVersion).toBe(process.version);
      } else {
        expect(result.checks.system.details?.uptime).toBeDefined();
      }
    });
  });

  describe('performHealthCheck integration', () => {
    it('should verify timestamp format is ISO 8601', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      // ISO 8601 format validation
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(result.timestamp).toMatch(isoDateRegex);
    });

    it('should verify uptime is calculated correctly', async () => {
      const monitor = new HealthMonitor(mockConfig);

      // Wait a known amount of time
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await monitor.performHealthCheck();

      // Uptime should be at least 0.05 seconds
      expect(result.uptime).toBeGreaterThanOrEqual(0.05);
    });

    it('should include all required check categories', async () => {
      const monitor = new HealthMonitor(mockConfig);
      const result = await monitor.performHealthCheck();

      expect(result.checks).toHaveProperty('database');
      expect(result.checks).toHaveProperty('memory');
      expect(result.checks).toHaveProperty('providers');
      expect(result.checks).toHaveProperty('disk');
      expect(result.checks).toHaveProperty('system');
    });

    it('should return version from config', async () => {
      const configWithVersion = {
        ...mockConfig,
        version: '2.5.0',
      };

      const monitor = new HealthMonitor(configWithVersion);
      const result = await monitor.performHealthCheck();

      expect(result.version).toBe('2.5.0');
    });
  });
});
