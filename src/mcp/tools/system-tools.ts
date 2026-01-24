/**
 * System MCP tools - status, health, config
 */

import type { MemoryManager } from '../../memory/index.js';
import type { AgentStackConfig } from '../../types.js';
import { getAgentCount as getActiveAgentCount } from '../../agents/spawner.js';
import { getAgentCount as getRegisteredAgentCount } from '../../agents/registry.js';

export function createSystemTools(memory: MemoryManager, config: AgentStackConfig) {
  return {
    system_status: {
      name: 'system_status',
      description: 'Get overall system status',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const session = memory.getActiveSession();
        const vectorStats = memory.getVectorStats();
        const registeredAgents = getRegisteredAgentCount();
        const activeAgents = getActiveAgentCount();

        return {
          version: config.version,
          session: session
            ? {
                id: session.id,
                status: session.status,
                startedAt: session.startedAt.toISOString(),
              }
            : null,
          agents: {
            registered: registeredAgents,
            active: activeAgents,
          },
          memory: {
            total: vectorStats.total,
            indexed: vectorStats.indexed,
            coverage: `${vectorStats.coverage}%`,
            vectorEnabled: vectorStats.indexed > 0 || config.memory.vectorSearch.enabled,
          },
          providers: {
            default: config.providers.default,
            available: Object.keys(config.providers).filter(k => k !== 'default'),
          },
        };
      },
    },

    system_health: {
      name: 'system_health',
      description: 'Check system health',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const checks: Record<string, { status: 'ok' | 'warn' | 'error'; message: string }> = {};

        // Check memory
        try {
          const count = memory.count();
          checks['memory'] = {
            status: 'ok',
            message: `${count} entries stored`,
          };
        } catch (error) {
          checks['memory'] = {
            status: 'error',
            message: error instanceof Error ? error.message : 'Memory check failed',
          };
        }

        // Check vector search
        try {
          const stats = memory.getVectorStats();
          if (config.memory.vectorSearch.enabled) {
            if (stats.indexed > 0) {
              checks['vector_search'] = {
                status: 'ok',
                message: `${stats.indexed}/${stats.total} entries indexed`,
              };
            } else {
              checks['vector_search'] = {
                status: 'warn',
                message: 'Enabled but no entries indexed',
              };
            }
          } else {
            checks['vector_search'] = {
              status: 'ok',
              message: 'Disabled (using FTS only)',
            };
          }
        } catch (error) {
          checks['vector_search'] = {
            status: 'error',
            message: error instanceof Error ? error.message : 'Vector check failed',
          };
        }

        // Check agents
        try {
          const registered = getRegisteredAgentCount();
          const active = getActiveAgentCount();
          checks['agents'] = {
            status: 'ok',
            message: `${registered.total} types, ${active} active`,
          };
        } catch (error) {
          checks['agents'] = {
            status: 'error',
            message: error instanceof Error ? error.message : 'Agent check failed',
          };
        }

        // Overall status
        const hasError = Object.values(checks).some(c => c.status === 'error');
        const hasWarn = Object.values(checks).some(c => c.status === 'warn');

        return {
          healthy: !hasError,
          status: hasError ? 'unhealthy' : hasWarn ? 'degraded' : 'healthy',
          checks,
        };
      },
    },

    system_config: {
      name: 'system_config',
      description: 'Get current configuration (sanitized)',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        // Return sanitized config (no API keys)
        return {
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
          agents: config.agents,
          providers: {
            default: config.providers.default,
            anthropic: config.providers.anthropic ? { configured: true } : undefined,
            openai: config.providers.openai ? { configured: true } : undefined,
            ollama: config.providers.ollama
              ? { baseUrl: config.providers.ollama.baseUrl }
              : undefined,
          },
          github: {
            enabled: config.github.enabled,
            useGhCli: config.github.useGhCli,
          },
          plugins: config.plugins,
          mcp: config.mcp,
          hooks: config.hooks,
        };
      },
    },
  };
}
