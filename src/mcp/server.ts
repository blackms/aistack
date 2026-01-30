/**
 * MCP Server - Model Context Protocol implementation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AgentStackConfig } from '../types.js';
import { MemoryManager } from '../memory/index.js';
import { logger } from '../utils/logger.js';
import {
  createAgentTools,
  createIdentityTools,
  createMemoryTools,
  createTaskTools,
  createSessionTools,
  createSystemTools,
  createGitHubTools,
} from './tools/index.js';
import { DriftDetectionService } from '../tasks/drift-detection-service.js';
import { ConsensusService } from '../tasks/consensus-service.js';
import { SmartDispatcher } from '../tasks/smart-dispatcher.js';

const log = logger.child('mcp');

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export class MCPServer {
  private server: Server;
  private tools: Map<string, MCPTool> = new Map();
  private memory: MemoryManager;
  private config: AgentStackConfig;
  private driftService: DriftDetectionService;
  private consensusService: ConsensusService;
  private smartDispatcher: SmartDispatcher;

  constructor(config: AgentStackConfig) {
    this.config = config;
    this.memory = new MemoryManager(config);
    this.driftService = new DriftDetectionService(this.memory.getStore(), config);
    this.consensusService = new ConsensusService(this.memory.getStore(), config);
    this.smartDispatcher = new SmartDispatcher(config);

    this.server = new Server(
      {
        name: 'agentstack',
        version: config.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerTools();
    this.setupHandlers();
  }

  private registerTools(): void {
    // Register all tool categories
    const toolSets = [
      createAgentTools(this.config),
      createIdentityTools(this.config),
      createMemoryTools(this.memory),
      createTaskTools(this.memory, this.driftService, this.consensusService, this.smartDispatcher, this.config),
      createSessionTools(this.memory),
      createSystemTools(this.memory, this.config),
      createGitHubTools(this.config),
    ];

    for (const toolSet of toolSets) {
      for (const tool of Object.values(toolSet)) {
        this.tools.set(tool.name, tool as MCPTool);
      }
    }

    log.info('Registered MCP tools', { count: this.tools.size });
  }

  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Array.from(this.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return { tools };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = this.tools.get(name);
      if (!tool) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
      }

      try {
        log.debug('Calling tool', { name, args });
        const result = await tool.handler(args ?? {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        log.error('Tool error', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log.info('MCP server started', { transport: 'stdio' });
  }

  async stop(): Promise<void> {
    await this.server.close();
    this.consensusService.destroy();
    this.memory.close();
    log.info('MCP server stopped');
  }

  getToolCount(): number {
    return this.tools.size;
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

/**
 * Create and start MCP server
 */
export async function startMCPServer(config: AgentStackConfig): Promise<MCPServer> {
  const server = new MCPServer(config);
  await server.start();
  return server;
}
