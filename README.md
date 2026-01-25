<div align="center">

# aistack

### Multi-Agent Orchestration for Claude Code

[![GitHub stars](https://img.shields.io/github/stars/blackms/aistack?style=flat-square)](https://github.com/blackms/aistack/stargazers)
[![CI](https://github.com/blackms/aistack/actions/workflows/ci.yml/badge.svg)](https://github.com/blackms/aistack/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/blackms/aistack/branch/main/graph/badge.svg)](https://codecov.io/gh/blackms/aistack)
[![npm version](https://img.shields.io/npm/v/@blackms/aistack?style=flat-square&color=CB3837&logo=npm)](https://www.npmjs.com/package/@blackms/aistack)
[![npm downloads](https://img.shields.io/npm/dm/@blackms/aistack?style=flat-square&color=CB3837)](https://www.npmjs.com/package/@blackms/aistack)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

<br/>

**Production-ready agent orchestration with persistent memory, MCP integration, and real-time web dashboard.**

<br/>

[Get Started](#-quick-start) · [Architecture](#-architecture) · [Web Dashboard](#-web-dashboard) · [API Reference](#-mcp-tools) · [Documentation](./docs)

<br/>

</div>

---

## Why aistack?

Coordinate specialized AI agents through Claude Code with persistent context, hierarchical task management, and seamless extensibility.

```
7 agents · 30 MCP tools · 6 LLM providers · SQLite + FTS5 · Web dashboard · Plugin system
```

---

## Tech Stack

<table>
<tr>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/nodedotjs/339933" width="48" height="48" alt="Node.js" />
<br/>Node.js 20+
</td>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/typescript/3178C6" width="48" height="48" alt="TypeScript" />
<br/>TypeScript
</td>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/sqlite/003B57" width="48" height="48" alt="SQLite" />
<br/>SQLite + FTS5
</td>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/react/61DAFB" width="48" height="48" alt="React" />
<br/>React 18
</td>
</tr>
<tr>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/anthropic/191919" width="48" height="48" alt="Anthropic" />
<br/>Anthropic
</td>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/openai/412991" width="48" height="48" alt="OpenAI" />
<br/>OpenAI
</td>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/ollama/000000" width="48" height="48" alt="Ollama" />
<br/>Ollama
</td>
<td align="center" width="96">
<img src="https://cdn.simpleicons.org/vite/646CFF" width="48" height="48" alt="Vite" />
<br/>Vite
</td>
</tr>
</table>

---

## Features

| Feature | Description |
|---------|-------------|
| **Specialized Agents** | 7 built-in agent types: coder, researcher, tester, reviewer, architect, coordinator, analyst |
| **Persistent Memory** | SQLite with FTS5 full-text search and optional vector embeddings |
| **MCP Integration** | 30 tools exposed via Model Context Protocol for Claude Code |
| **Web Dashboard** | Real-time dashboard with 9 pages for visual management and monitoring |
| **REST API + WebSocket** | 50+ HTTP endpoints with live WebSocket event streaming |
| **Hierarchical Coordination** | Task queue, message bus, and coordinator pattern |
| **Multi-Provider Support** | 3 API providers (Anthropic, OpenAI, Ollama) + 3 CLI providers (Claude, Gemini, Codex) |
| **Plugin System** | Runtime extensibility for agents, tools, hooks, and providers |
| **Workflow Engine** | Multi-phase workflows with adversarial validation |

---

## Quick Start

### Installation

```bash
npm install @blackms/aistack
```

### Initialize & Connect

```bash
# Initialize project
npx @blackms/aistack init

# Add to Claude Code
claude mcp add aistack -- npx @blackms/aistack mcp start

# Verify installation
npx @blackms/aistack status
```

### Start Web Dashboard

```bash
# Start backend + web dashboard
npx @blackms/aistack web start

# Open http://localhost:3001
```

### Configuration

Create `aistack.config.json`:

```json
{
  "version": "1.0.0",
  "providers": {
    "default": "anthropic",
    "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" }
  },
  "memory": {
    "path": "./data/aistack.db",
    "vectorSearch": { "enabled": false }
  }
}
```

---

## Architecture

```mermaid
graph TB
    subgraph Clients["Client Layer"]
        CC[Claude Code IDE]
        CLI[CLI]
        WEB[Web Dashboard]
    end

    subgraph "aistack"
        MCP["MCP Server<br/><small>stdio transport</small>"]
        HTTP["HTTP Server<br/><small>REST API</small>"]
        WS["WebSocket<br/><small>Real-time events</small>"]

        subgraph Core["Core Services"]
            AM[Agent Manager]
            MM[Memory Manager]
            TQ[Task Queue]
            MB[Message Bus]
        end

        subgraph Agents["Agent Pool"]
            direction LR
            A1[Coder]
            A2[Tester]
            A3[Reviewer]
            A4[Architect]
            A5[Researcher]
            A6[Coordinator]
            A7[Analyst]
        end

        subgraph Storage["Persistence"]
            SQL[(SQLite)]
            FTS[FTS5 Index]
            VEC[Vector Store]
        end

        subgraph Providers["LLM Providers"]
            ANT[Anthropic]
            OAI[OpenAI]
            OLL[Ollama]
        end
    end

    CC <-->|"MCP/stdio"| MCP
    CLI <-->|"HTTP"| HTTP
    WEB <-->|"HTTP + WS"| HTTP & WS

    MCP & HTTP --> AM & MM
    WS --> MB
    AM --> TQ --> MB
    MB --> A1 & A2 & A3 & A4 & A5 & A6 & A7
    MM --> SQL --> FTS & VEC
    AM -.-> ANT & OAI & OLL
```

### Deployment Overview

```mermaid
C4Deployment
    title Deployment Diagram - Local Machine

    Deployment_Node(local, "Local Machine", "Developer Workstation") {
        Deployment_Node(npm, "npm", "Node.js 20+") {
            Container(aistack, "aistack", "TypeScript", "MCP Server + HTTP Server + WebSocket")
            ContainerDb(sqlite, "SQLite", "better-sqlite3", "Memory + FTS5 + Vector")
        }
        Deployment_Node(browser, "Browser", "Chrome/Firefox/Safari") {
            Container(dashboard, "Web Dashboard", "React 18 + Vite", "Management UI")
        }
        Deployment_Node(ide, "IDE", "VS Code") {
            Container(claude, "Claude Code", "Extension", "AI Assistant")
        }
    }

    Deployment_Node(cloud, "Cloud Services", "External") {
        Container(anthropic, "Anthropic API", "HTTPS", "Claude models")
        Container(openai, "OpenAI API", "HTTPS", "GPT models")
        Container(ollama_remote, "Ollama", "Local/Remote", "Local LLMs")
    }

    Rel(claude, aistack, "MCP/stdio")
    Rel(dashboard, aistack, "HTTP + WebSocket")
    Rel(aistack, sqlite, "SQL")
    Rel(aistack, anthropic, "HTTPS")
    Rel(aistack, openai, "HTTPS")
    Rel(aistack, ollama_remote, "HTTP")
```

### Request Flow

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant MCP as MCP Server
    participant AM as Agent Manager
    participant MM as Memory
    participant DB as SQLite

    CC->>MCP: agent_spawn("coder")
    MCP->>AM: spawnAgent("coder")
    AM-->>MCP: SpawnedAgent
    MCP-->>CC: { id, type, status }

    CC->>MCP: memory_store(key, content)
    MCP->>MM: store(key, content)
    MM->>DB: INSERT/UPDATE
    DB-->>MM: MemoryEntry
    MM-->>MCP: { success: true }
    MCP-->>CC: { entry }

    CC->>MCP: memory_search(query)
    MCP->>MM: search(query)
    MM->>DB: FTS5 MATCH
    DB-->>MM: Results
    MM-->>MCP: SearchResults
    MCP-->>CC: { results }
```

---

## Web Dashboard

The built-in web dashboard provides visual management and real-time monitoring of your agent orchestration.

### Starting the Dashboard

```bash
# Start the web server (includes dashboard)
npx @blackms/aistack web start

# Open in browser
open http://localhost:3001
```

### Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | System overview with agent status, memory stats, and recent activity |
| **Agents** | Spawn, monitor, and manage agents in real-time |
| **Memory** | Browse, search, and manage memory entries with FTS5 |
| **Tasks** | View task queue, status, and completion history |
| **Projects** | Project management with task workflows |
| **Project Detail** | Deep dive into project tasks and specifications |
| **Task Detail** | Task lifecycle with phase transitions |
| **Workflows** | Define and run multi-phase workflows |
| **Chat** | Interactive agent chat interface |

### Web Dashboard Flow

```mermaid
sequenceDiagram
    participant User as Browser
    participant WS as WebSocket
    participant HTTP as HTTP Server
    participant Core as Core Services
    participant DB as SQLite

    User->>HTTP: GET /api/system/status
    HTTP->>Core: getSystemStatus()
    Core-->>HTTP: SystemStatus
    HTTP-->>User: { agents, memory, tasks }

    User->>WS: Connect ws://localhost:3001
    WS-->>User: Connected

    User->>HTTP: POST /api/agents
    HTTP->>Core: spawnAgent("coder")
    Core->>WS: emit("agent:spawned")
    WS-->>User: { event: "agent:spawned", data }
    HTTP-->>User: { agent }

    Note over User,WS: Real-time updates via WebSocket

    Core->>WS: emit("task:completed")
    WS-->>User: { event: "task:completed", data }
```

---

## Agents

<table>
<tr>
<th>Agent</th>
<th>Purpose</th>
<th>Capabilities</th>
</tr>
<tr>
<td><b>coder</b></td>
<td>Write and modify code</td>
<td><code>write-code</code> <code>edit-code</code> <code>refactor</code> <code>debug</code> <code>implement-features</code></td>
</tr>
<tr>
<td><b>researcher</b></td>
<td>Gather information</td>
<td><code>search-code</code> <code>read-documentation</code> <code>analyze-patterns</code> <code>gather-requirements</code> <code>explore-codebase</code></td>
</tr>
<tr>
<td><b>tester</b></td>
<td>Test and validate</td>
<td><code>write-tests</code> <code>run-tests</code> <code>identify-edge-cases</code> <code>coverage-analysis</code> <code>test-debugging</code></td>
</tr>
<tr>
<td><b>reviewer</b></td>
<td>Quality assurance</td>
<td><code>code-review</code> <code>security-review</code> <code>performance-review</code> <code>best-practices</code> <code>feedback</code></td>
</tr>
<tr>
<td><b>architect</b></td>
<td>System design</td>
<td><code>system-design</code> <code>technical-decisions</code> <code>architecture-review</code> <code>documentation</code> <code>trade-off-analysis</code></td>
</tr>
<tr>
<td><b>coordinator</b></td>
<td>Orchestrate work</td>
<td><code>task-decomposition</code> <code>agent-coordination</code> <code>progress-tracking</code> <code>result-synthesis</code> <code>workflow-management</code></td>
</tr>
<tr>
<td><b>analyst</b></td>
<td>Data insights</td>
<td><code>data-analysis</code> <code>performance-profiling</code> <code>metrics-collection</code> <code>trend-analysis</code> <code>reporting</code></td>
</tr>
</table>

---

## MCP Tools

### Agent Tools (6)
```
agent_spawn          agent_list           agent_stop
agent_status         agent_types          agent_update_status
```

### Memory Tools (5)
```
memory_store         memory_search        memory_get
memory_list          memory_delete
```

### Task Tools (5)
```
task_create          task_assign          task_complete
task_list            task_get
```

### Session Tools (4)
```
session_start        session_end          session_status
session_active
```

### System Tools (3)
```
system_status        system_health        system_config
```

### GitHub Tools (7)
```
github_issue_create  github_issue_list    github_issue_get
github_pr_create     github_pr_list       github_pr_get
github_repo_info
```

---

## Programmatic API

```typescript
import {
  spawnAgent,
  getMemoryManager,
  startMCPServer,
  getConfig,
} from '@blackms/aistack';

// Spawn an agent
const agent = spawnAgent('coder', { name: 'my-coder' });

// Use memory with search
const memory = getMemoryManager(getConfig());
await memory.store('pattern', 'Use dependency injection', {
  namespace: 'architecture'
});
const results = await memory.search('injection');

// Start MCP server
const server = await startMCPServer(getConfig());
```

### Submodule Imports

```typescript
import { MemoryManager } from '@blackms/aistack/memory';
import { spawnAgent, listAgentTypes } from '@blackms/aistack/agents';
import { startMCPServer } from '@blackms/aistack/mcp';
```

---

## Plugin System

Extend aistack with custom agents, tools, and hooks:

```typescript
import type { AgentStackPlugin } from '@blackms/aistack';

export default {
  name: 'my-plugin',
  version: '1.0.0',

  agents: [{
    type: 'custom-agent',
    name: 'Custom Agent',
    description: 'Specialized behavior',
    systemPrompt: 'You are a custom agent...',
    capabilities: ['custom-task'],
  }],

  tools: [{
    name: 'custom_tool',
    description: 'A custom MCP tool',
    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    handler: async (params) => ({ result: 'done' })
  }],

  async init(config) { /* setup */ },
  async cleanup() { /* teardown */ }
} satisfies AgentStackPlugin;
```

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `init` | Initialize project structure |
| `agent spawn -t <type>` | Spawn agent |
| `agent list` | List active agents |
| `agent stop -n <name>` | Stop agent |
| `agent types` | Show available types |
| `agent status -n <name>` | Get agent status |
| `agent run -t <type> -p <prompt>` | Spawn and execute task |
| `agent exec -n <name> -p <prompt>` | Execute task with existing agent |
| `memory store -k <key> -c <content>` | Store entry |
| `memory search -q <query>` | Search memory |
| `memory list` | List entries |
| `memory delete -k <key>` | Delete entry |
| `mcp start` | Start MCP server |
| `mcp tools` | List MCP tools |
| `web start` | Start web dashboard server |
| `workflow run <name>` | Run workflow |
| `workflow list` | List workflows |
| `status` | System status |

---

## LLM Providers

### API Providers
| Provider | Default Model | Embeddings |
|----------|---------------|------------|
| **Anthropic** | claude-sonnet-4-20250514 | - |
| **OpenAI** | gpt-4o | text-embedding-3-small |
| **Ollama** | llama3.2 | nomic-embed-text |

### CLI Providers
| Provider | CLI Tool | Default Model |
|----------|----------|---------------|
| **Claude Code** | `claude` | sonnet |
| **Gemini CLI** | `gemini` | gemini-2.0-flash |
| **Codex** | `codex` | - |

CLI providers enable agent execution through external CLI tools, useful for interactive workflows.

---

## Project Structure

```
src/
├── agents/         # Agent registry, spawner, definitions (7 types)
├── cli/            # CLI commands
├── coordination/   # Task queue, message bus, topology
├── github/         # GitHub integration
├── hooks/          # Lifecycle hooks
├── mcp/            # MCP server and 30 tools
├── memory/         # SQLite, FTS5, vector search
├── plugins/        # Plugin loader and registry
├── providers/      # LLM provider implementations (6 providers)
├── web/            # REST API routes + WebSocket
├── workflows/      # Workflow engine
└── utils/          # Config, logger, validation

web/
├── src/
│   ├── pages/      # 9 dashboard pages
│   ├── components/ # React components
│   ├── hooks/      # Custom React hooks
│   └── stores/     # Zustand state management
└── public/         # Static assets
```

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Build
npm test             # Run tests
npm run test:coverage # With coverage
npm run typecheck    # Type check
npm run lint         # Lint

# Web dashboard development
npm run dev:web      # Start Vite dev server for web UI
npm run build:web    # Build web UI for production
```

---

## Roadmap

| Priority | Feature |
|----------|---------|
| **P1** | HTTP transport for MCP server |
| **P1** | Streaming responses |
| **P2** | Agent state persistence |
| **P2** | Built-in workflow templates |
| **P3** | Enhanced dashboard analytics |
| **P3** | Metrics and observability |

<sub>Roadmap items are planned features, not current capabilities.</sub>

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

All PRs must pass CI (tests, lint, typecheck, build).

---

## License

[MIT](LICENSE) © 2024

---

<div align="center">

**[Documentation](./docs)** · **[Issues](https://github.com/blackms/aistack/issues)** · **[Discussions](https://github.com/blackms/aistack/discussions)**

<sub>Built with TypeScript · Made for Claude Code</sub>

---

<sub>README verified against codebase v1.2.0. All features documented are backed by implemented code.</sub>

</div>
