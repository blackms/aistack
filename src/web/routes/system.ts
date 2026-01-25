/**
 * System routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { listAgents, getAgentsByStatus } from '../../agents/index.js';
import { getMemoryManager } from '../../memory/index.js';
import type { SystemStatus, HealthCheck } from '../types.js';

// Server start time for uptime calculation
const serverStartTime = Date.now();

export function registerSystemRoutes(router: Router, config: AgentStackConfig): void {
  // GET /api/v1/system/status - Get system status
  router.get('/api/v1/system/status', (_req, res) => {
    const agents = listAgents();
    const byStatus: Record<string, number> = {};

    for (const agent of agents) {
      byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
    }

    // Get task queue status (simplified)
    let tasksQueued = 0;
    let tasksProcessing = 0;
    try {
      const manager = getMemoryManager(config);
      const pendingTasks = manager.listTasks(undefined, 'pending');
      const runningTasks = manager.listTasks(undefined, 'running');
      tasksQueued = pendingTasks.length;
      tasksProcessing = runningTasks.length;
    } catch {
      // Memory manager might not be initialized
    }

    // Get active sessions
    let activeSessions = 0;
    try {
      const manager = getMemoryManager(config);
      const activeSession = manager.getActiveSession();
      activeSessions = activeSession ? 1 : 0;
    } catch {
      // Memory manager might not be initialized
    }

    const memUsage = process.memoryUsage();

    const status: SystemStatus = {
      version: '1.0.0',
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
      },
      agents: {
        active: agents.length,
        byStatus,
      },
      tasks: {
        queued: tasksQueued,
        processing: tasksProcessing,
      },
      sessions: {
        active: activeSessions,
      },
    };

    sendJson(res, status);
  });

  // GET /api/v1/system/health - Health check
  router.get('/api/v1/system/health', (_req, res) => {
    let databaseOk = false;
    let memoryOk = false;
    let providersOk = true; // Assume OK for now

    try {
      const manager = getMemoryManager(config);
      // Try a simple operation
      manager.count();
      databaseOk = true;
      memoryOk = true;
    } catch {
      // Database/memory not working
    }

    const allOk = databaseOk && memoryOk && providersOk;
    const someOk = databaseOk || memoryOk || providersOk;

    const health: HealthCheck = {
      status: allOk ? 'healthy' : someOk ? 'degraded' : 'unhealthy',
      checks: {
        database: databaseOk,
        memory: memoryOk,
        providers: providersOk,
      },
    };

    const statusCode = allOk ? 200 : someOk ? 200 : 503;
    sendJson(res, health);
  });

  // GET /api/v1/system/config - Get current configuration (sanitized)
  router.get('/api/v1/system/config', (_req, res) => {
    // Return sanitized config (no API keys)
    const sanitizedConfig = {
      version: config.version,
      memory: {
        path: config.memory.path,
        defaultNamespace: config.memory.defaultNamespace,
        vectorSearch: {
          enabled: config.memory.vectorSearch.enabled,
          provider: config.memory.vectorSearch.provider,
          model: config.memory.vectorSearch.model,
        },
      },
      providers: {
        default: config.providers.default,
        // List configured providers without keys
        configured: Object.keys(config.providers).filter(k => k !== 'default'),
      },
      agents: config.agents,
      github: {
        enabled: config.github.enabled,
        useGhCli: config.github.useGhCli,
      },
      plugins: config.plugins,
      mcp: config.mcp,
      hooks: config.hooks,
    };

    sendJson(res, sanitizedConfig);
  });

  // GET /api/v1/system/metrics - Get system metrics
  router.get('/api/v1/system/metrics', (_req, res) => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const metrics = {
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };

    sendJson(res, metrics);
  });
}
