import { create } from 'zustand';
import type { ReviewLoop, ReviewLoopDetails, LaunchReviewLoopRequest } from '../api/types';
import { reviewLoopApi } from '../api/client';

interface ReviewLoopState {
  loops: ReviewLoop[];
  selectedLoop: ReviewLoopDetails | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchLoops: () => Promise<void>;
  fetchLoop: (id: string) => Promise<void>;
  launchLoop: (data: LaunchReviewLoopRequest) => Promise<ReviewLoop>;
  abortLoop: (id: string) => Promise<void>;
  updateLoop: (loop: ReviewLoop) => void;
  removeLoop: (id: string) => void;
  clearError: () => void;
}

export const useReviewLoopStore = create<ReviewLoopState>((set) => ({
  loops: [],
  selectedLoop: null,
  loading: false,
  error: null,

  fetchLoops: async () => {
    set({ loading: true, error: null });
    try {
      const loops = await reviewLoopApi.list();
      set({ loops, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch review loops',
      });
    }
  },

  fetchLoop: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const loop = await reviewLoopApi.get(id);
      set({ selectedLoop: loop, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch review loop',
      });
    }
  },

  launchLoop: async (data: LaunchReviewLoopRequest) => {
    set({ loading: true, error: null });
    try {
      const response = await reviewLoopApi.launch(data);
      // Convert LaunchReviewLoopResponse to ReviewLoop
      const loop: ReviewLoop = {
        ...response,
        reviewCount: 0,
      };
      set((state) => ({
        loops: [...state.loops, loop],
        loading: false,
      }));
      return loop;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to launch review loop',
      });
      throw error;
    }
  },

  abortLoop: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await reviewLoopApi.abort(id);
      set((state) => ({
        loops: state.loops.filter((l) => l.id !== id),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to abort review loop',
      });
      throw error;
    }
  },

  updateLoop: (loop: ReviewLoop) => {
    set((state) => ({
      loops: state.loops.map((l) => (l.id === loop.id ? loop : l)),
    }));
  },

  removeLoop: (id: string) => {
    set((state) => ({
      loops: state.loops.filter((l) => l.id !== id),
    }));
  },

  clearError: () => set({ error: null }),
}));
