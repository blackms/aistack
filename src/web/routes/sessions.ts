/**
 * Session routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getMemoryManager } from '../../memory/index.js';
import type { CreateSessionRequest } from '../types.js';

export function registerSessionRoutes(router: Router, config: AgentStackConfig): void {
  const getManager = () => getMemoryManager(config);

  // GET /api/v1/sessions - List all sessions
  router.get('/api/v1/sessions', (req, res) => {
    const manager = getManager();
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const status = url.searchParams.get('status') as 'active' | 'ended' | null;
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const sessions = manager.listSessions(status || undefined, limit, offset);

    sendJson(res, sessions.map(session => ({
      ...session,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString(),
    })));
  });

  // GET /api/v1/sessions/active - Get active session
  router.get('/api/v1/sessions/active', (_req, res) => {
    const manager = getManager();
    const session = manager.getActiveSession();

    if (!session) {
      sendJson(res, null);
      return;
    }

    sendJson(res, {
      ...session,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString(),
    });
  });

  // POST /api/v1/sessions - Create new session
  router.post('/api/v1/sessions', (_req, res, params) => {
    const body = params.body as CreateSessionRequest | undefined;

    const manager = getManager();

    // End any existing active session first
    const activeSession = manager.getActiveSession();
    if (activeSession) {
      manager.endSession(activeSession.id);
    }

    const session = manager.createSession(body?.metadata);

    sendJson(res, {
      ...session,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString(),
    }, 201);
  });

  // GET /api/v1/sessions/:id - Get session by ID
  router.get('/api/v1/sessions/:id', (_req, res, params) => {
    const sessionId = params.path[0];
    if (!sessionId) {
      throw badRequest('Session ID is required');
    }

    const manager = getManager();
    const session = manager.getSession(sessionId);

    if (!session) {
      throw notFound('Session');
    }

    sendJson(res, {
      ...session,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString(),
    });
  });

  // PUT /api/v1/sessions/:id/end - End session
  router.put('/api/v1/sessions/:id/end', (_req, res, params) => {
    const sessionId = params.path[0];
    if (!sessionId) {
      throw badRequest('Session ID is required');
    }

    const manager = getManager();
    const success = manager.endSession(sessionId);

    if (!success) {
      throw notFound('Session');
    }

    const session = manager.getSession(sessionId);
    sendJson(res, {
      ...session,
      startedAt: session?.startedAt.toISOString(),
      endedAt: session?.endedAt?.toISOString(),
    });
  });
}
