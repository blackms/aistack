import { create } from 'zustand';
import type {
  ProjectTask,
  CreateProjectTaskRequest,
  UpdateProjectTaskRequest,
  TaskPhase,
} from '../api/types';
import { projectApi } from '../api/client';

interface ProjectTaskState {
  tasks: ProjectTask[];
  tasksByPhase: Record<TaskPhase, ProjectTask[]>;
  currentTask: ProjectTask | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchTasks: (projectId: string, phase?: TaskPhase) => Promise<void>;
  fetchTask: (projectId: string, taskId: string) => Promise<void>;
  createTask: (projectId: string, data: CreateProjectTaskRequest) => Promise<ProjectTask>;
  updateTask: (projectId: string, taskId: string, data: UpdateProjectTaskRequest) => Promise<void>;
  deleteTask: (projectId: string, taskId: string) => Promise<void>;
  transitionPhase: (projectId: string, taskId: string, phase: TaskPhase) => Promise<void>;
  assignAgents: (projectId: string, taskId: string, agents: string[]) => Promise<void>;
  setCurrentTask: (task: ProjectTask | null) => void;
  clearTasks: () => void;
  clearError: () => void;
}

function groupTasksByPhase(tasks: ProjectTask[]): Record<TaskPhase, ProjectTask[]> {
  const grouped: Record<TaskPhase, ProjectTask[]> = {
    draft: [],
    specification: [],
    review: [],
    development: [],
    completed: [],
    cancelled: [],
  };

  for (const task of tasks) {
    if (grouped[task.phase]) {
      grouped[task.phase].push(task);
    }
  }

  return grouped;
}

export const useProjectTaskStore = create<ProjectTaskState>((set, get) => ({
  tasks: [],
  tasksByPhase: groupTasksByPhase([]),
  currentTask: null,
  loading: false,
  error: null,

  fetchTasks: async (projectId, phase) => {
    set({ loading: true, error: null });
    try {
      const tasks = await projectApi.listTasks(projectId, phase);
      set({
        tasks,
        tasksByPhase: groupTasksByPhase(tasks),
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch tasks',
      });
    }
  },

  fetchTask: async (projectId, taskId) => {
    set({ loading: true, error: null });
    try {
      const task = await projectApi.getTask(projectId, taskId);
      set({ currentTask: task, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch task',
      });
    }
  },

  createTask: async (projectId, data) => {
    set({ loading: true, error: null });
    try {
      const task = await projectApi.createTask(projectId, data);
      const tasks = [...get().tasks, task];
      set({
        tasks,
        tasksByPhase: groupTasksByPhase(tasks),
        loading: false,
      });
      return task;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to create task',
      });
      throw error;
    }
  },

  updateTask: async (projectId, taskId, data) => {
    set({ loading: true, error: null });
    try {
      const updated = await projectApi.updateTask(projectId, taskId, data);
      const tasks = get().tasks.map((t) => (t.id === taskId ? updated : t));
      set({
        tasks,
        tasksByPhase: groupTasksByPhase(tasks),
        currentTask: get().currentTask?.id === taskId ? updated : get().currentTask,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to update task',
      });
      throw error;
    }
  },

  deleteTask: async (projectId, taskId) => {
    set({ loading: true, error: null });
    try {
      await projectApi.deleteTask(projectId, taskId);
      const tasks = get().tasks.filter((t) => t.id !== taskId);
      set({
        tasks,
        tasksByPhase: groupTasksByPhase(tasks),
        currentTask: get().currentTask?.id === taskId ? null : get().currentTask,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to delete task',
      });
      throw error;
    }
  },

  transitionPhase: async (projectId, taskId, phase) => {
    set({ loading: true, error: null });
    try {
      const updated = await projectApi.transitionPhase(projectId, taskId, phase);
      const tasks = get().tasks.map((t) => (t.id === taskId ? updated : t));
      set({
        tasks,
        tasksByPhase: groupTasksByPhase(tasks),
        currentTask: get().currentTask?.id === taskId ? updated : get().currentTask,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to transition phase',
      });
      throw error;
    }
  },

  assignAgents: async (projectId, taskId, agents) => {
    set({ loading: true, error: null });
    try {
      const updated = await projectApi.assignAgents(projectId, taskId, agents);
      const tasks = get().tasks.map((t) => (t.id === taskId ? updated : t));
      set({
        tasks,
        tasksByPhase: groupTasksByPhase(tasks),
        currentTask: get().currentTask?.id === taskId ? updated : get().currentTask,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to assign agents',
      });
      throw error;
    }
  },

  setCurrentTask: (task) => {
    set({ currentTask: task });
  },

  clearTasks: () => {
    set({
      tasks: [],
      tasksByPhase: groupTasksByPhase([]),
      currentTask: null,
    });
  },

  clearError: () => set({ error: null }),
}));
