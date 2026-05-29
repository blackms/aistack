/**
 * tenant command - Multi-tenancy operations (AIG-649).
 *
 * Provides the `aistack tenant create|list|delete|show` subcommands plus a
 * `migrate` helper that wraps migrateSingleToMulti() for 1.x -> 2.x upgrades.
 */

import { Command } from 'commander';
import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { getConfig } from '../../utils/config.js';
import { TenantService, migrateSingleToMulti } from '../../multitenancy/index.js';

function openDb(): Database.Database {
  const config = getConfig();
  const path = config.memory.path;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return new Database(path);
}

export function createTenantCommand(): Command {
  const command = new Command('tenant').description(
    'Manage tenants and workspaces (multi-tenancy)',
  );

  // create -----------------------------------------------------------------
  command
    .command('create')
    .description('Create a new tenant')
    .requiredOption('-n, --name <name>', 'Display name')
    .requiredOption('-s, --slug <slug>', 'URL-safe slug (a-z, 0-9, -)')
    .option('--workspace <slug>', 'Also create a workspace with this slug')
    .action((options) => {
      const { name, slug, workspace } = options as {
        name: string;
        slug: string;
        workspace?: string;
      };
      const db = openDb();
      try {
        const service = new TenantService(db);
        const tenant = service.createTenant({ name, slug });
        console.log('Tenant created:\n');
        console.log(`  ID:    ${tenant.id}`);
        console.log(`  Name:  ${tenant.name}`);
        console.log(`  Slug:  ${tenant.slug}`);

        if (workspace) {
          const ws = service.createWorkspace({
            tenantId: tenant.id,
            name: workspace,
            slug: workspace,
          });
          console.log('\nWorkspace created:\n');
          console.log(`  ID:    ${ws.id}`);
          console.log(`  Slug:  ${ws.slug}`);
        }
      } catch (error) {
        console.error(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // list -------------------------------------------------------------------
  command
    .command('list')
    .description('List all tenants')
    .action(() => {
      const db = openDb();
      try {
        const service = new TenantService(db);
        const tenants = service.listTenants();
        if (tenants.length === 0) {
          console.log('No tenants. Run `aistack tenant create` to add one.');
          return;
        }
        for (const t of tenants) {
          const workspaces = service.listWorkspaces(t.id);
          console.log(`${t.slug.padEnd(20)} ${t.name}  (${workspaces.length} workspaces)`);
        }
      } finally {
        db.close();
      }
    });

  // show -------------------------------------------------------------------
  command
    .command('show <slug>')
    .description('Show tenant details + workspaces')
    .action((slug: string) => {
      const db = openDb();
      try {
        const service = new TenantService(db);
        const tenant = service.getTenantBySlug(slug);
        if (!tenant) {
          console.error(`Tenant "${slug}" not found`);
          process.exit(1);
        }
        console.log(`Tenant: ${tenant.name}`);
        console.log(`  ID:      ${tenant.id}`);
        console.log(`  Slug:    ${tenant.slug}`);
        console.log(`  Created: ${tenant.createdAt.toISOString()}`);
        const workspaces = service.listWorkspaces(tenant.id);
        console.log(`\nWorkspaces (${workspaces.length}):`);
        for (const ws of workspaces) {
          console.log(`  - ${ws.slug} (${ws.id})`);
        }
        const members = service.listMembershipsForTenant(tenant.id);
        console.log(`\nMembers (${members.length}):`);
        for (const m of members) {
          const scope = m.workspaceId ? `workspace ${m.workspaceId}` : 'tenant-wide';
          console.log(`  - ${m.userId}  role=${m.role}  scope=${scope}`);
        }
      } finally {
        db.close();
      }
    });

  // delete -----------------------------------------------------------------
  command
    .command('delete <slug>')
    .description('Delete a tenant and all its workspaces (irreversible)')
    .option('--yes', 'Skip confirmation prompt', false)
    .action((slug: string, options: { yes: boolean }) => {
      if (!options.yes) {
        console.error('Refusing to delete without --yes flag');
        process.exit(1);
      }
      const db = openDb();
      try {
        const service = new TenantService(db);
        const tenant = service.getTenantBySlug(slug);
        if (!tenant) {
          console.error(`Tenant "${slug}" not found`);
          process.exit(1);
        }
        service.deleteTenant(tenant.id);
        console.log(`Tenant "${slug}" deleted.`);
      } finally {
        db.close();
      }
    });

  // migrate ----------------------------------------------------------------
  command
    .command('migrate')
    .description(
      'Migrate a single-tenant aistack install to multi-tenant (creates default tenant + workspace)',
    )
    .option('--tenant-slug <slug>', 'Slug for the default tenant', 'default')
    .option('--workspace-slug <slug>', 'Slug for the default workspace', 'default')
    .action((options) => {
      const db = openDb();
      try {
        const result = migrateSingleToMulti(db, {
          tenantSlug: options.tenantSlug as string,
          workspaceSlug: options.workspaceSlug as string,
        });
        console.log('Migration complete:\n');
        console.log(
          `  Tenant:     ${result.tenant.slug} ${result.reusedTenant ? '(reused)' : '(new)'}`,
        );
        console.log(
          `  Workspace:  ${result.workspace.slug} ${result.reusedWorkspace ? '(reused)' : '(new)'}`,
        );
        console.log(`  Memberships backfilled: ${result.usersGrantedMembership}`);
      } catch (error) {
        console.error(
          `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      } finally {
        db.close();
      }
    });

  return command;
}
