/**
 * Web server - HTTP + WebSocket server for AgentStack
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { Router, sendJson, sendError } from './router.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { handleError } from './middleware/error.js';
import { handleWebSocketUpgrade, closeAllConnections, getClientCount, setAuthService } from './websocket/handler.js';
import {
  registerAgentRoutes,
  registerMemoryRoutes,
  registerTaskRoutes,
  registerSessionRoutes,
  registerWorkflowRoutes,
  registerReviewLoopRoutes,
  registerSystemRoutes,
  registerProjectRoutes,
  registerSpecificationRoutes,
  registerFilesystemRoutes,
  createAuthRoutes,
  registerIdentityRoutes,
} from './routes/index.js';
import type { WebConfig } from './types.js';
import { AuthService } from '../auth/service.js';
import { initAuth } from './middleware/auth.js';
import { getMemoryManager } from '../memory/index.js';

const log = logger.child('web:server');

// Default web configuration
export const defaultWebConfig: WebConfig = {
  enabled: true,
  port: 3001,
  host: 'localhost',
  cors: {
    origins: ['http://localhost:5174', 'http://localhost:5173', 'http://localhost:3000'],
  },
};

export class WebServer {
  private server: http.Server | null = null;
  private router: Router;
  private config: AgentStackConfig;
  private webConfig: WebConfig;
  private corsMiddleware: ReturnType<typeof createCorsMiddleware>;
  private authService: AuthService;

  constructor(config: AgentStackConfig, webConfig: Partial<WebConfig> = {}) {
    this.config = config;
    this.webConfig = { ...defaultWebConfig, ...webConfig };
    this.router = new Router();
    this.corsMiddleware = createCorsMiddleware(this.webConfig);

    // Initialize authentication
    const memoryManager = getMemoryManager(config);
    const db = memoryManager.getStore().getDatabase();
    this.authService = new AuthService(db);
    initAuth(this.authService);
    setAuthService(this.authService);

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Auth routes (no auth required for these)
    const authRoutes = createAuthRoutes({ authService: this.authService });
    this.router.post('/api/v1/auth/register', authRoutes.register.bind(authRoutes));
    this.router.post('/api/v1/auth/login', authRoutes.login.bind(authRoutes));
    this.router.post('/api/v1/auth/refresh', authRoutes.refresh.bind(authRoutes));
    this.router.post('/api/v1/auth/logout', authRoutes.logout.bind(authRoutes));
    this.router.get('/api/v1/auth/me', authRoutes.me.bind(authRoutes));
    this.router.post('/api/v1/auth/change-password', authRoutes.changePassword.bind(authRoutes));
    this.router.get('/api/v1/auth/users', authRoutes.listUsers.bind(authRoutes));
    this.router.put('/api/v1/auth/users/:userId/role', (req, res, params) => {
      authRoutes.updateUserRole(req, res, params.path[0]!);
    });
    this.router.delete('/api/v1/auth/users/:userId', (req, res, params) => {
      authRoutes.deleteUser(req, res, params.path[0]!);
    });

    // API routes
    registerAgentRoutes(this.router, this.config);
    registerIdentityRoutes(this.router, this.config);
    registerMemoryRoutes(this.router, this.config);
    registerTaskRoutes(this.router, this.config);
    registerSessionRoutes(this.router, this.config);
    registerWorkflowRoutes(this.router, this.config);
    registerReviewLoopRoutes(this.router, this.config);
    registerSystemRoutes(this.router, this.config);
    registerProjectRoutes(this.router, this.config);
    registerSpecificationRoutes(this.router, this.config);
    registerFilesystemRoutes(this.router, this.config);

    // Root endpoint
    this.router.get('/api/v1', (_req, res) => {
      sendJson(res, {
        name: 'AgentStack Web API',
        version: '1.0.0',
        endpoints: [
          '/api/v1/auth',
          '/api/v1/agents',
          '/api/v1/identities',
          '/api/v1/memory',
          '/api/v1/tasks',
          '/api/v1/sessions',
          '/api/v1/workflows',
          '/api/v1/review-loops',
          '/api/v1/system',
          '/api/v1/projects',
          '/api/v1/specs',
          '/api/v1/filesystem',
        ],
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          // CORS handling
          if (this.corsMiddleware(req, res)) {
            return; // Preflight handled
          }

          // Try to handle with router
          const handled = await this.router.handle(req, res);

          if (!handled) {
            // Try to serve static files for frontend
            const staticServed = await this.serveStatic(req, res);
            if (!staticServed) {
              sendError(res, 404, 'Not found');
            }
          }
        } catch (error) {
          handleError(res, error);
        }
      });

      // Handle WebSocket upgrade
      this.server.on('upgrade', (req, socket, head) => {
        const url = req.url || '';
        if (url === '/ws' || url.startsWith('/ws?')) {
          handleWebSocketUpgrade(req, socket, head);
        } else {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
        }
      });

      this.server.on('error', (error) => {
        log.error('Server error', { error: error.message });
        reject(error);
      });

      this.server.listen(this.webConfig.port, this.webConfig.host, () => {
        log.info('Web server started', {
          host: this.webConfig.host,
          port: this.webConfig.port,
          url: `http://${this.webConfig.host}:${this.webConfig.port}`,
        });
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close WebSocket connections
      closeAllConnections();

      if (this.server) {
        this.server.close(() => {
          log.info('Web server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Serve static files from the frontend build
   */
  private async serveStatic(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const url = req.url || '/';

    // Don't serve static for API routes
    if (url.startsWith('/api/')) {
      return false;
    }

    // Get the static directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const staticDir = path.resolve(__dirname, '../../web/dist');

    // Check if static directory exists
    if (!fs.existsSync(staticDir)) {
      return false;
    }

    // Determine file path
    let filePath = path.join(staticDir, url);

    // If it's a directory, try index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    // If file doesn't exist, serve index.html for SPA routing
    if (!fs.existsSync(filePath)) {
      filePath = path.join(staticDir, 'index.html');
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return false;
    }

    // Get content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get server status
   */
  getStatus(): {
    running: boolean;
    host: string;
    port: number;
    wsClients: number;
  } {
    return {
      running: this.server !== null,
      host: this.webConfig.host,
      port: this.webConfig.port,
      wsClients: getClientCount(),
    };
  }
}

// Singleton instance
let serverInstance: WebServer | null = null;

/**
 * Start the web server
 */
export async function startWebServer(
  config: AgentStackConfig,
  webConfig?: Partial<WebConfig>
): Promise<WebServer> {
  if (serverInstance) {
    log.warn('Web server already running');
    return serverInstance;
  }

  serverInstance = new WebServer(config, webConfig);
  await serverInstance.start();
  return serverInstance;
}

/**
 * Stop the web server
 */
export async function stopWebServer(): Promise<void> {
  if (serverInstance) {
    await serverInstance.stop();
    serverInstance = null;
  }
}

/**
 * Get the web server instance
 */
export function getWebServer(): WebServer | null {
  return serverInstance;
}
