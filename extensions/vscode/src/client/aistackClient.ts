/**
 * REST client for the aistack daemon.
 *
 * Uses the global `fetch` (Node 20+ / VS Code's runtime). Provides typed
 * helpers for the small subset of the daemon API this extension consumes:
 *
 *   - GET    /api/v1/agents
 *   - GET    /api/v1/agents/types
 *   - POST   /api/v1/agents
 *   - DELETE /api/v1/agents/:id
 *   - POST   /api/v1/agents/:id/execute
 *   - GET    /api/v1/memory
 *   - GET    /api/v1/review-loops
 *   - POST   /api/v1/review-loops
 *
 * Retries: 1 retry with 500ms backoff on network / 5xx errors. The daemon is
 * expected to be on localhost so aggressive retry is unwarranted.
 */

import * as vscode from 'vscode';

export interface ClientConfig {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
}

export interface AgentSummary {
  id: string;
  type: string;
  name?: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
  sessionId?: string;
  createdAt: string;
}

export interface AgentTypeDefinition {
  type: string;
  name: string;
  description: string;
  capabilities: string[];
}

export interface MemoryEntry {
  id: string;
  namespace?: string;
  key: string;
  value: unknown;
  createdAt: string;
}

export interface ReviewLoopSummary {
  id: string;
  coderId: string;
  adversarialId: string;
  sessionId?: string;
  iteration: number;
  maxIterations: number;
  status: 'running' | 'approved' | 'aborted' | 'max_iterations_reached';
  finalVerdict?: string;
  startedAt: string;
  completedAt?: string;
  reviewCount: number;
}

export class AistackHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AistackHttpError';
  }
}

export class AistackClient {
  constructor(private readonly cfg: ClientConfig, private readonly output: vscode.OutputChannel) {}

  get baseUrl(): string {
    return this.cfg.baseUrl.replace(/\/+$/, '');
  }

  // ---------- agents ----------

  listAgents(): Promise<AgentSummary[]> {
    return this.req<AgentSummary[]>('GET', '/api/v1/agents');
  }

  listAgentTypes(): Promise<AgentTypeDefinition[]> {
    return this.req<AgentTypeDefinition[]>('GET', '/api/v1/agents/types');
  }

  spawnAgent(input: { type: string; name?: string; sessionId?: string }): Promise<AgentSummary> {
    return this.req<AgentSummary>('POST', '/api/v1/agents', input);
  }

  stopAgent(id: string): Promise<{ stopped: boolean }> {
    return this.req('DELETE', `/api/v1/agents/${encodeURIComponent(id)}`);
  }

  executeAgent(
    id: string,
    task: string,
    extras?: { provider?: string; model?: string; context?: Record<string, unknown> }
  ): Promise<{ response: string; model?: string; duration?: number }> {
    return this.req('POST', `/api/v1/agents/${encodeURIComponent(id)}/execute`, {
      task,
      ...extras,
    });
  }

  // ---------- memory ----------

  listMemory(opts?: { sessionId?: string; limit?: number; offset?: number }): Promise<{
    items: MemoryEntry[];
    total: number;
  }> {
    const qs = new URLSearchParams();
    if (opts?.sessionId) qs.set('sessionId', opts.sessionId);
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    if (opts?.offset != null) qs.set('offset', String(opts.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.req('GET', `/api/v1/memory${suffix}`);
  }

  // ---------- review loops ----------

  listReviewLoops(): Promise<ReviewLoopSummary[]> {
    return this.req('GET', '/api/v1/review-loops');
  }

  startReviewLoop(input: {
    codeInput: string;
    maxIterations?: number;
    sessionId?: string;
  }): Promise<ReviewLoopSummary> {
    return this.req('POST', '/api/v1/review-loops', input);
  }

  // ---------- internals ----------

  private async req<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cfg.token) headers['Authorization'] = `Bearer ${this.cfg.token}`;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Retry once on 5xx
        if (res.status >= 500 && attempt === 0) {
          this.output.appendLine(`aistack: ${method} ${path} -> ${res.status}, retrying once`);
          await delay(500);
          return this.req<T>(method, path, body, attempt + 1);
        }
        throw new AistackHttpError(res.status, `${method} ${path} failed: ${res.status} ${text}`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AistackHttpError) throw err;
      // Network / abort — retry once
      if (attempt === 0) {
        this.output.appendLine(`aistack: ${method} ${path} network error, retrying once`);
        await delay(500);
        return this.req<T>(method, path, body, attempt + 1);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`aistack daemon unreachable at ${this.baseUrl}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
