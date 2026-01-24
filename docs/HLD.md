# High-Level Design (HLD)

> System overview, container views, and primary flows

## 1. System Overview

AgentStack is a multi-agent orchestration framework that enables Claude Code to manage specialized AI agents, persistent memory, and complex workflows through the Model Context Protocol (MCP).

### 1.1 System Goals

1. **Agent Management**: Spawn and coordinate specialized agents (coder, tester, reviewer, etc.)
2. **Persistent Memory**: Store and retrieve context with full-text and semantic search
3. **Task Coordination**: Queue, prioritize, and distribute tasks to agents
4. **Workflow Automation**: Execute multi-phase workflows with validation
5. **Extensibility**: Support plugins for custom agents, tools, and hooks

### 1.2 Key Stakeholders

| Stakeholder | Interest |
|-------------|----------|
| Claude Code Users | Access to specialized agents via MCP tools |
| Developers | Programmatic API for agent orchestration |
| Plugin Authors | Extension points for customization |

## 2. System Context

```mermaid
flowchart TB
    subgraph External
        CC[Claude Code]
        ANT[Anthropic API]
        OAI[OpenAI API]
        OLL[Ollama]
        GH[GitHub]
    end

    subgraph AgentStack
        MCP[MCP Server]
        CORE[Core Services]
        DB[(SQLite)]
    end

    CC <-->|stdio| MCP
    MCP --> CORE
    CORE --> DB
    CORE --> ANT
    CORE --> OAI
    CORE --> OLL
    CORE --> GH
```

### 2.1 External Dependencies

| System | Protocol | Purpose |
|--------|----------|---------|
| Claude Code | MCP over stdio | Primary client interface |
| Anthropic API | HTTPS | Claude chat completions |
| OpenAI API | HTTPS | Chat and embeddings |
| Ollama | HTTP (localhost) | Local LLM inference |
| GitHub | gh CLI | Issue/PR operations |

## 3. Container Architecture

### 3.1 MCP Server Container

**Responsibility**: Expose all capabilities as MCP tools for Claude Code.

**Components**:
- Request handler for `ListTools` and `CallTool`
- 30 registered tools across 6 categories
- JSON-RPC style response formatting

**Interfaces**:
- Input: MCP protocol messages via stdin
- Output: Tool results via stdout

### 3.2 Agent Manager Container

**Responsibility**: Define, register, and manage agent instances.

**Components**:
- **Registry**: Maps agent types to definitions
- **Spawner**: Creates and tracks active agents
- **Definitions**: 7 built-in agent types

**Agent Types**:

| Type | Capabilities |
|------|--------------|
| coder | write-code, edit-code, refactor, debug |
| tester | write-tests, run-tests, coverage-analysis |
| reviewer | code-review, security-review, best-practices |
| researcher | search-code, analyze-patterns, gather-requirements |
| architect | system-design, technical-decisions, documentation |
| coordinator | task-decomposition, agent-coordination |
| analyst | data-analysis, performance-profiling, metrics |

### 3.3 Memory Manager Container

**Responsibility**: Persist and search key-value data with metadata.

**Components**:
- **SQLiteStore**: Core persistence layer
- **FTSSearch**: BM25-based full-text search
- **VectorSearch**: Optional embedding-based semantic search

**Storage Schema**:
```
memory (key, namespace, content, embedding, metadata)
sessions (id, status, timestamps, metadata)
tasks (id, session_id, agent_type, status, input, output)
```

### 3.4 Coordination Container

**Responsibility**: Manage task execution and inter-agent communication.

**Components**:
- **TaskQueue**: Priority-based task queue with events
- **MessageBus**: Pub/sub for agent-to-agent messages
- **HierarchicalCoordinator**: One coordinator managing workers

### 3.5 Workflow Runner Container

**Responsibility**: Execute multi-phase workflows with validation.

**Phases**:
1. **Inventory**: Discover documents/resources
2. **Analysis**: Analyze current state
3. **Sync**: Apply updates
4. **Consistency**: Verify cross-document consistency
5. **Adversarial**: Red-team validation
6. **Reconciliation**: Fix failures and retry

## 4. Primary Data Flows

### 4.1 Agent Spawn Flow

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant MCP as MCP Server
    participant REG as Agent Registry
    participant SP as Agent Spawner

    CC->>MCP: agent_spawn("coder", {name: "my-coder"})
    MCP->>REG: getAgentDefinition("coder")
    REG-->>MCP: AgentDefinition
    MCP->>SP: spawnAgent("coder", options)
    SP->>SP: Generate UUID
    SP->>SP: Create SpawnedAgent
    SP-->>MCP: SpawnedAgent
    MCP-->>CC: {success: true, agent, prompt}
```

### 4.2 Memory Search Flow

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant MCP as MCP Server
    participant MM as Memory Manager
    participant VS as Vector Search
    participant FTS as FTS Search

    CC->>MCP: memory_search({query: "pattern"})
    MCP->>MM: search(query, options)

    alt Vector Search Enabled
        MM->>VS: search(query)
        VS->>VS: Generate embedding
        VS->>VS: Cosine similarity
        VS-->>MM: Vector results
    end

    MM->>FTS: search(query)
    FTS->>FTS: BM25 ranking
    FTS-->>MM: FTS results

    MM->>MM: Merge results
    MM-->>MCP: SearchResults
    MCP-->>CC: {count, results}
```

### 4.3 Task Coordination Flow

```mermaid
sequenceDiagram
    participant COORD as Coordinator
    participant TQ as Task Queue
    participant MB as Message Bus
    participant WORKER as Worker Agent

    COORD->>TQ: enqueue(task, priority)
    TQ-->>COORD: task:added event

    COORD->>COORD: getAvailableWorker()

    alt No idle worker
        COORD->>COORD: spawnAgent(task.type)
    end

    COORD->>TQ: dequeue(worker.type)
    COORD->>TQ: assign(taskId, workerId)
    COORD->>MB: send(coordinator, worker, "task:assign", task)
    MB-->>WORKER: Message

    Note over WORKER: Execute task

    WORKER->>MB: send(worker, coordinator, "task:completed")
    MB-->>COORD: Message
    COORD->>TQ: complete(taskId)
```

### 4.4 Workflow Execution Flow

```mermaid
sequenceDiagram
    participant CLI as CLI/API
    participant WR as Workflow Runner
    participant PE as Phase Executor

    CLI->>WR: run(config)
    WR->>WR: Initialize context
    WR-->>CLI: workflow:start event

    loop For each phase
        WR->>PE: executePhase(phase, context)
        PE->>PE: Phase-specific logic
        PE-->>WR: PhaseResult
        WR-->>CLI: phase:complete event
    end

    alt Adversarial Failed
        loop Reconciliation (max 3)
            WR->>PE: executePhase("sync", context)
            WR->>PE: executePhase("adversarial", context)
        end
    end

    WR->>WR: generateReport()
    WR-->>CLI: WorkflowReport
```

## 5. Integration Points

### 5.1 MCP Tool Categories

| Category | Tool Count | Purpose |
|----------|------------|---------|
| Agent | 6 | Spawn, list, stop, status |
| Memory | 5 | Store, search, get, list, delete |
| Task | 5 | Create, assign, complete, list, get |
| Session | 4 | Start, end, status, active |
| System | 3 | Status, health, config |
| GitHub | 7 | Issues and PRs |

**Total: 30 tools**

### 5.2 Provider Interface

All LLM providers implement:

```typescript
interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  embed?(text: string): Promise<number[]>;
}
```

### 5.3 Plugin Interface

Plugins can extend:

```typescript
interface AgentStackPlugin {
  name: string;
  version: string;
  agents?: AgentDefinition[];    // Custom agent types
  tools?: MCPToolDefinition[];    // Additional MCP tools
  hooks?: HookDefinition[];       // Lifecycle hooks
  providers?: ProviderDefinition[]; // Custom LLM providers
  init?(config): Promise<void>;
  cleanup?(): Promise<void>;
}
```

## 6. Cross-Cutting Concerns

### 6.1 Configuration

- JSON config file with environment variable interpolation
- Zod schema validation with defaults
- Singleton pattern for cached access

### 6.2 Logging

- Hierarchical logger with child contexts
- Levels: debug, info, warn, error
- JSON metadata support

### 6.3 Error Handling

- Consistent try-catch patterns
- Graceful degradation for optional features
- Descriptive error messages in MCP responses

### 6.4 State Management

| State | Scope | Persistence |
|-------|-------|-------------|
| Config | Global singleton | File-based |
| Memory | Global singleton | SQLite |
| Agents | Module-level maps | In-memory |
| Tasks | Per-coordinator | In-memory |
| Sessions | Memory Manager | SQLite |

## 7. Non-Functional Requirements

### 7.1 Performance

- Synchronous SQLite operations for reliability
- In-memory agent and task tracking
- Batch embedding support

### 7.2 Scalability

- Configurable max concurrent agents (1-20)
- Priority-based task queue
- Worker pooling in hierarchical coordinator

### 7.3 Reliability

- SQLite transactions for data integrity
- Task requeue on failure
- Graceful shutdown with cleanup

## 8. Related Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) - Architecture diagrams
- [LLD.md](LLD.md) - Detailed component design
- [API.md](API.md) - API reference
- [DATA.md](DATA.md) - Data model details
