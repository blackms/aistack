# agentstack

Clean agent orchestration for Claude Code.

## Features

- **7 Core Agents**: coder, researcher, tester, reviewer, architect, coordinator, analyst
- **25 MCP Tools**: Agent, memory, task, session, system, and GitHub operations
- **SQLite + FTS5**: Full-text search with optional vector search
- **Multi-Provider**: Anthropic, OpenAI, Ollama support
- **Plugin System**: Extend with custom agents and tools
- **4 Hooks**: session-start, session-end, pre-task, post-task

## Installation

```bash
npm install agentstack
```

## Quick Start

```bash
# Initialize project
npx agentstack init

# Add MCP server to Claude Code
claude mcp add agentstack -- npx agentstack mcp start

# Check status
npx agentstack status
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize a new project |
| `agent` | Manage agents (spawn, list, stop, status) |
| `memory` | Memory operations (store, search, list, delete) |
| `mcp` | Start MCP server |
| `plugin` | Plugin management |
| `status` | System status |

## Usage Examples

### Memory Operations

```bash
# Store a key-value pair
npx agentstack memory store -k "auth-pattern" -v "Use JWT with refresh tokens"

# Search memory
npx agentstack memory search -q "authentication"

# List entries
npx agentstack memory list -n my-namespace
```

### Agent Operations

```bash
# Spawn an agent
npx agentstack agent spawn -t coder -n my-coder

# List active agents
npx agentstack agent list

# Get agent status
npx agentstack agent status -n my-coder

# Stop an agent
npx agentstack agent stop -n my-coder

# List available agent types
npx agentstack agent types
```

### MCP Server

```bash
# Start MCP server
npx agentstack mcp start

# List available tools
npx agentstack mcp tools
```

## Configuration

Create `agentstack.config.json`:

```json
{
  "version": "1.0.0",
  "memory": {
    "path": "./data/agentstack.db",
    "defaultNamespace": "default",
    "vectorSearch": {
      "enabled": false,
      "provider": "openai",
      "model": "text-embedding-3-small"
    }
  },
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "agents": {
    "maxConcurrent": 5,
    "defaultTimeout": 300
  },
  "github": {
    "enabled": false,
    "useGhCli": true
  },
  "plugins": {
    "enabled": true,
    "directory": "./plugins"
  }
}
```

## MCP Tools

### Agent Tools
- `agent_spawn` - Spawn a new agent
- `agent_list` - List active agents
- `agent_stop` - Stop an agent
- `agent_status` - Get agent status
- `agent_types` - List available types
- `agent_update_status` - Update agent status

### Memory Tools
- `memory_store` - Store a key-value pair
- `memory_search` - Search memory
- `memory_get` - Get entry by key
- `memory_list` - List entries
- `memory_delete` - Delete entry

### Task Tools
- `task_create` - Create a task
- `task_assign` - Assign to agent
- `task_complete` - Mark complete
- `task_list` - List tasks
- `task_get` - Get task by ID

### Session Tools
- `session_start` - Start session
- `session_end` - End session
- `session_status` - Get status
- `session_active` - Get active session

### System Tools
- `system_status` - Overall status
- `system_health` - Health checks
- `system_config` - Current config

### GitHub Tools (when enabled)
- `github_issue_create` - Create issue
- `github_issue_list` - List issues
- `github_issue_get` - Get issue
- `github_pr_create` - Create PR
- `github_pr_list` - List PRs
- `github_pr_get` - Get PR
- `github_repo_info` - Repo info

## Programmatic Usage

```typescript
import {
  spawnAgent,
  getMemoryManager,
  startMCPServer,
  getConfig,
} from 'agentstack';

// Get config
const config = getConfig();

// Spawn an agent
const agent = spawnAgent('coder', { name: 'my-coder' });

// Use memory
const memory = getMemoryManager(config);
await memory.store('key', 'value', { namespace: 'test' });
const results = await memory.search('query');

// Start MCP server
const server = await startMCPServer(config);
```

## Plugin Development

```typescript
// my-plugin/index.ts
import type { AgentStackPlugin } from 'agentstack';

export default {
  name: 'my-plugin',
  version: '1.0.0',
  agents: [
    {
      type: 'custom-agent',
      name: 'Custom Agent',
      description: 'Does custom things',
      systemPrompt: 'You are a custom agent...',
      capabilities: ['custom-capability'],
    }
  ],
  tools: [
    {
      name: 'custom_tool',
      description: 'A custom tool',
      inputSchema: { type: 'object', properties: {} },
      handler: async (params) => {
        return { result: 'done' };
      }
    }
  ]
} satisfies AgentStackPlugin;
```

## Architecture

```
agentstack/
├── src/
│   ├── cli/          # CLI commands
│   ├── agents/       # Agent definitions and spawner
│   ├── memory/       # SQLite store + FTS5 + vector search
│   ├── mcp/          # MCP server and tools
│   ├── providers/    # LLM providers
│   ├── coordination/ # Task queue and message bus
│   ├── plugins/      # Plugin system
│   ├── hooks/        # Event hooks
│   └── github/       # GitHub integration
└── tests/
```

## License

MIT
