import { create } from 'zustand';
import type { Task, TaskQueueStatus } from '../api/types';
import { taskApi } from '../api/client';

interface TaskState {
  tasks: Task[];
  queueStatus: TaskQueueStatus | null;
  pagination: { limit: number; offset: number; total: number };
  loading: boolean;
  error: string | null;

  // Actions
  fetchTasks: (options?: { sessionId?: string; status?: string; limit?: number; offset?: number }) => Promise<void>;
  fetchQueueStatus: () => Promise<void>;
  createTask: (agentType: string, input?: string, priority?: number) => Promise<Task>;
  completeTask: (id: string, output?: string) => Promise<void>;
  clearError: () => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  queueStatus: null,
  pagination: { limit: 50, offset: 0, total: 0 },
  loading: false,
  error: null,

  fetchTasks: async (options) => {
    set({ loading: true, error: null });
    try {
      const result = await taskApi.list(options);
      set({
        tasks: result.data,
        pagination: result.pagination,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch tasks',
      });
    }
  },

  fetchQueueStatus: async () => {
    try {
      const queueStatus = await taskApi.getQueue();
      set({ queueStatus });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch queue status',
      });
    }
  },

  createTask: async (agentType, input, priority) => {
    set({ loading: true, error: null });
    try {
      const task = await taskApi.create({ agentType, input, priority });
      set((state) => ({
        tasks: [...state.tasks, task],
        loading: false,
      }));
      return task;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to create task',
      });
      throw error;
    }
  },

  completeTask: async (id, output) => {
    set({ loading: true, error: null });
    try {
      const task = await taskApi.complete(id, output);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? task : t)),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to complete task',
      });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
