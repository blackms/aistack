/**
 * Smart Dispatcher Integration tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStackConfig } from '../../src/types.js';
import { MemoryManager } from '../../src/memory/index.js';
import { createTaskTools } from '../../src/mcp/tools/task-tools.js';
import { SmartDispatcher } from '../../src/tasks/smart-dispatcher.js';

// Mock fetch for LLM API calls
const mockFetch = vi.fn();
const originalFetch = global.fetch;

// Helper to create test config
function createConfig(tmpDir: string, options?: {
  dispatcherEnabled?: boolean;
  anthropicKey?: string;
}): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpDir, 'memory.db'),
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: options?.anthropicKey ? { apiKey: options.anthropicKey } : undefined,
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    smartDispatcher: {
      enabled: options?.dispatcherEnabled ?? true,
      cacheEnabled: true,
      cacheTTLMs: 3600000,
      confidenceThreshold: 0.7,
      fallbackAgentType: 'coder',
      maxDescriptionLength: 1000,
    },
  };
}

// Helper to create mock LLM response
function createMockLLMResponse(agentType: string, confidence: number, reasoning: string) {
  return {
    ok: true,
    json: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ agentType, confidence, reasoning }),
        },
      ],
      model: 'claude-3-5-haiku-20241022',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  };
}

describe('Smart Dispatcher Integration', () => {
  let tmpDir: string;
  let memory: MemoryManager;
  let config: AgentStackConfig;

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;

    tmpDir = mkdtempSync(join(tmpdir(), 'smart-dispatch-test-'));
    config = createConfig(tmpDir, { dispatcherEnabled: true, anthropicKey: 'sk-test' });
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    memory.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('MCP task_create with auto-dispatch', () => {
    it('should auto-dispatch when agentType is not provided', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('coder', 0.95, 'Task involves implementing a REST endpoint')
      );

      const result = await tools.task_create.handler({
        input: 'Create a REST endpoint for user authentication',
        // agentType not provided
      });

      expect(result).toMatchObject({
        success: true,
        task: expect.objectContaining({
          agentType: 'coder',
        }),
        dispatch: expect.objectContaining({
          agentType: 'coder',
          confidence: 0.95,
          reasoning: 'Task involves implementing a REST endpoint',
        }),
      });
    });

    it('should use provided agentType when specified (backward compatibility)', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      const result = await tools.task_create.handler({
        agentType: 'tester',
        input: 'Create a REST endpoint for user authentication',
      });

      expect(result).toMatchObject({
        success: true,
        task: expect.objectContaining({
          agentType: 'tester', // Explicitly provided, not auto-dispatched
        }),
      });
      expect((result as { dispatch?: unknown }).dispatch).toBeUndefined();

      // No LLM call should have been made
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should use fallback when dispatcher is disabled', async () => {
      const disabledConfig = createConfig(tmpDir, { dispatcherEnabled: false });
      const dispatcher = new SmartDispatcher(disabledConfig);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, disabledConfig);

      const result = await tools.task_create.handler({
        input: 'Create a REST endpoint',
        // agentType not provided, dispatcher disabled
      });

      expect(result).toMatchObject({
        success: true,
        task: expect.objectContaining({
          agentType: 'coder', // Fallback
        }),
      });
      expect((result as { dispatch?: unknown }).dispatch).toBeUndefined();
    });

    it('should use fallback when no input is provided', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      const result = await tools.task_create.handler({
        // No input, no agentType
      });

      expect(result).toMatchObject({
        success: true,
        task: expect.objectContaining({
          agentType: 'coder', // Fallback
        }),
      });
    });

    it('should select different agent types based on task description', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      // Test various task types
      const testCases = [
        { input: 'Write unit tests for UserService', expectedAgent: 'tester' },
        { input: 'Review the authentication module code', expectedAgent: 'reviewer' },
        { input: 'Set up Docker containers for the app', expectedAgent: 'devops' },
        { input: 'Document the API endpoints', expectedAgent: 'documentation' },
        { input: 'Find all usages of deprecated methods', expectedAgent: 'researcher' },
      ];

      for (const testCase of testCases) {
        mockFetch.mockResolvedValueOnce(
          createMockLLMResponse(testCase.expectedAgent, 0.9, `${testCase.expectedAgent} task`)
        );

        const result = await tools.task_create.handler({
          input: testCase.input,
        });

        expect((result as { task: { agentType: string } }).task.agentType).toBe(testCase.expectedAgent);
      }
    });
  });

  describe('MCP task_create with dispatcher and other services', () => {
    it('should work alongside drift detection', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('coder', 0.9, 'Coding task')
      );

      const result = await tools.task_create.handler({
        input: 'Implement feature X',
      });

      expect(result).toMatchObject({
        success: true,
        task: expect.objectContaining({
          agentType: 'coder',
        }),
        dispatch: expect.objectContaining({
          agentType: 'coder',
        }),
      });
    });

    it('should handle LLM errors gracefully', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      mockFetch.mockRejectedValueOnce(new Error('API error'));

      const result = await tools.task_create.handler({
        input: 'Do something',
      });

      // Should still succeed with fallback agent
      expect(result).toMatchObject({
        success: true,
        task: expect.objectContaining({
          agentType: 'coder', // Fallback
        }),
      });
    });
  });

  describe('Task creation without MCP tools', () => {
    it('should create tasks with explicit agent type (backward compatibility)', () => {
      const task = memory.createTask('architect', 'Design the system');

      expect(task.agentType).toBe('architect');
      expect(task.input).toBe('Design the system');
    });

    it('should list tasks created with auto-dispatch', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      mockFetch.mockResolvedValue(
        createMockLLMResponse('coder', 0.9, 'Coding task')
      );

      await tools.task_create.handler({ input: 'Task 1' });
      await tools.task_create.handler({ input: 'Task 2' });
      await tools.task_create.handler({ agentType: 'tester', input: 'Task 3' });

      const listResult = await tools.task_list.handler({});

      expect((listResult as { count: number }).count).toBe(3);
      const tasks = (listResult as { tasks: Array<{ agentType: string }> }).tasks;
      expect(tasks[0].agentType).toBe('coder');
      expect(tasks[1].agentType).toBe('coder');
      expect(tasks[2].agentType).toBe('tester');
    });
  });

  describe('Dispatcher caching across task creations', () => {
    it('should cache dispatch results for identical descriptions', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('coder', 0.9, 'Coding task')
      );

      // First task
      const result1 = await tools.task_create.handler({
        input: 'Create a login function',
      });

      // Second task with identical description
      const result2 = await tools.task_create.handler({
        input: 'Create a login function',
      });

      expect((result1 as { dispatch?: { cached: boolean } }).dispatch?.cached).toBe(false);
      expect((result2 as { dispatch?: { cached: boolean } }).dispatch?.cached).toBe(true);

      // Only one LLM call should have been made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should make separate LLM calls for different descriptions', async () => {
      const dispatcher = new SmartDispatcher(config);
      const tools = createTaskTools(memory, undefined, undefined, dispatcher, config);

      mockFetch
        .mockResolvedValueOnce(createMockLLMResponse('coder', 0.9, 'Coding task'))
        .mockResolvedValueOnce(createMockLLMResponse('tester', 0.85, 'Testing task'));

      await tools.task_create.handler({
        input: 'Create a login function',
      });

      await tools.task_create.handler({
        input: 'Write tests for login',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
