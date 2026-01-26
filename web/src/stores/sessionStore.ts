import { create } from 'zustand';
import type { Session } from '../api/types';
import { sessionApi } from '../api/client';

interface SessionState {
  sessions: Session[];
  activeSession: Session | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchSessions: (status?: 'active' | 'ended') => Promise<void>;
  fetchActiveSession: () => Promise<void>;
  createSession: (metadata?: Record<string, unknown>) => Promise<Session>;
  endSession: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSession: null,
  loading: false,
  error: null,

  fetchSessions: async (status?: 'active' | 'ended') => {
    set({ loading: true, error: null });
    try {
      const sessions = await sessionApi.list({ status });
      set({ sessions, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch sessions',
      });
    }
  },

  fetchActiveSession: async () => {
    set({ loading: true, error: null });
    try {
      const activeSession = await sessionApi.getActive();
      set({ activeSession, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch active session',
      });
    }
  },

  createSession: async (metadata?: Record<string, unknown>) => {
    set({ loading: true, error: null });
    try {
      const session = await sessionApi.create(metadata);
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSession: session,
        loading: false,
      }));
      return session;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to create session',
      });
      throw error;
    }
  },

  endSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const session = await sessionApi.end(id);
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === id ? session : s)),
        activeSession: state.activeSession?.id === id ? null : state.activeSession,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to end session',
      });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
