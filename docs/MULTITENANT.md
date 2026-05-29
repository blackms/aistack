# Multi-tenancy & Workspace Isolation (AIG-649)

This document describes the multi-tenant model introduced in
`migrations/008_multitenant.sql` and the `src/multitenancy/` module. It is
intentionally a **base layer**: the schema, CLI, REST API and migration tool
are landed here, but the per-table `tenant_id` retrofit across the rest of
the codebase is deferred to merge time — see the "Retrofit checklist"
section below.

## Concepts

aistack now distinguishes three first-class entities:

| Entity     | Purpose                                                              |
| ---------- | -------------------------------------------------------------------- |
| Tenant     | Top-level isolation boundary (a customer, a team, a deployment env). |
| Workspace  | Project space inside a tenant; each tenant has >= 1 workspace.       |
| Membership | (tenant, user, optional workspace, role) — controls RBAC scoping.    |

Roles, in increasing privilege order:

1. `member` — read/write within the assigned tenant + workspace
2. `workspace_admin` — manage a single workspace (members, settings)
3. `tenant_admin` — manage the entire tenant (workspaces, members, settings)

## Feature flag

Multi-tenancy is **off by default** so existing 1.x installations keep
working unchanged. Enable it via `aistack.config.json`:

```json
{
  "multitenancy": {
    "enabled": true,
    "defaultTenantSlug": "default",
    "defaultWorkspaceSlug": "default"
  }
}
```

When `enabled` is `false`, services should ignore the
`MultitenancyContext` and treat the database as single-tenant. When `true`,
every authenticated request resolves a context via:

1. `X-Tenant-Slug` / `X-Workspace-Slug` HTTP headers, then
2. JWT custom claims (`tenant_slug`, `workspace_slug`), then
3. The `defaultTenantSlug` / `defaultWorkspaceSlug` config values.

## CLI

```bash
# Create a tenant + workspace
aistack tenant create --name "Acme Corp" --slug acme --workspace main

# Inspect
aistack tenant list
aistack tenant show acme

# Delete (irreversible, cascades to workspaces + memberships)
aistack tenant delete acme --yes

# Migrate a 1.x single-tenant install
aistack tenant migrate
aistack tenant migrate --tenant-slug acme --workspace-slug main
```

## REST API

| Method | Path                                       | Description                  |
| ------ | ------------------------------------------ | ---------------------------- |
| GET    | `/api/v1/tenants`                          | List tenants                 |
| POST   | `/api/v1/tenants`                          | Create tenant                |
| GET    | `/api/v1/tenants/:id`                      | Tenant detail                |
| DELETE | `/api/v1/tenants/:id`                      | Delete tenant                |
| GET    | `/api/v1/tenants/:id/workspaces`           | List workspaces              |
| POST   | `/api/v1/tenants/:id/workspaces`           | Create workspace             |

The web UI ships a `TenantSwitcher` component
(`web/src/pages/TenantSwitcher.tsx`) that persists the active selection in
`localStorage` (`aistack.activeTenantSlug` / `aistack.activeWorkspaceSlug`)
and emits an `aistack:tenant-changed` window event so downstream stores can
re-fetch.

## Memory namespacing

Memory keys should be scoped under tenant + workspace using
`workspaceNamespace(ctx)` from `src/multitenancy/`:

```ts
import {
  getActiveTenantContext,
  runWithTenantContext,
  workspaceNamespace,
  type MultitenancyContext,
} from '../multitenancy/index.js';

const ctx: MultitenancyContext = getActiveTenantContext()!;
const ns = workspaceNamespace(ctx); // e.g. "tenant:<id>:workspace:<id>"
await memory.store(key, content, { namespace: `${ns}:agents:${agentId}` });
```

`ctx` is a `MultitenancyContext`. Request handlers normally read it from
`getActiveTenantContext()` after route middleware calls `runWithTenantContext`.
Background jobs and CLI commands should set it explicitly around tenant-scoped
work:

```ts
runWithTenantContext(
  { tenantId, tenantSlug, workspaceId, workspaceSlug, role },
  async () => {
    const ctx = getActiveTenantContext()!;
    const ns = workspaceNamespace(ctx);
    // ... tenant-scoped memory operations
  },
);
```

Memory entries written in single-tenant mode (pre-migration) live in their
original namespace; the migration tool does **not** rewrite them. After
multi-tenancy is enabled, tenant-scoped queries do not read those unscoped
entries, so preserving them requires a manual backfill or cleanup. See the
"Retrofit checklist" for the data backfill plan.

## Single -> multi migration

```ts
import Database from 'better-sqlite3';
import { migrateSingleToMulti } from 'aistack/multitenancy';

const db = new Database('./data/aistack.db');
const result = migrateSingleToMulti(db, {
  tenantSlug: 'default',
  workspaceSlug: 'default',
});

console.log(`Created tenant ${result.tenant.slug} with`,
  result.usersGrantedMembership, 'tenant_admin members');
```

The tool is **idempotent** — re-running it on an already-migrated database
detects the existing tenant + workspace, reuses them and refreshes
memberships.

## Retrofit checklist for existing tables

Multi-tenancy is only fully realized when every domain table carries a
`tenant_id` (and, where appropriate, a `workspace_id`) column. Because the
codebase currently has 18+ pm-agent/* branches in flight, each adding new
tables of their own, this retrofit is **out of scope for AIG-649** and is
delegated to the human merger.

### Template per existing table

For each table `<name>` that should be tenant-scoped, the merge-time
migration must:

```sql
-- 1. Add the column (NULL allowed during backfill)
ALTER TABLE <name> ADD COLUMN tenant_id TEXT REFERENCES tenants(id);

-- 2. Optionally add workspace_id
ALTER TABLE <name> ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

-- 3. Backfill rows to the default tenant
UPDATE <name>
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default'),
    workspace_id = (SELECT id FROM workspaces
                    WHERE slug = 'default'
                    AND tenant_id = (SELECT id FROM tenants WHERE slug = 'default'))
WHERE tenant_id IS NULL;

-- 4. Add indexes
CREATE INDEX IF NOT EXISTS idx_<name>_tenant ON <name>(tenant_id);
CREATE INDEX IF NOT EXISTS idx_<name>_workspace ON <name>(workspace_id);

-- 5. Tighten when ready (only after every code path writes tenant_id)
-- SQLite does not support ALTER COLUMN; emulate with a table rebuild or
-- enforce NOT NULL at the application layer via service-layer asserts.
```

### Core tables present on `main` today

These are the tables that exist on `main` as of AIG-649 and need the
retrofit treatment. The list below is exhaustive for `main` — additional
tables introduced by the other pm-agent/* branches must be appended at
merge time.

| Table                       | Owner module                        | Notes                                  |
| --------------------------- | ----------------------------------- | -------------------------------------- |
| `users`                     | `src/auth/service.ts`               | Cross-tenant by design; do NOT scope.  |
| `refresh_tokens`            | `src/auth/service.ts`               | Per-user, no scoping needed.           |
| `memory_entries`            | `src/memory/sqlite-store.ts`        | MUST scope — use workspace namespace.  |
| `sessions`                  | `src/memory/sqlite-store.ts`        | MUST scope by tenant+workspace.        |
| `tasks`                     | `src/memory/sqlite-store.ts`        | MUST scope by tenant+workspace.        |
| `agent_identities`          | `src/agents/identity-service.ts`    | MUST scope by tenant.                  |
| `agent_audit`               | `src/agents/identity-service.ts`    | MUST scope by tenant.                  |
| `task_embeddings`           | migration 003                       | Follows `tasks` (inherits via JOIN).   |
| `task_relationships`        | migration 003                       | Follows `tasks` (inherits via JOIN).   |
| `drift_detection_events`    | migration 003                       | MUST scope by tenant.                  |
| `consensus_checkpoints`     | `src/coordination/consensus.ts`     | MUST scope by tenant+workspace.        |
| `review_loops`              | `src/coordination/review-loop.ts`   | MUST scope by tenant+workspace.        |
| `projects`                  | `src/projects/`                     | MUST scope by tenant+workspace.        |
| `project_tasks`             | `src/projects/`                     | Follows `projects`.                    |
| `specifications`            | `src/projects/`                     | Follows `project_tasks`.               |

### Post-merge coordination steps

After all `pm-agent/*` branches are merged into `main`, perform the
following in order (each as its own migration `00X_retrofit_<area>.sql`):

1. `0XX_retrofit_auth_tables.sql` — only if SSO branch (AIG-633) added new
   tables that need tenant_id.
2. `0XX_retrofit_memory_tables.sql` — `memory_entries`, `sessions`, `tasks`,
   `task_embeddings`, `task_relationships`, `drift_detection_events`.
3. `0XX_retrofit_agent_tables.sql` — `agent_identities`, `agent_audit`.
4. `0XX_retrofit_coordination_tables.sql` — `consensus_checkpoints`,
   `review_loops`.
5. `0XX_retrofit_projects_tables.sql` — `projects`, `project_tasks`,
   `specifications`.
6. `0XX_retrofit_<branch-name>.sql` — one per pm-agent/* branch that
   landed new tables (AIG-635 checkpoints, AIG-640 audit, AIG-646 memory,
   etc.).

For every retrofit migration:

- Run on a copy of production data first to measure runtime.
- Wrap the backfill in `BEGIN; COMMIT;` so it is atomic.
- Update the corresponding service module to (a) accept a
  `MultitenancyContext`, (b) include `tenant_id = ?` in every query, and
  (c) reject writes when the context is missing.
- Add isolation tests modeled after
  `tests/integration/multitenancy-migration.test.ts`.

### Application-layer guardrail

Until every table is retrofitted, downstream services that already accept a
`MultitenancyContext` (via the extended `AuthContext`) should treat an
absent tenant ID as a **soft error** when `multitenancy.enabled` is true.
Recommended pattern:

```ts
if (config.multitenancy?.enabled && !authContext.tenantId) {
  throw new Error('Multi-tenancy is enabled but request has no tenant context');
}
```

This prevents silent data leakage between tenants while the retrofit is
in progress.

## Migration numbering note

`migrations/008_multitenant.sql` deliberately skips the 004/005 range that
is contested across branches in flight. The human merger should renumber it
sequentially after merging all pm-agent/* branches.
