import { create } from 'zustand';
import type {
  Specification,
  CreateSpecificationRequest,
  UpdateSpecificationRequest,
  ApproveSpecificationRequest,
  RejectSpecificationRequest,
  SpecificationStatus,
} from '../api/types';
import { specificationApi } from '../api/client';

interface SpecificationState {
  specifications: Specification[];
  currentSpec: Specification | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchSpecifications: (taskId: string, status?: SpecificationStatus) => Promise<void>;
  fetchSpecification: (specId: string) => Promise<void>;
  createSpecification: (taskId: string, data: CreateSpecificationRequest) => Promise<Specification>;
  updateSpecification: (specId: string, data: UpdateSpecificationRequest) => Promise<void>;
  deleteSpecification: (specId: string) => Promise<void>;
  submitForReview: (specId: string) => Promise<void>;
  approveSpecification: (specId: string, data: ApproveSpecificationRequest) => Promise<void>;
  rejectSpecification: (specId: string, data: RejectSpecificationRequest) => Promise<void>;
  setCurrentSpec: (spec: Specification | null) => void;
  clearSpecs: () => void;
  clearError: () => void;
}

export const useSpecificationStore = create<SpecificationState>((set) => ({
  specifications: [],
  currentSpec: null,
  loading: false,
  error: null,

  fetchSpecifications: async (taskId, status) => {
    set({ loading: true, error: null });
    try {
      const specifications = await specificationApi.list(taskId, status);
      set({ specifications, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch specifications',
      });
    }
  },

  fetchSpecification: async (specId) => {
    set({ loading: true, error: null });
    try {
      const spec = await specificationApi.get(specId);
      set({ currentSpec: spec, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch specification',
      });
    }
  },

  createSpecification: async (taskId, data) => {
    set({ loading: true, error: null });
    try {
      const spec = await specificationApi.create(taskId, data);
      set((state) => ({
        specifications: [...state.specifications, spec],
        loading: false,
      }));
      return spec;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to create specification',
      });
      throw error;
    }
  },

  updateSpecification: async (specId, data) => {
    set({ loading: true, error: null });
    try {
      const updated = await specificationApi.update(specId, data);
      set((state) => ({
        specifications: state.specifications.map((s) => (s.id === specId ? updated : s)),
        currentSpec: state.currentSpec?.id === specId ? updated : state.currentSpec,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to update specification',
      });
      throw error;
    }
  },

  deleteSpecification: async (specId) => {
    set({ loading: true, error: null });
    try {
      await specificationApi.delete(specId);
      set((state) => ({
        specifications: state.specifications.filter((s) => s.id !== specId),
        currentSpec: state.currentSpec?.id === specId ? null : state.currentSpec,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to delete specification',
      });
      throw error;
    }
  },

  submitForReview: async (specId) => {
    set({ loading: true, error: null });
    try {
      const updated = await specificationApi.submit(specId);
      set((state) => ({
        specifications: state.specifications.map((s) => (s.id === specId ? updated : s)),
        currentSpec: state.currentSpec?.id === specId ? updated : state.currentSpec,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to submit specification for review',
      });
      throw error;
    }
  },

  approveSpecification: async (specId, data) => {
    set({ loading: true, error: null });
    try {
      const updated = await specificationApi.approve(specId, data);
      set((state) => ({
        specifications: state.specifications.map((s) => (s.id === specId ? updated : s)),
        currentSpec: state.currentSpec?.id === specId ? updated : state.currentSpec,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to approve specification',
      });
      throw error;
    }
  },

  rejectSpecification: async (specId, data) => {
    set({ loading: true, error: null });
    try {
      const updated = await specificationApi.reject(specId, data);
      set((state) => ({
        specifications: state.specifications.map((s) => (s.id === specId ? updated : s)),
        currentSpec: state.currentSpec?.id === specId ? updated : state.currentSpec,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to reject specification',
      });
      throw error;
    }
  },

  setCurrentSpec: (spec) => {
    set({ currentSpec: spec });
  },

  clearSpecs: () => {
    set({
      specifications: [],
      currentSpec: null,
    });
  },

  clearError: () => set({ error: null }),
}));
