/**
 * SCIM 2.0 server — RFC 7644 subset.
 *
 * AIG-646 security focus #6, #7, #8.
 *
 * Implemented endpoints (mounted by sso-routes):
 *   GET    /scim/v2/ServiceProviderConfig
 *   GET    /scim/v2/Schemas         (minimal: User + Group only)
 *   GET    /scim/v2/ResourceTypes   (User + Group)
 *   GET    /scim/v2/Users           (list + filter by userName eq / email eq)
 *   POST   /scim/v2/Users
 *   GET    /scim/v2/Users/:id
 *   PUT    /scim/v2/Users/:id
 *   PATCH  /scim/v2/Users/:id       (active=false → deprovision)
 *   DELETE /scim/v2/Users/:id
 *   GET    /scim/v2/Groups
 *   POST   /scim/v2/Groups
 *   GET    /scim/v2/Groups/:id
 *   PUT    /scim/v2/Groups/:id
 *   PATCH  /scim/v2/Groups/:id
 *   DELETE /scim/v2/Groups/:id
 *
 * Security:
 *   - Bearer token auth (constant-time compare) on every request.
 *   - Per-token in-process rate limit on mutations.
 *   - Strict conflict detection: 409 on duplicate userName/email (no silent merge).
 *   - Role assignment via group → role mapper only; no direct `role` field on SCIM User.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import type { AuthService } from '../service.js';
import { UserRole } from '../types.js';
import { mapGroupsToRoles } from './role-mapper.js';
import type { ScimConfig } from './types.js';

const log = logger.child('sso:scim');

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export interface ScimRequest {
  method: string;
  path: string; // path after /scim/v2 prefix (e.g. 'Users', 'Users/abc')
  authHeader?: string;
  body?: unknown;
  query?: Record<string, string>;
}

export interface ScimResponse {
  status: number;
  body: unknown;
}

/**
 * Outcome of authorize() — separated so transport layer can short-circuit
 * before parsing the body.
 */
export type ScimAuthResult =
  | { ok: true }
  | { ok: false; status: number; body: unknown };

export class ScimServer {
  private readonly db: Database.Database;
  private readonly authService: AuthService;
  private readonly cfg: ScimConfig;
  private readonly mutationWindow: number[] = [];

  constructor(db: Database.Database, authService: AuthService, cfg: ScimConfig) {
    this.db = db;
    this.authService = authService;
    this.cfg = cfg;
    if (!cfg.bearerToken || cfg.bearerToken.length < 16) {
      throw new Error('SCIM bearerToken must be at least 16 chars');
    }
  }

  /** Constant-time bearer token check. */
  authorize(authHeader?: string): ScimAuthResult {
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return {
        ok: false,
        status: 401,
        body: scimError(401, 'Missing or malformed Authorization header'),
      };
    }
    const presented = authHeader.slice(7).trim();
    const expected = this.cfg.bearerToken;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, status: 401, body: scimError(401, 'Invalid bearer token') };
    }
    return { ok: true };
  }

  /** Simple in-process token-bucket: max N mutations/minute. */
  private checkRateLimit(): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const limit = this.cfg.mutationsPerMinute ?? 60;
    while (this.mutationWindow.length && this.mutationWindow[0]! < now - windowMs) {
      this.mutationWindow.shift();
    }
    if (this.mutationWindow.length >= limit) return false;
    this.mutationWindow.push(now);
    return true;
  }

  async handle(req: ScimRequest): Promise<ScimResponse> {
    const auth = this.authorize(req.authHeader);
    if (!auth.ok) return { status: auth.status, body: auth.body };

    const path = req.path.replace(/^\/+|\/+$/g, '');
    const segments = path.split('/').filter(Boolean);
    const method = req.method.toUpperCase();
    const isMutation = method !== 'GET';

    if (isMutation && !this.checkRateLimit()) {
      return { status: 429, body: scimError(429, 'Too many mutations') };
    }

    try {
      if (segments[0] === 'ServiceProviderConfig' && method === 'GET') {
        return { status: 200, body: this.serviceProviderConfig() };
      }
      if (segments[0] === 'Schemas' && method === 'GET') {
        return { status: 200, body: this.schemas() };
      }
      if (segments[0] === 'ResourceTypes' && method === 'GET') {
        return { status: 200, body: this.resourceTypes() };
      }
      if (segments[0] === 'Users') {
        return await this.handleUsers(method, segments[1], req);
      }
      if (segments[0] === 'Groups') {
        return await this.handleGroups(method, segments[1], req);
      }
      return { status: 404, body: scimError(404, 'Unknown SCIM endpoint') };
    } catch (err) {
      log.error('SCIM handler error', {
        error: err instanceof Error ? err.message : String(err),
      });
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      return {
        status,
        body: scimError(
          status,
          err instanceof Error ? err.message : 'Internal error'
        ),
      };
    }
  }

  // ---- Users ----------------------------------------------------------------

  private async handleUsers(
    method: string,
    id: string | undefined,
    req: ScimRequest
  ): Promise<ScimResponse> {
    if (!id) {
      if (method === 'GET') return { status: 200, body: this.listUsers(req.query) };
      if (method === 'POST') return this.createUser(req.body);
    } else {
      if (method === 'GET') {
        const row = this.findUser(id);
        if (!row) return { status: 404, body: scimError(404, 'User not found') };
        return { status: 200, body: row };
      }
      if (method === 'PUT') return this.replaceUser(id, req.body);
      if (method === 'PATCH') return this.patchUser(id, req.body);
      if (method === 'DELETE') {
        const existing = this.findUser(id);
        if (!existing) return { status: 404, body: scimError(404, 'User not found') };
        this.authService.deleteUser(id);
        log.info('SCIM user deleted', { id });
        return { status: 204, body: '' };
      }
    }
    return { status: 405, body: scimError(405, 'Method not allowed') };
  }

  private listUsers(query?: Record<string, string>) {
    const filter = query?.filter;
    let where = '';
    let params: unknown[] = [];

    if (filter) {
      const m = /^(userName|email)\s+eq\s+"([^"]+)"$/i.exec(filter);
      if (m) {
        where = m[1]!.toLowerCase() === 'username' ? 'WHERE username = ?' : 'WHERE email = ?';
        params = [m[2]!];
      }
    }

    const rows = this.db
      .prepare(`SELECT id, email, username, role, created_at, updated_at FROM users ${where}`)
      .all(...params) as Array<{
      id: string;
      email: string;
      username: string;
      role: string;
      created_at: string;
      updated_at: string;
    }>;

    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: rows.length,
      startIndex: 1,
      itemsPerPage: rows.length,
      Resources: rows.map((r) => this.toScimUser(r)),
    };
  }

  private async createUser(body: unknown): Promise<ScimResponse> {
    const user = parseScimUser(body);

    // Conflict detection (SEC #7) — no silent merge.
    const existing = this.db
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .get(user.email, user.userName);
    if (existing) {
      return { status: 409, body: scimError(409, 'User with this email or userName already exists') };
    }

    // Map groups → role (whitelist only).
    const role = mapGroupsToRoles(user.groups, this.cfg.groupRoleMap, UserRole.VIEWER);

    // Generate a random password — the user will sign in via SSO, not password.
    const password = randomUUID() + randomUUID();
    const created = await this.authService.register(
      { email: user.email, username: user.userName, password },
      role
    );

    log.info('SCIM user created', { id: created.id, email: user.email, role });

    return {
      status: 201,
      body: this.toScimUser({
        id: created.id,
        email: created.email,
        username: created.username,
        role: created.role,
        created_at: created.createdAt.toISOString(),
        updated_at: created.updatedAt.toISOString(),
      }),
    };
  }

  private async replaceUser(id: string, body: unknown): Promise<ScimResponse> {
    const existing = this.findUserRow(id);
    if (!existing) return { status: 404, body: scimError(404, 'User not found') };

    const parsed = parseScimUser(body);
    const role = mapGroupsToRoles(parsed.groups, this.cfg.groupRoleMap, UserRole.VIEWER);

    // Conflict check on email/username change.
    if (parsed.email !== existing.email || parsed.userName !== existing.username) {
      const collision = this.db
        .prepare('SELECT id FROM users WHERE (email = ? OR username = ?) AND id != ?')
        .get(parsed.email, parsed.userName, id);
      if (collision) {
        return { status: 409, body: scimError(409, 'Email or userName conflict') };
      }
    }

    this.db
      .prepare(
        'UPDATE users SET email = ?, username = ?, role = ?, updated_at = ? WHERE id = ?'
      )
      .run(parsed.email, parsed.userName, role, new Date().toISOString(), id);

    log.info('SCIM user replaced', { id, role });
    const updated = this.findUser(id);
    return { status: 200, body: updated };
  }

  private async patchUser(id: string, body: unknown): Promise<ScimResponse> {
    const existing = this.findUserRow(id);
    if (!existing) return { status: 404, body: scimError(404, 'User not found') };

    const ops = parsePatchOps(body);
    let active = true;

    for (const op of ops) {
      if (op.path?.toLowerCase() === 'active' && typeof op.value === 'boolean') {
        active = op.value;
      }
      // We intentionally ignore role/group mutations via raw PATCH — group
      // assignments come through Group resources (SEC #8).
    }

    if (!active) {
      // Deprovision = delete (refresh tokens cascaded).
      this.authService.deleteUser(id);
      log.info('SCIM user deprovisioned via PATCH active=false', { id });
      return { status: 204, body: '' };
    }

    return { status: 200, body: this.findUser(id) };
  }

  private findUser(id: string) {
    const row = this.findUserRow(id);
    return row ? this.toScimUser(row) : null;
  }

  private findUserRow(id: string) {
    return this.db
      .prepare(
        'SELECT id, email, username, role, created_at, updated_at FROM users WHERE id = ?'
      )
      .get(id) as
      | {
          id: string;
          email: string;
          username: string;
          role: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
  }

  private toScimUser(row: {
    id: string;
    email: string;
    username: string;
    role: string;
    created_at: string;
    updated_at: string;
  }) {
    return {
      schemas: [SCIM_USER_SCHEMA],
      id: row.id,
      userName: row.username,
      active: true,
      emails: [{ value: row.email, primary: true }],
      meta: {
        resourceType: 'User',
        created: row.created_at,
        lastModified: row.updated_at,
        location: `/scim/v2/Users/${row.id}`,
      },
    };
  }

  // ---- Groups ---------------------------------------------------------------

  private async handleGroups(
    method: string,
    id: string | undefined,
    req: ScimRequest
  ): Promise<ScimResponse> {
    if (!id) {
      if (method === 'GET') return { status: 200, body: this.listGroups() };
      if (method === 'POST') return this.createGroup(req.body);
    } else {
      if (method === 'GET') {
        const g = this.findGroup(id);
        if (!g) return { status: 404, body: scimError(404, 'Group not found') };
        return { status: 200, body: g };
      }
      if (method === 'PUT') return this.replaceGroup(id, req.body);
      if (method === 'PATCH') return this.patchGroup(id, req.body);
      if (method === 'DELETE') {
        this.db.prepare('DELETE FROM scim_groups WHERE id = ?').run(id);
        log.info('SCIM group deleted', { id });
        return { status: 204, body: '' };
      }
    }
    return { status: 405, body: scimError(405, 'Method not allowed') };
  }

  private listGroups() {
    const rows = this.db
      .prepare('SELECT id, display_name FROM scim_groups')
      .all() as Array<{ id: string; display_name: string }>;
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: rows.length,
      startIndex: 1,
      itemsPerPage: rows.length,
      Resources: rows.map((r) => this.toScimGroup(r.id, r.display_name)),
    };
  }

  private createGroup(body: unknown): ScimResponse {
    const group = parseScimGroup(body);
    const existing = this.db
      .prepare('SELECT id FROM scim_groups WHERE display_name = ?')
      .get(group.displayName);
    if (existing) {
      return { status: 409, body: scimError(409, 'Group already exists') };
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scim_groups (id, display_name, external_id, attributes_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, group.displayName, group.externalId ?? null, '{}', now, now);

    this.applyGroupMembers(id, group.memberIds);

    log.info('SCIM group created', { id, displayName: group.displayName });
    return { status: 201, body: this.findGroup(id) };
  }

  private replaceGroup(id: string, body: unknown): ScimResponse {
    const existing = this.db.prepare('SELECT id FROM scim_groups WHERE id = ?').get(id);
    if (!existing) return { status: 404, body: scimError(404, 'Group not found') };
    const group = parseScimGroup(body);
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE scim_groups SET display_name = ?, external_id = ?, updated_at = ? WHERE id = ?'
      )
      .run(group.displayName, group.externalId ?? null, now, id);

    this.db.prepare('DELETE FROM scim_group_members WHERE group_id = ?').run(id);
    this.applyGroupMembers(id, group.memberIds);

    return { status: 200, body: this.findGroup(id) };
  }

  private patchGroup(id: string, body: unknown): ScimResponse {
    const existing = this.db.prepare('SELECT id FROM scim_groups WHERE id = ?').get(id);
    if (!existing) return { status: 404, body: scimError(404, 'Group not found') };
    const ops = parsePatchOps(body);
    for (const op of ops) {
      if (op.path === 'members' && op.op === 'add' && Array.isArray(op.value)) {
        const ids = (op.value as Array<{ value?: string }>)
          .map((m) => m.value)
          .filter((v): v is string => typeof v === 'string');
        this.applyGroupMembers(id, ids);
      } else if (op.path === 'members' && op.op === 'remove') {
        this.db.prepare('DELETE FROM scim_group_members WHERE group_id = ?').run(id);
      }
    }
    return { status: 200, body: this.findGroup(id) };
  }

  private applyGroupMembers(groupId: string, userIds: string[]): void {
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO scim_group_members (group_id, user_id, created_at) VALUES (?, ?, ?)'
    );
    const tx = this.db.transaction((ids: string[]) => {
      for (const uid of ids) {
        // Skip unknown users — return 400-equivalent semantics by ignoring (no implicit user creation).
        const u = this.db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (!u) {
          log.warn('SCIM group member references unknown user, skipping', {
            groupId,
            userId: uid,
          });
          continue;
        }
        insert.run(groupId, uid, now);
      }
    });
    tx(userIds);
  }

  private findGroup(id: string) {
    const row = this.db
      .prepare('SELECT id, display_name FROM scim_groups WHERE id = ?')
      .get(id) as { id: string; display_name: string } | undefined;
    if (!row) return null;
    return this.toScimGroup(row.id, row.display_name);
  }

  private toScimGroup(id: string, displayName: string) {
    const members = this.db
      .prepare('SELECT user_id FROM scim_group_members WHERE group_id = ?')
      .all(id) as Array<{ user_id: string }>;
    return {
      schemas: [SCIM_GROUP_SCHEMA],
      id,
      displayName,
      members: members.map((m) => ({
        value: m.user_id,
        $ref: `/scim/v2/Users/${m.user_id}`,
      })),
      meta: {
        resourceType: 'Group',
        location: `/scim/v2/Groups/${id}`,
      },
    };
  }

  // ---- Service metadata -----------------------------------------------------

  private serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'Authentication via OAuth 2.0 Bearer Token',
        },
      ],
    };
  }

  private schemas() {
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 2,
      Resources: [
        { id: SCIM_USER_SCHEMA, name: 'User' },
        { id: SCIM_GROUP_SCHEMA, name: 'Group' },
      ],
    };
  }

  private resourceTypes() {
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 2,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: SCIM_USER_SCHEMA,
        },
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'Group',
          name: 'Group',
          endpoint: '/Groups',
          schema: SCIM_GROUP_SCHEMA,
        },
      ],
    };
  }
}

// ---- Parsers ----------------------------------------------------------------

interface ParsedScimUser {
  userName: string;
  email: string;
  groups: string[];
}

function parseScimUser(body: unknown): ParsedScimUser {
  if (!body || typeof body !== 'object') {
    throw scimBadRequest('Body required');
  }
  const b = body as Record<string, unknown>;
  const userName = typeof b.userName === 'string' ? b.userName : null;
  if (!userName) throw scimBadRequest('userName required');

  let email: string | null = null;
  const emails = b.emails;
  if (Array.isArray(emails) && emails.length > 0) {
    const primary = emails.find(
      (e) => typeof e === 'object' && e && (e as { primary?: boolean }).primary
    );
    const pick = (primary ?? emails[0]) as { value?: unknown };
    if (typeof pick.value === 'string') email = pick.value;
  }
  if (!email) throw scimBadRequest('Primary email required');

  const groups: string[] = [];
  if (Array.isArray(b.groups)) {
    for (const g of b.groups) {
      if (typeof g === 'string') groups.push(g);
      else if (g && typeof g === 'object' && typeof (g as { display?: unknown }).display === 'string') {
        groups.push((g as { display: string }).display);
      }
    }
  }

  return { userName, email, groups };
}

interface ParsedScimGroup {
  displayName: string;
  externalId?: string;
  memberIds: string[];
}

function parseScimGroup(body: unknown): ParsedScimGroup {
  if (!body || typeof body !== 'object') throw scimBadRequest('Body required');
  const b = body as Record<string, unknown>;
  const displayName = typeof b.displayName === 'string' ? b.displayName : null;
  if (!displayName) throw scimBadRequest('displayName required');
  const externalId = typeof b.externalId === 'string' ? b.externalId : undefined;
  const memberIds: string[] = [];
  if (Array.isArray(b.members)) {
    for (const m of b.members) {
      if (m && typeof m === 'object' && typeof (m as { value?: unknown }).value === 'string') {
        memberIds.push((m as { value: string }).value);
      }
    }
  }
  return { displayName, externalId, memberIds };
}

interface PatchOp {
  op: 'add' | 'remove' | 'replace';
  path?: string;
  value?: unknown;
}

function parsePatchOps(body: unknown): PatchOp[] {
  if (!body || typeof body !== 'object') throw scimBadRequest('PatchOp body required');
  const b = body as Record<string, unknown>;
  const schemas = b.schemas as unknown;
  if (Array.isArray(schemas) && !schemas.includes(SCIM_PATCH_SCHEMA)) {
    throw scimBadRequest('PatchOp schema required');
  }
  const ops = b.Operations;
  if (!Array.isArray(ops)) throw scimBadRequest('Operations array required');
  return ops.map((raw): PatchOp => {
    const o = raw as Record<string, unknown>;
    const op = String(o.op ?? '').toLowerCase();
    if (op !== 'add' && op !== 'remove' && op !== 'replace') {
      throw scimBadRequest(`Unsupported op: ${op}`);
    }
    return {
      op,
      path: typeof o.path === 'string' ? o.path : undefined,
      value: o.value,
    };
  });
}

function scimError(status: number, detail: string) {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
  };
}

function scimBadRequest(detail: string): Error & { statusCode: number } {
  const e = Object.assign(new Error(detail), { statusCode: 400 });
  return e;
}
