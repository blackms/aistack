/**
 * Group → RBAC role mapping with hardened validation.
 *
 * AIG-646 security focus #8: treat role assignment as a privileged op.
 *
 * Rules:
 *   - Only roles from the `UserRole` enum are accepted; anything else is dropped
 *     with a warning (no dynamic eval, no SQL templating).
 *   - The IdP group list is an arbitrary string array; we only consider groups
 *     that appear in the operator-supplied whitelist (`groupRoleMap`).
 *   - When multiple groups map to different roles, the *highest privilege*
 *     wins. Privilege order: ADMIN > DEVELOPER > VIEWER. This is intentional
 *     and explicit — we never silently grant ADMIN.
 *   - When no group matches, we return the configured `defaultRole` (or
 *     VIEWER as the safe fallback).
 */

import { logger } from '../../utils/logger.js';
import { UserRole } from '../types.js';
import type { GroupRoleMap } from './types.js';

const log = logger.child('sso:role-mapper');

const ROLE_PRIORITY: Record<UserRole, number> = {
  [UserRole.ADMIN]: 3,
  [UserRole.DEVELOPER]: 2,
  [UserRole.VIEWER]: 1,
};

const VALID_ROLES: Set<string> = new Set(Object.values(UserRole));

/**
 * Map an IdP-provided group list to an aistack UserRole.
 */
export function mapGroupsToRoles(
  groups: string[],
  groupRoleMap: GroupRoleMap | undefined,
  defaultRole: UserRole = UserRole.VIEWER
): UserRole {
  if (!groupRoleMap || Object.keys(groupRoleMap).length === 0) {
    return defaultRole;
  }

  let highest: UserRole | null = null;

  for (const group of groups) {
    if (typeof group !== 'string' || group.length === 0) continue;
    const mapped = groupRoleMap[group];
    if (!mapped) continue; // not in whitelist
    if (!VALID_ROLES.has(mapped)) {
      log.warn('Invalid role in groupRoleMap, dropping', { group, role: mapped });
      continue;
    }
    if (highest === null || ROLE_PRIORITY[mapped] > ROLE_PRIORITY[highest]) {
      highest = mapped;
    }
  }

  return highest ?? defaultRole;
}

/**
 * Validate that a groupRoleMap only contains roles in the UserRole enum.
 * Called at config load to fail fast on invalid configs.
 */
export function validateGroupRoleMap(map: GroupRoleMap | undefined): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!map) return { ok: true, errors };

  for (const [group, role] of Object.entries(map)) {
    if (typeof group !== 'string' || group.length === 0) {
      errors.push('Group key must be a non-empty string');
      continue;
    }
    if (!VALID_ROLES.has(role)) {
      errors.push(`Group "${group}" maps to invalid role "${role}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}
