# API Reference

> Complete API documentation for AgentStack

## Overview

AgentStack provides three API surfaces:

1. **MCP Tools** - 30 tools exposed via Model Context Protocol for Claude Code
2. **Programmatic API** - TypeScript/JavaScript library exports
3. **CLI Commands** - Command-line interface

## MCP Tools Reference

### Agent Tools

#### `agent_spawn`

Create a new agent instance.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "Type of agent to spawn",
      "enum": ["coder", "researcher", "tester", "reviewer", "architect", "coordinator", "analyst"]
    },
    "name": {
      "type": "string",
      "description": "Optional name for the agent"
    },
    "sessionId": {
      "type": "string",
      "description": "Optional session to associate with"
    },
    "metadata": {
      "type": "object",
      "description": "Optional metadata"
    }
  },
  "required": ["type"]
}
```

**Response**:
```json
{
  "success": true,
  "agent": {
    "id": "uuid-v4",
    "type": "coder",
    "name": "coder-1",
    "status": "idle",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "prompt": "You are an expert software engineer..."
}
```

---

#### `agent_list`

List active agents.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Filter by session ID"
    }
  }
}
```

**Response**:
```json
{
  "agents": [
    {
      "id": "uuid-v4",
      "type": "coder",
      "name": "coder-1",
      "status": "running",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "sessionId": "session-1"
    }
  ],
  "count": 1
}
```

---

#### `agent_stop`

Stop an agent.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Agent ID to stop"
    },
    "name": {
      "type": "string",
      "description": "Agent name to stop (alternative to ID)"
    }
  }
}
```

**Response**:
```json
{
  "success": true,
  "agentId": "uuid-v4"
}
```

---

#### `agent_status`

Get agent details and capabilities.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Agent ID"
    },
    "name": {
      "type": "string",
      "description": "Agent name (alternative)"
    }
  }
}
```

**Response**:
```json
{
  "agent": {
    "id": "uuid-v4",
    "type": "coder",
    "name": "coder-1",
    "status": "running"
  },
  "capabilities": ["write-code", "edit-code", "refactor", "debug"],
  "systemPrompt": "You are an expert software engineer..."
}
```

---

#### `agent_types`

List available agent types.

**Input Schema**: None required

**Response**:
```json
{
  "types": [
    {
      "type": "coder",
      "name": "Coder Agent",
      "description": "Expert software engineer for writing and editing code",
      "capabilities": ["write-code", "edit-code", "refactor", "debug"]
    }
  ],
  "count": 7
}
```

---

#### `agent_update_status`

Update an agent's status.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": ["idle", "running", "completed", "failed", "stopped"]
    }
  },
  "required": ["id", "status"]
}
```

---

### Memory Tools

#### `memory_store`

Store a key-value entry.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "string",
      "description": "Unique key for the entry"
    },
    "content": {
      "type": "string",
      "description": "Content to store"
    },
    "namespace": {
      "type": "string",
      "description": "Namespace (default: 'default')"
    },
    "metadata": {
      "type": "object",
      "description": "Additional metadata"
    },
    "generateEmbedding": {
      "type": "boolean",
      "description": "Generate vector embedding"
    }
  },
  "required": ["key", "content"]
}
```

**Response**:
```json
{
  "success": true,
  "entry": {
    "id": "uuid-v4",
    "key": "pattern-singleton",
    "namespace": "architecture",
    "content": "Use singleton for config...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### `memory_search`

Search memory with hybrid FTS + vector search.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "namespace": {
      "type": "string",
      "description": "Namespace filter"
    },
    "limit": {
      "type": "number",
      "description": "Max results (default: 10)"
    },
    "threshold": {
      "type": "number",
      "description": "Vector similarity threshold (default: 0.7)"
    },
    "useVector": {
      "type": "boolean",
      "description": "Enable vector search"
    }
  },
  "required": ["query"]
}
```

**Response**:
```json
{
  "count": 2,
  "results": [
    {
      "entry": {
        "id": "uuid-v4",
        "key": "pattern-singleton",
        "content": "..."
      },
      "score": 0.95,
      "matchType": "vector"
    }
  ]
}
```

---

#### `memory_get`

Get entry by key.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "key": { "type": "string" },
    "namespace": { "type": "string" }
  },
  "required": ["key"]
}
```

---

#### `memory_list`

List entries with pagination.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "namespace": { "type": "string" },
    "limit": { "type": "number", "default": 20 },
    "offset": { "type": "number", "default": 0 }
  }
}
```

---

#### `memory_delete`

Delete an entry.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "key": { "type": "string" },
    "namespace": { "type": "string" }
  },
  "required": ["key"]
}
```

---

### Task Tools

#### `task_create`

Create a task for an agent type.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentType": {
      "type": "string",
      "description": "Target agent type"
    },
    "input": {
      "type": "string",
      "description": "Task input/description"
    },
    "sessionId": {
      "type": "string",
      "description": "Session to associate with"
    }
  },
  "required": ["agentType"]
}
```

**Response**:
```json
{
  "success": true,
  "task": {
    "id": "uuid-v4",
    "agentType": "coder",
    "status": "pending",
    "input": "Implement feature X",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### `task_assign`

Assign task to specific agent.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" },
    "agentId": { "type": "string" }
  },
  "required": ["taskId", "agentId"]
}
```

---

#### `task_complete`

Mark task as complete.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" },
    "output": { "type": "string" }
  },
  "required": ["taskId"]
}
```

---

#### `task_list`

List tasks with filters.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": { "type": "string" },
    "status": {
      "type": "string",
      "enum": ["pending", "running", "completed", "failed"]
    }
  }
}
```

---

#### `task_get`

Get task details.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" }
  },
  "required": ["taskId"]
}
```

---

### Session Tools

#### `session_start`

Create a new session.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "metadata": { "type": "object" }
  }
}
```

**Response**:
```json
{
  "success": true,
  "session": {
    "id": "uuid-v4",
    "status": "active",
    "startedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### `session_end`

End the active session.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": { "type": "string" }
  }
}
```

---

#### `session_status`

Get session info.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": { "type": "string" }
  },
  "required": ["sessionId"]
}
```

---

#### `session_active`

Get current active session.

**Input Schema**: None required

---

### System Tools

#### `system_status`

Get system statistics.

**Input Schema**: None required

**Response**:
```json
{
  "agents": {
    "active": 3,
    "byStatus": {
      "idle": 1,
      "running": 2
    }
  },
  "memory": {
    "entries": 150,
    "namespaces": ["default", "architecture"]
  },
  "tasks": {
    "pending": 5,
    "processing": 2
  }
}
```

---

#### `system_health`

Get system health check.

**Input Schema**: None required

**Response**:
```json
{
  "status": "healthy",
  "checks": {
    "database": true,
    "vectorSearch": true,
    "github": false
  }
}
```

---

#### `system_config`

Get current configuration.

**Input Schema**: None required

---

### GitHub Tools

#### `github_issue_create`

Create a GitHub issue.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "title": { "type": "string" },
    "body": { "type": "string" },
    "labels": { "type": "array", "items": { "type": "string" } },
    "assignees": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["owner", "repo", "title"]
}
```

---

#### `github_issue_list`

List repository issues.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "state": { "type": "string", "enum": ["open", "closed", "all"] },
    "labels": { "type": "string" },
    "limit": { "type": "number" }
  },
  "required": ["owner", "repo"]
}
```

---

#### `github_issue_get`

Get issue details.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "number": { "type": "number" }
  },
  "required": ["owner", "repo", "number"]
}
```

---

#### `github_pr_create`

Create a pull request.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "title": { "type": "string" },
    "head": { "type": "string", "description": "Branch with changes" },
    "base": { "type": "string", "description": "Target branch" },
    "body": { "type": "string" },
    "draft": { "type": "boolean" }
  },
  "required": ["owner", "repo", "title", "head", "base"]
}
```

---

#### `github_pr_list`

List pull requests.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "state": { "type": "string", "enum": ["open", "closed", "all"] },
    "limit": { "type": "number" }
  },
  "required": ["owner", "repo"]
}
```

---

#### `github_pr_get`

Get PR details.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "number": { "type": "number" }
  },
  "required": ["owner", "repo", "number"]
}
```

---

#### `github_repo_info`

Get repository information.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" }
  },
  "required": ["owner", "repo"]
}
```

---

## Programmatic API

### Configuration

```typescript
import { loadConfig, getConfig, saveConfig, validateConfig } from '@blackms/aistack';

// Load from file
const config = loadConfig('./aistack.config.json');

// Get cached singleton
const config = getConfig();

// Save configuration
saveConfig(config, './aistack.config.json');

// Validate
const { valid, errors } = validateConfig(config);
```

### Memory Manager

```typescript
import { getMemoryManager, MemoryManager } from '@blackms/aistack';

// Get singleton
const memory = getMemoryManager();

// Or create new instance
const memory = new MemoryManager(config);

// Store
const entry = await memory.store('key', 'content', {
  namespace: 'myns',
  metadata: { tags: ['important'] },
  generateEmbedding: true
});

// Search
const results = await memory.search('query', {
  namespace: 'myns',
  limit: 10,
  threshold: 0.7,
  useVector: true
});

// Get/Delete
const entry = memory.get('key', 'myns');
memory.delete('key', 'myns');

// Sessions
const session = memory.createSession({ project: 'myproject' });
memory.endSession(session.id);

// Tasks
const task = memory.createTask('coder', 'implement feature', session.id);
memory.updateTaskStatus(task.id, 'completed', 'Done');
```

### Agents

```typescript
import {
  spawnAgent,
  getAgent,
  listAgents,
  stopAgent,
  getAgentDefinition,
  registerAgent
} from '@blackms/aistack';

// Spawn agent
const agent = spawnAgent('coder', {
  name: 'my-coder',
  sessionId: 'session-1',
  metadata: { project: 'myproject' }
});

// Get by ID or name
const agent = getAgent('uuid');
const agent = getAgentByName('my-coder');

// List agents
const agents = listAgents('session-1');

// Stop
stopAgent(agent.id);

// Update status
updateAgentStatus(agent.id, 'running');

// Register custom agent
registerAgent({
  type: 'my-agent',
  name: 'My Custom Agent',
  description: 'Does custom things',
  systemPrompt: 'You are a custom agent...',
  capabilities: ['custom-capability']
});
```

### Providers

```typescript
import { createProvider, AnthropicProvider, OpenAIProvider, OllamaProvider } from '@blackms/aistack';

// Create from config
const provider = createProvider(config);

// Or create directly
const anthropic = new AnthropicProvider(apiKey, 'claude-sonnet-4-20250514');
const openai = new OpenAIProvider(apiKey, 'gpt-4o');
const ollama = new OllamaProvider('http://localhost:11434', 'llama3.2');

// Chat
const response = await provider.chat([
  { role: 'user', content: 'Hello' }
], {
  temperature: 0.7,
  maxTokens: 1000
});

// Embeddings (OpenAI and Ollama only - Anthropic does not implement embed())
const embedding = await provider.embed?.('text to embed');
```

### Coordination

```typescript
import { TaskQueue, MessageBus, HierarchicalCoordinator, getMessageBus } from '@blackms/aistack';

// Task Queue
const queue = new TaskQueue();
queue.enqueue(task, 8); // priority 1-10
queue.on('task:added', () => console.log('Task added'));
const task = queue.dequeue('coder');
queue.assign(task.id, agentId);
queue.complete(task.id);

// Message Bus
const bus = getMessageBus();
bus.send(fromId, toId, 'task:assign', { task });
bus.broadcast(fromId, 'status:update', { status: 'ready' });
const unsubscribe = bus.subscribe(agentId, (msg) => console.log(msg));

// Hierarchical Coordinator
const coordinator = new HierarchicalCoordinator({
  maxWorkers: 5,
  sessionId: 'session-1'
});
await coordinator.initialize();
await coordinator.submitTask(task, 8);
const status = coordinator.getStatus();
await coordinator.shutdown();
```

### Workflows

```typescript
import { WorkflowRunner, getWorkflowRunner, runDocSync } from '@blackms/aistack';

// Get runner
const runner = getWorkflowRunner();

// Register phase executor
runner.registerPhase('inventory', async (context) => {
  // Phase logic
  return {
    phase: 'inventory',
    success: true,
    findings: [],
    artifacts: { files: ['file1.md'] },
    duration: 0
  };
});

// Run workflow
const report = await runner.run({
  id: 'my-workflow',
  name: 'My Workflow',
  phases: ['inventory', 'analysis', 'sync'],
  maxIterations: 3
});

// Events
runner.on('workflow:start', (config) => {});
runner.on('phase:complete', (result) => {});
runner.on('finding', (finding) => {});
runner.on('workflow:complete', (report) => {});

// Built-in doc sync
const report = await runDocSync('./docs', './src');
```

### Plugins

```typescript
import { loadPlugin, discoverPlugins, listPlugins, getPlugin } from '@blackms/aistack';

// Load single plugin
const plugin = await loadPlugin('./plugins/my-plugin', config);

// Discover all plugins in directory
const count = await discoverPlugins(config);

// List loaded plugins
const plugins = listPlugins();

// Get by name
const plugin = getPlugin('my-plugin');
```

### Hooks

```typescript
import { registerHook, executeHooks, registerWorkflowTrigger } from '@blackms/aistack';

// Register custom hook
// Note: handler receives three parameters: context, memory, and config
registerHook('post-task', async (context, memory, config) => {
  console.log('Task completed:', context.taskId);
  // Access memory manager and config as needed
});

// Register workflow trigger
registerWorkflowTrigger({
  id: 'auto-docs',
  name: 'Auto Docs Sync',
  condition: (context) => context.data?.docsChanged === true,
  workflowId: 'doc-sync',
  options: { maxIterations: 3 }
});

// Execute hooks (internal use)
await executeHooks('post-task', context, memory, config);
```

### MCP Server

```typescript
import { startMCPServer, MCPServer } from '@blackms/aistack';

// Start server
const server = await startMCPServer(config);

// Or create manually
const server = new MCPServer(config);
await server.start();

// Get tool info
const toolCount = server.getToolCount();
const toolNames = server.getToolNames();

// Stop
await server.stop();
```

---

## CLI Commands

### `aistack init`

Initialize a new AgentStack project.

```bash
npx aistack init
npx aistack init --path ./myproject
```

Creates:
- `aistack.config.json`
- `data/` directory
- `plugins/` directory

### `aistack agent`

Agent management commands.

```bash
# Spawn agent
npx aistack agent spawn -t coder -n my-coder

# List agents
npx aistack agent list
npx aistack agent list --session session-1

# Stop agent
npx aistack agent stop -i <agent-id>
npx aistack agent stop -n my-coder

# Get agent status
npx aistack agent status -i <agent-id>
npx aistack agent status -n my-coder

# List available agent types
npx aistack agent types

# Run a task with a new agent (spawn + execute)
npx aistack agent run -t coder -p "Write a function to parse JSON"
npx aistack agent run -t reviewer -p @task.txt --context @code.ts --provider claude-code
npx aistack agent run -t architect -p "Design API" --provider gemini-cli --model gemini-2.0-flash

# Execute a task with an existing agent
npx aistack agent exec -i <agent-id> -p "Refactor this function"
npx aistack agent exec -n my-coder -p @task.txt --context @code.ts --provider anthropic
```

**Agent run/exec options**:
- `-t, --type <type>`: Agent type (required for `run`)
- `-p, --prompt <prompt>`: Task prompt (use `@file` to read from file)
- `-n, --name <name>`: Agent name
- `-i, --id <id>`: Agent ID (for `exec`)
- `--provider <provider>`: LLM provider (anthropic, openai, ollama, claude-code, gemini-cli, codex)
- `--model <model>`: Model to use
- `--context <context>`: Additional context (use `@file` to read from file)
- `--show-prompt`: Display agent system prompt before execution

### `aistack memory`

Memory operations.

```bash
# Store
npx aistack memory store -k "pattern" -c "Use singleton for config"
npx aistack memory store -k "pattern" -c "content" -n architecture

# Search
npx aistack memory search -q "singleton"
npx aistack memory search -q "pattern" -n architecture -l 5
```

### `aistack mcp`

MCP server commands.

```bash
# Start server (for Claude Code integration)
npx aistack mcp start
```

### `aistack plugin`

Plugin management.

```bash
# Add plugin
npx aistack plugin add ./my-plugin

# List plugins
npx aistack plugin list

# Remove plugin
npx aistack plugin remove my-plugin
```

### `aistack status`

Show system status.

```bash
npx aistack status
```

### `aistack workflow`

Workflow commands.

```bash
# Run workflow
npx aistack workflow run doc-sync
npx aistack workflow run doc-sync --docs ./docs --src ./src
```

### Global Options

```bash
-v, --verbose    # Set log level to debug
-q, --quiet      # Set log level to error
```

---

## Error Handling

All MCP tools return errors in a consistent format:

```json
{
  "error": "Error message description"
}
```

Programmatic API methods may throw errors which should be caught:

```typescript
try {
  const agent = spawnAgent('unknown-type');
} catch (error) {
  console.error('Failed to spawn agent:', error.message);
}
```

## Related Documents

- [HLD.md](HLD.md) - High-level design
- [LLD.md](LLD.md) - Low-level design
- [DATA.md](DATA.md) - Data models
