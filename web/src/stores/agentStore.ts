import { create } from 'zustand';
import type { Agent, AgentType } from '../api/types';
import { agentApi } from '../api/client';

interface AgentState {
  agents: Agent[];
  agentTypes: AgentType[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchAgents: () => Promise<void>;
  fetchAgentTypes: () => Promise<void>;
  spawnAgent: (type: string, name?: string) => Promise<Agent>;
  stopAgent: (id: string) => Promise<void>;
  updateAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  clearError: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  agentTypes: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await agentApi.list();
      set({ agents, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch agents',
      });
    }
  },

  fetchAgentTypes: async () => {
    try {
      const agentTypes = await agentApi.getTypes();
      set({ agentTypes });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch agent types',
      });
    }
  },

  spawnAgent: async (type: string, name?: string) => {
    set({ loading: true, error: null });
    try {
      const agent = await agentApi.spawn({ type, name });
      set((state) => ({
        agents: [...state.agents, agent],
        loading: false,
      }));
      return agent;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to spawn agent',
      });
      throw error;
    }
  },

  stopAgent: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await agentApi.stop(id);
      set((state) => ({
        agents: state.agents.filter((a) => a.id !== id),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to stop agent',
      });
      throw error;
    }
  },

  updateAgent: (agent: Agent) => {
    set((state) => ({
      agents: state.agents.map((a) => (a.id === agent.id ? agent : a)),
    }));
  },

  removeAgent: (id: string) => {
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
    }));
  },

  clearError: () => set({ error: null }),
}));
