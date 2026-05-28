/**
 * Anthropic Memory Tool adapter
 *
 * Exposes the aistack memory layer through the official Anthropic Memory Tool
 * API surface (https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool).
 *
 * The Memory Tool models a virtual file system rooted at a "memory directory"
 * (by convention `~/.claude/agent-memory/`). Tool calls expose a small set of
 * commands (`view`, `create`, `str_replace`, `insert`, `delete`, `rename`) that
 * operate on text files. We expose this surface on top of the SQLite-backed
 * MemoryManager: each "file" maps to a memory entry keyed by its relative path
 * inside a dedicated `tool-adapter` namespace (configurable). Subdirectories
 * are emulated through the `/` separator inside keys.
 *
 * This adapter is intentionally storage-only — it does not orchestrate Claude
 * tool calls. Consumers (e.g. an MCP server, the Anthropic SDK) can wire the
 * `handle()` method to the tool dispatcher.
 */

import type { MemoryManager } from './index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('memory-tool-adapter');

/**
 * Supported commands. Mirrors the Anthropic Memory Tool spec.
 */
export type MemoryToolCommand =
  | 'view'
  | 'create'
  | 'str_replace'
  | 'insert'
  | 'delete'
  | 'rename';

export interface MemoryToolInput {
  command: MemoryToolCommand;
  path: string;
  /** For `create` and `insert` */
  file_text?: string;
  /** For `str_replace` */
  old_str?: string;
  new_str?: string;
  /** For `insert` */
  insert_line?: number;
  /** For `rename` */
  new_path?: string;
  /** For `view`: optional [start, end] (1-based, inclusive) line range */
  view_range?: [number, number];
}

export interface MemoryToolResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface MemoryToolAdapterOptions {
  /** Namespace used to back the virtual file system. Defaults to `agent-memory`. */
  namespace?: string;
  /** Virtual root directory advertised to the model. Defaults to `/memories`. */
  root?: string;
}

const DEFAULT_NAMESPACE = 'agent-memory';
const DEFAULT_ROOT = '/memories';

/**
 * Normalizes paths to a canonical form (forward slashes, no trailing slash).
 *
 * Accepts both absolute paths under the virtual root and bare relative paths.
 * Rejects path traversal (`..`) and absolute paths outside the virtual root.
 */
export function normalizeMemoryPath(input: string, root: string = DEFAULT_ROOT): string {
  if (!input || typeof input !== 'string') {
    throw new Error('path must be a non-empty string');
  }
  // Reject backslashes — the Memory Tool API uses POSIX semantics.
  const posix = input.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\/+$/, '');
  let rel = posix;
  if (posix.startsWith(normalizedRoot)) {
    rel = posix.slice(normalizedRoot.length);
  } else if (posix.startsWith('/')) {
    throw new Error(`path ${input} is outside virtual root ${normalizedRoot}`);
  }
  rel = rel.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rel) {
    throw new Error('path must reference a file (not the root)');
  }
  // Disallow traversal segments.
  const segments = rel.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`invalid path segment: ${seg}`);
    }
  }
  return rel;
}

export class MemoryToolAdapter {
  private namespace: string;
  private root: string;

  constructor(private memory: MemoryManager, options: MemoryToolAdapterOptions = {}) {
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE;
    this.root = options.root ?? DEFAULT_ROOT;
  }

  /** Inspect adapter configuration (used by tests + diagnostics). */
  getConfig(): { namespace: string; root: string } {
    return { namespace: this.namespace, root: this.root };
  }

  /**
   * Entry point — dispatch a tool call to the matching command handler.
   */
  async handle(input: MemoryToolInput): Promise<MemoryToolResult> {
    try {
      switch (input.command) {
        case 'view':
          return await this.view(input);
        case 'create':
          return await this.create(input);
        case 'str_replace':
          return await this.strReplace(input);
        case 'insert':
          return await this.insert(input);
        case 'delete':
          return await this.delete(input);
        case 'rename':
          return await this.rename(input);
        default:
          return { ok: false, error: `unknown command: ${String(input.command)}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Tool adapter call failed', { command: input.command, error: message });
      return { ok: false, error: message };
    }
  }

  // ==================== Commands ====================

  private async view(input: MemoryToolInput): Promise<MemoryToolResult> {
    // Special case: viewing the root or a "directory" lists matching keys.
    const raw = input.path?.replace(/\\/g, '/') ?? '';
    const normalizedRoot = this.root.replace(/\/+$/, '');
    const isRoot = raw === normalizedRoot || raw === `${normalizedRoot}/` || raw === '/' || raw === '';
    if (isRoot) {
      const entries = this.memory.list(this.namespace, 1000);
      const listing = entries.map((e) => `${this.root}/${e.key}`).sort().join('\n');
      return { ok: true, content: listing };
    }

    // Directory listing (path ends with `/`) — list entries with that prefix.
    if (raw.endsWith('/')) {
      const prefix = normalizeMemoryPath(raw.replace(/\/+$/, ''), this.root) + '/';
      const entries = this.memory
        .list(this.namespace, 1000)
        .filter((e) => e.key.startsWith(prefix));
      const listing = entries.map((e) => `${this.root}/${e.key}`).sort().join('\n');
      return { ok: true, content: listing };
    }

    const key = normalizeMemoryPath(input.path, this.root);
    const entry = this.memory.get(key, this.namespace);
    if (!entry) {
      return { ok: false, error: `file not found: ${input.path}` };
    }

    if (input.view_range) {
      const [start, end] = input.view_range;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        return { ok: false, error: 'view_range must be [start, end] with 1 <= start <= end' };
      }
      const lines = entry.content.split(/\r?\n/);
      const slice = lines.slice(start - 1, end).join('\n');
      return { ok: true, content: slice };
    }
    return { ok: true, content: entry.content };
  }

  private async create(input: MemoryToolInput): Promise<MemoryToolResult> {
    if (typeof input.file_text !== 'string') {
      return { ok: false, error: 'create requires file_text' };
    }
    const key = normalizeMemoryPath(input.path, this.root);
    await this.memory.store(key, input.file_text, {
      namespace: this.namespace,
      metadata: { source: 'memory-tool', path: `${this.root}/${key}` },
    });
    return { ok: true, content: `created ${this.root}/${key}` };
  }

  private async strReplace(input: MemoryToolInput): Promise<MemoryToolResult> {
    if (typeof input.old_str !== 'string' || typeof input.new_str !== 'string') {
      return { ok: false, error: 'str_replace requires old_str and new_str' };
    }
    const key = normalizeMemoryPath(input.path, this.root);
    const entry = this.memory.get(key, this.namespace);
    if (!entry) {
      return { ok: false, error: `file not found: ${input.path}` };
    }
    const occurrences = entry.content.split(input.old_str).length - 1;
    if (occurrences === 0) {
      return { ok: false, error: 'old_str not found' };
    }
    if (occurrences > 1) {
      return { ok: false, error: `old_str matches ${occurrences} times; must be unique` };
    }
    const updated = entry.content.replace(input.old_str, input.new_str);
    await this.memory.store(key, updated, {
      namespace: this.namespace,
      metadata: { source: 'memory-tool', path: `${this.root}/${key}` },
    });
    return { ok: true, content: `replaced in ${this.root}/${key}` };
  }

  private async insert(input: MemoryToolInput): Promise<MemoryToolResult> {
    if (typeof input.insert_line !== 'number' || typeof input.file_text !== 'string') {
      return { ok: false, error: 'insert requires insert_line and file_text' };
    }
    const key = normalizeMemoryPath(input.path, this.root);
    const entry = this.memory.get(key, this.namespace);
    if (!entry) {
      return { ok: false, error: `file not found: ${input.path}` };
    }
    const lines = entry.content.split(/\r?\n/);
    if (input.insert_line < 0 || input.insert_line > lines.length) {
      return { ok: false, error: `insert_line out of range (0..${lines.length})` };
    }
    lines.splice(input.insert_line, 0, input.file_text);
    const updated = lines.join('\n');
    await this.memory.store(key, updated, {
      namespace: this.namespace,
      metadata: { source: 'memory-tool', path: `${this.root}/${key}` },
    });
    return { ok: true, content: `inserted into ${this.root}/${key}` };
  }

  private async delete(input: MemoryToolInput): Promise<MemoryToolResult> {
    const key = normalizeMemoryPath(input.path, this.root);
    const deleted = this.memory.delete(key, this.namespace);
    if (!deleted) {
      return { ok: false, error: `file not found: ${input.path}` };
    }
    return { ok: true, content: `deleted ${this.root}/${key}` };
  }

  private async rename(input: MemoryToolInput): Promise<MemoryToolResult> {
    if (!input.new_path) {
      return { ok: false, error: 'rename requires new_path' };
    }
    const fromKey = normalizeMemoryPath(input.path, this.root);
    const toKey = normalizeMemoryPath(input.new_path, this.root);
    if (fromKey === toKey) {
      return { ok: true, content: 'no-op rename' };
    }
    const entry = this.memory.get(fromKey, this.namespace);
    if (!entry) {
      return { ok: false, error: `file not found: ${input.path}` };
    }
    // Refuse to overwrite an existing destination.
    if (this.memory.get(toKey, this.namespace)) {
      return { ok: false, error: `destination exists: ${input.new_path}` };
    }
    await this.memory.store(toKey, entry.content, {
      namespace: this.namespace,
      metadata: { source: 'memory-tool', path: `${this.root}/${toKey}` },
    });
    this.memory.delete(fromKey, this.namespace);
    return { ok: true, content: `renamed ${this.root}/${fromKey} -> ${this.root}/${toKey}` };
  }
}
