-- Migration: Multi-tenancy + workspace isolation (AIG-649)
-- Created: 2026-05-28
-- Description: Introduces tenants, workspaces and tenant_users tables enabling
--   multi-tenant deployments. Existing single-tenant data continues to work as
--   long as callers either (a) leave the multitenancy feature flag disabled or
--   (b) run the single->multi migration tool (src/multitenancy/migration-tool.ts)
--   which provisions a default tenant and a default workspace.
--
-- NOTE on numbering: branches in flight (AIG-633/635/640/646) ship their own
--   migrations starting at 004. We deliberately jump to 008 to avoid filename
--   collisions before the human merger renumbers everything at merge time.
--   See docs/MULTITENANT.md "Retrofit checklist" for the post-merge plan to
--   add tenant_id columns onto pre-existing tables.

-- ==================== UP ====================

-- Top-level isolation boundary. Every domain object eventually rolls up to a
-- single tenant. `slug` is the URL/CLI-friendly identifier; `settings_json`
-- holds arbitrary per-tenant configuration (branding, feature flags, quotas).
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  settings_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Workspaces partition a tenant into independent project spaces. Memory keys,
-- agents and tasks should be namespaced under tenant+workspace (see
-- workspaceNamespace() in src/multitenancy/context.ts).
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  settings_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);

-- Membership + RBAC. A user can belong to multiple tenants with different
-- roles. Workspace-scoped admin is represented by storing the workspace_id;
-- when workspace_id IS NULL the role applies to the whole tenant.
CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('tenant_admin', 'workspace_admin', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_workspace ON tenant_users(workspace_id);
