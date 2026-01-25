import { create } from 'zustand';
import type { SystemStatus, HealthCheck } from '../api/types';
import { systemApi } from '../api/client';

interface SystemState {
  status: SystemStatus | null;
  health: HealthCheck | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchStatus: () => Promise<void>;
  fetchHealth: () => Promise<void>;
  clearError: () => void;
}

export const useSystemStore = create<SystemState>((set) => ({
  status: null,
  health: null,
  loading: false,
  error: null,

  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const status = await systemApi.getStatus();
      set({ status, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch status',
      });
    }
  },

  fetchHealth: async () => {
    try {
      const health = await systemApi.getHealth();
      set({ health });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch health',
      });
    }
  },

  clearError: () => set({ error: null }),
}));
