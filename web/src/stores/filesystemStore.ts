import { create } from 'zustand';
import type { FileSystemEntry, PathValidation } from '../api/types';
import { filesystemApi } from '../api/client';

interface FilesystemState {
  currentPath: string;
  entries: FileSystemEntry[];
  roots: FileSystemEntry[];
  parentPath: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchRoots: () => Promise<void>;
  browse: (path?: string, options?: { showHidden?: boolean; showFiles?: boolean }) => Promise<void>;
  navigateUp: () => Promise<void>;
  validatePath: (path: string) => Promise<PathValidation>;
  setCurrentPath: (path: string) => void;
  clearError: () => void;
}

export const useFilesystemStore = create<FilesystemState>((set, get) => ({
  currentPath: '',
  entries: [],
  roots: [],
  parentPath: null,
  loading: false,
  error: null,

  fetchRoots: async () => {
    set({ loading: true, error: null });
    try {
      const roots = await filesystemApi.getRoots();
      set({ roots, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch roots',
      });
    }
  },

  browse: async (path, options) => {
    set({ loading: true, error: null });
    try {
      const result = await filesystemApi.browse({
        path,
        showHidden: options?.showHidden,
        showFiles: options?.showFiles,
      });
      set({
        currentPath: result.path,
        entries: result.entries,
        parentPath: result.parent,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to browse directory',
      });
    }
  },

  navigateUp: async () => {
    const { parentPath } = get();
    if (parentPath) {
      await get().browse(parentPath);
    }
  },

  validatePath: async (path) => {
    set({ loading: true, error: null });
    try {
      const validation = await filesystemApi.validate(path);
      set({ loading: false });
      return validation;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to validate path',
      });
      throw error;
    }
  },

  setCurrentPath: (path) => {
    set({ currentPath: path });
  },

  clearError: () => set({ error: null }),
}));
