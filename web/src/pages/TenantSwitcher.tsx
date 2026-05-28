/**
 * TenantSwitcher — dropdown for selecting the active tenant + workspace.
 * Mounted into the topbar. Selection is persisted in localStorage and
 * downstream requests can attach X-Tenant-Slug / X-Workspace-Slug headers
 * by reading the same keys.
 *
 * REST client is inlined to keep the AIG-649 footprint within the 16-file
 * budget. Extract to web/src/api/tenants.ts when this UI grows further.
 */

import { useEffect, useState } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Typography,
} from '@mui/material';

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
}

const API_BASE = '/api/v1';
const STORAGE_KEY_TENANT = 'aistack.activeTenantSlug';
const STORAGE_KEY_WORKSPACE = 'aistack.activeWorkspaceSlug';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function persistActive(tenantSlug: string | undefined, workspaceSlug?: string): void {
  if (tenantSlug) localStorage.setItem(STORAGE_KEY_TENANT, tenantSlug);
  else localStorage.removeItem(STORAGE_KEY_TENANT);
  if (workspaceSlug) localStorage.setItem(STORAGE_KEY_WORKSPACE, workspaceSlug);
  else localStorage.removeItem(STORAGE_KEY_WORKSPACE);
}

export default function TenantSwitcher() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tenantSlug, setTenantSlug] = useState<string>(
    localStorage.getItem(STORAGE_KEY_TENANT) ?? '',
  );
  const [workspaceSlug, setWorkspaceSlug] = useState<string>(
    localStorage.getItem(STORAGE_KEY_WORKSPACE) ?? '',
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchJson<{ tenants: Tenant[] }>('/tenants');
        if (cancelled) return;
        setTenants(data.tenants);
        if (!tenantSlug && data.tenants.length > 0) {
          setTenantSlug(data.tenants[0].slug);
          persistActive(data.tenants[0].slug);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tenants');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenantSlug) {
      setWorkspaces([]);
      return;
    }
    const tenant = tenants.find((t) => t.slug === tenantSlug);
    if (!tenant) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchJson<{ workspaces: Workspace[] }>(
          `/tenants/${encodeURIComponent(tenant.id)}/workspaces`,
        );
        if (cancelled) return;
        setWorkspaces(data.workspaces);
        if (!workspaceSlug && data.workspaces.length > 0) {
          setWorkspaceSlug(data.workspaces[0].slug);
          persistActive(tenantSlug, data.workspaces[0].slug);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workspaces');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug, tenants.length]);

  const handleTenantChange = (slug: string) => {
    setTenantSlug(slug);
    setWorkspaceSlug('');
    persistActive(slug, undefined);
  };

  const handleWorkspaceChange = (slug: string) => {
    setWorkspaceSlug(slug);
    persistActive(tenantSlug, slug);
    // Trigger a soft reload so downstream stores re-fetch under new headers.
    window.dispatchEvent(new CustomEvent('aistack:tenant-changed'));
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2">Loading tenants...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Typography variant="body2" color="error" data-testid="tenant-switcher-error">
        {error}
      </Typography>
    );
  }

  if (tenants.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No tenants configured
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="tenant-switcher-label">Tenant</InputLabel>
        <Select
          labelId="tenant-switcher-label"
          label="Tenant"
          value={tenantSlug}
          onChange={(e) => handleTenantChange(e.target.value)}
        >
          {tenants.map((t) => (
            <MenuItem key={t.id} value={t.slug}>
              {t.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl
        size="small"
        sx={{ minWidth: 160 }}
        disabled={workspaces.length === 0}
      >
        <InputLabel id="workspace-switcher-label">Workspace</InputLabel>
        <Select
          labelId="workspace-switcher-label"
          label="Workspace"
          value={workspaceSlug}
          onChange={(e) => handleWorkspaceChange(e.target.value)}
        >
          {workspaces.map((w) => (
            <MenuItem key={w.id} value={w.slug}>
              {w.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
}
