# Onboarding Guide

> Getting started guide for new developers

## Welcome to AgentStack

AgentStack is a multi-agent orchestration framework for Claude Code. This guide will help you understand the codebase and start contributing.

## Quick Overview

```
AgentStack = Agents + Memory + Tools + Coordination
```

- **Agents**: Specialized AI assistants (coder, tester, reviewer, etc.)
- **Memory**: Persistent storage with search capabilities
- **Tools**: MCP interface for Claude Code
- **Coordination**: Task queue and message passing

## Prerequisites

Before starting, ensure you have:

- [ ] Node.js 20+ installed
- [ ] Git configured
- [ ] An Anthropic API key (for testing)
- [ ] Familiarity with TypeScript
- [ ] Basic understanding of SQLite

## Repository Setup

### Clone and Install

```bash
git clone https://github.com/blackms/aistack.git
cd aistack
npm install
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Development Mode

```bash
npm run dev  # Watch mode for TypeScript
```

## Project Structure

```
agentstack/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # Core type definitions
│   │
│   ├── agents/               # Agent system
│   │   ├── definitions/      # 11 agent types
│   │   ├── registry.ts       # Type registry
│   │   └── spawner.ts        # Instance management
│   │
│   ├── memory/               # Persistence layer
│   │   ├── sqlite-store.ts   # SQLite operations
│   │   ├── fts-search.ts     # Full-text search
│   │   └── vector-search.ts  # Embedding search
│   │
│   ├── mcp/                  # MCP integration
│   │   ├── server.ts         # MCP server
│   │   └── tools/            # 36 tool implementations
│   │
│   ├── coordination/         # Task management
│   │   ├── task-queue.ts     # Priority queue
│   │   ├── message-bus.ts    # Pub/sub messaging
│   │   └── topology.ts       # Hierarchical coordinator
│   │
│   ├── workflows/            # Workflow engine
│   ├── plugins/              # Plugin system
│   ├── hooks/                # Lifecycle hooks
│   ├── providers/            # LLM providers
│   ├── github/               # GitHub integration
│   ├── cli/                  # CLI commands
│   └── utils/                # Shared utilities
│
├── tests/                    # Test files
├── docs/                     # Documentation
└── templates/                # Init templates
```

## Key Concepts

### 1. Agents

Agents are specialized AI assistants with specific capabilities.

**Example: Coder Agent** (`src/agents/definitions/coder.ts`)
```typescript
export const coderAgent: AgentDefinition = {
  type: 'coder',
  name: 'Coder Agent',
  description: 'Expert software engineer for writing code',
  systemPrompt: `You are an expert software engineer...`,
  capabilities: ['write-code', 'edit-code', 'refactor', 'debug']
};
```

**Using Agents**:
```typescript
import { spawnAgent, getAgent, stopAgent } from './agents';

const agent = spawnAgent('coder', { name: 'my-coder' });
console.log(agent.id);  // UUID
stopAgent(agent.id);
```

### 2. Memory

Persistent key-value storage with search.

**Example Usage**:
```typescript
import { getMemoryManager } from './memory';

const memory = getMemoryManager();

// Store
await memory.store('pattern-singleton', 'Use singleton for config', {
  namespace: 'architecture',
  metadata: { importance: 'high' }
});

// Search
const results = await memory.search('singleton', { limit: 5 });
```

### 3. MCP Tools

Tools exposed to Claude Code via MCP protocol.

**Example Tool** (`src/mcp/tools/agent-tools.ts`):
```typescript
export function createAgentTools(config: AgentStackConfig) {
  return {
    agent_spawn: {
      name: 'agent_spawn',
      description: 'Spawn a new agent',
      inputSchema: {
        type: 'object',
        properties: {
          agentType: { type: 'string' },
          name: { type: 'string' }
        },
        required: ['agentType']
      },
      handler: async (params) => {
        const agent = spawnAgent(params.agentType, { name: params.name });
        return { success: true, agent };
      }
    }
  };
}
```

### 4. Coordination

Task queue and message bus for agent coordination.

**Task Queue**:
```typescript
import { TaskQueue } from './coordination';

const queue = new TaskQueue();
queue.enqueue(task, 8);  // Priority 1-10
queue.on('task:added', () => console.log('New task'));
const task = queue.dequeue('coder');
```

**Message Bus**:
```typescript
import { getMessageBus } from './coordination';

const bus = getMessageBus();
bus.send(fromId, toId, 'task:assign', { task });
bus.subscribe(agentId, (msg) => console.log(msg));
```

## Common Development Tasks

### Adding a New Agent Type

1. Create definition in `src/agents/definitions/`:
```typescript
// src/agents/definitions/my-agent.ts
export const myAgent: AgentDefinition = {
  type: 'my-agent',
  name: 'My Agent',
  description: 'Does something useful',
  systemPrompt: 'You are a specialized agent...',
  capabilities: ['my-capability']
};
```

2. Export from `src/agents/definitions/index.ts`

3. Add to test coverage

### Adding a New MCP Tool

1. Add to appropriate file in `src/mcp/tools/`:
```typescript
my_tool: {
  name: 'my_tool',
  description: 'Does something',
  inputSchema: { /* JSON Schema */ },
  handler: async (params) => {
    // Implementation
    return { success: true };
  }
}
```

2. Tool is automatically registered by `MCPServer`

### Adding a New Provider

1. Create provider in `src/providers/`:
```typescript
export class MyProvider implements LLMProvider {
  name = 'my-provider';

  async chat(messages, options) {
    // Implementation
  }

  async embed(text) {
    // Optional
  }
}
```

2. Register in `createProvider` factory

### Writing Tests

Tests use Vitest framework.

```typescript
// tests/unit/my-feature.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('My Feature', () => {
  beforeEach(() => {
    // Setup
  });

  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

Run tests:
```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage
```

## Debugging

### Enable Debug Logging

```bash
npx aistack -v mcp start
```

### Test MCP Tools Directly

```typescript
// Quick test script
import { startMCPServer } from './mcp';
import { loadConfig } from './utils';

const config = loadConfig();
const server = await startMCPServer(config);
```

### Inspect Database

```bash
sqlite3 ./data/aistack.db

# List tables
.tables

# Query memory
SELECT * FROM memory LIMIT 5;

# Check FTS index
SELECT * FROM memory_fts LIMIT 5;
```

## Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier with default config
- **Linting**: ESLint with TypeScript rules
- **Commits**: Conventional commits preferred

```bash
npm run lint        # Check linting
npm run lint:fix    # Auto-fix
npm run format      # Format code
npm run typecheck   # Type checking
```

## Architecture Decisions

Key architectural decisions are documented in [ADRs](ADRs/):

- ADR-001: SQLite for persistence
- ADR-002: Singleton pattern for global state
- ADR-003: EventEmitter for coordination
- ADR-004: MCP over stdio transport

## Getting Help

1. Read the documentation in `/docs`
2. Check existing tests for examples
3. Review code comments and JSDoc
4. Ask questions via GitHub issues

## First Contribution Ideas

- [ ] Add more agent types
- [ ] Improve error messages
- [ ] Add test coverage
- [ ] Enhance documentation
- [ ] Add CLI commands

## Checklist

Before submitting changes:

- [ ] Code compiles: `npm run build`
- [ ] Tests pass: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] Types check: `npm run typecheck`
- [ ] Documentation updated if needed

## Next Steps

1. **Read**: [ARCHITECTURE.md](ARCHITECTURE.md) for system design
2. **Explore**: Browse `src/` to understand modules
3. **Run**: Try the CLI commands
4. **Test**: Write and run tests
5. **Contribute**: Pick an issue and start coding!

Welcome to the team!
