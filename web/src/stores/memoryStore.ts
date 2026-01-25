import { create } from 'zustand';
import type { MemoryEntry, MemorySearchResult } from '../api/types';
import { memoryApi } from '../api/client';

interface MemoryState {
  entries: MemoryEntry[];
  searchResults: MemorySearchResult[];
  pagination: { limit: number; offset: number; total: number };
  loading: boolean;
  searching: boolean;
  error: string | null;

  // Actions
  fetchEntries: (options?: { namespace?: string; limit?: number; offset?: number }) => Promise<void>;
  search: (query: string, options?: { namespace?: string; limit?: number; useVector?: boolean }) => Promise<void>;
  storeEntry: (key: string, content: string, namespace?: string, metadata?: Record<string, unknown>) => Promise<MemoryEntry>;
  deleteEntry: (key: string, namespace?: string) => Promise<void>;
  clearSearch: () => void;
  clearError: () => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  entries: [],
  searchResults: [],
  pagination: { limit: 50, offset: 0, total: 0 },
  loading: false,
  searching: false,
  error: null,

  fetchEntries: async (options) => {
    set({ loading: true, error: null });
    try {
      const result = await memoryApi.list(options);
      set({
        entries: result.data,
        pagination: result.pagination,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch entries',
      });
    }
  },

  search: async (query, options) => {
    set({ searching: true, error: null });
    try {
      const results = await memoryApi.search(query, options);
      set({ searchResults: results, searching: false });
    } catch (error) {
      set({
        searching: false,
        error: error instanceof Error ? error.message : 'Search failed',
      });
    }
  },

  storeEntry: async (key, content, namespace, metadata) => {
    set({ loading: true, error: null });
    try {
      const entry = await memoryApi.store({ key, content, namespace, metadata });
      set((state) => ({
        entries: [...state.entries, entry],
        loading: false,
      }));
      return entry;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to store entry',
      });
      throw error;
    }
  },

  deleteEntry: async (key, namespace) => {
    set({ loading: true, error: null });
    try {
      await memoryApi.delete(key, namespace);
      set((state) => ({
        entries: state.entries.filter((e) => e.key !== key),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to delete entry',
      });
      throw error;
    }
  },

  clearSearch: () => set({ searchResults: [] }),
  clearError: () => set({ error: null }),
}));
