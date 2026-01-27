# Architecture Overview

> System architecture documentation with C4 diagrams

## System Purpose

AgentStack solves the core problem of coordinating multiple AI agents with specialized roles to complete complex tasks. It provides:

- **Agent Coordination**: Managing agents with different specializations and routing tasks efficiently
- **Persistent Memory**: Maintaining state and context using SQLite with full-text and vector search
- **MCP Integration**: Seamless Model Context Protocol server via stdio transport
- **LLM Abstraction**: Supporting 6 providers (Anthropic, OpenAI, Ollama, Claude Code CLI, Gemini CLI, Codex) with a unified interface
- **Runtime Extensibility**: Plugin system for extending functionality without modifying core

## C4 Context Diagram

```mermaid
C4Context
    title System Context Diagram - AgentStack

    Person(developer, "Developer", "Uses Claude Code IDE")

    System(agentstack, "AgentStack", "Multi-agent orchestration framework")

    System_Ext(claude_code, "Claude Code", "AI-powered IDE")
    System_Ext(anthropic, "Anthropic API", "Claude LLM provider")
    System_Ext(openai, "OpenAI API", "GPT models and embeddings")
    System_Ext(ollama, "Ollama", "Local LLM inference")
    System_Ext(github, "GitHub", "Repository hosting")

    Rel(developer, claude_code, "Uses")
    Rel(claude_code, agentstack, "MCP Protocol", "stdio")
    Rel(agentstack, anthropic, "Chat API", "HTTPS")
    Rel(agentstack, openai, "Chat/Embeddings API", "HTTPS")
    Rel(agentstack, ollama, "Chat/Embeddings", "HTTP localhost")
    Rel(agentstack, github, "gh CLI", "Process")
```

## C4 Container Diagram

```mermaid
C4Container
    title Container Diagram - AgentStack

    Person(developer, "Developer", "Uses Claude Code")

    System_Boundary(agentstack, "AgentStack") {
        Container(mcp_server, "MCP Server", "TypeScript", "Exposes 36 tools via MCP protocol")
        Container(agent_manager, "Agent Manager", "TypeScript", "Registry and spawner for 11 agent types")
        Container(memory_manager, "Memory Manager", "TypeScript", "Unified storage with FTS and vector search")
        Container(coordination, "Coordination Layer", "TypeScript", "Task queue and message bus")
        Container(workflow_runner, "Workflow Runner", "TypeScript", "Multi-phase workflow orchestration")
        ContainerDb(sqlite_db, "SQLite Database", "better-sqlite3", "Persistent storage with FTS5")
    }

    System_Ext(claude_code, "Claude Code", "MCP Client")
    System_Ext(llm_providers, "LLM Providers", "Anthropic, OpenAI, Ollama")

    Rel(developer, claude_code, "Uses")
    Rel(claude_code, mcp_server, "MCP Protocol", "stdio")
    Rel(mcp_server, agent_manager, "Spawns/manages agents")
    Rel(mcp_server, memory_manager, "Store/search memory")
    Rel(agent_manager, coordination, "Task assignment")
    Rel(coordination, workflow_runner, "Workflow triggers")
    Rel(memory_manager, sqlite_db, "Read/write")
    Rel(agent_manager, llm_providers, "Chat completions")
```

## Component Diagram

```mermaid
flowchart TB
    subgraph "Claude Code Client"
        CC[Claude Code IDE]
    end

    subgraph "MCP Layer"
        MCP[MCP Server]
        AT[Agent Tools]
        MT[Memory Tools]
        TT[Task Tools]
        ST[Session Tools]
        SYS[System Tools]
        GH[GitHub Tools]
    end

    subgraph "Core Layer"
        AR[Agent Registry]
        AS[Agent Spawner]
        MM[Memory Manager]
        TQ[Task Queue]
        MB[Message Bus]
        WR[Workflow Runner]
    end

    subgraph "Storage Layer"
        SQL[(SQLite Store)]
        FTS[FTS5 Search]
        VS[Vector Search]
    end

    subgraph "Provider Layer"
        AP[Anthropic Provider]
        OP[OpenAI Provider]
        OL[Ollama Provider]
    end

    subgraph "Extension Layer"
        PL[Plugin Loader]
        PR[Plugin Registry]
        HK[Hooks System]
    end

    CC <-->|MCP Protocol| MCP
    MCP --> AT & MT & TT & ST & SYS & GH

    AT --> AR & AS
    MT --> MM
    TT --> MM
    ST --> MM

    AS --> AR
    AS --> TQ
    TQ --> MB
    MB --> WR

    MM --> SQL
    SQL --> FTS
    SQL --> VS

    AR --> AP & OP & OL

    PL --> PR
    PR --> HK
    HK --> WR
```

## Data Flow Diagram

```mermaid
flowchart LR
    subgraph "Input"
        REQ[MCP Request]
    end

    subgraph "Processing"
        VAL[Validate Input]
        TOOL[Execute Tool]
        AGENT[Agent Operation]
        MEM[Memory Operation]
    end

    subgraph "Storage"
        DB[(SQLite)]
    end

    subgraph "Output"
        RES[MCP Response]
    end

    REQ --> VAL
    VAL --> TOOL
    TOOL --> AGENT
    TOOL --> MEM
    AGENT --> DB
    MEM --> DB
    DB --> RES
```

## Deployment Diagram

```mermaid
flowchart TB
    subgraph "Developer Machine"
        subgraph "Claude Code Process"
            CC[Claude Code]
        end

        subgraph "AgentStack Process"
            MCP[MCP Server]
            CORE[Core Services]
            DB[(SQLite DB)]
        end

        subgraph "Optional Services"
            OL[Ollama Server]
        end
    end

    subgraph "Cloud Services"
        ANT[Anthropic API]
        OAI[OpenAI API]
        GHB[GitHub API]
    end

    CC <-->|stdio| MCP
    MCP --> CORE
    CORE --> DB
    CORE --> OL
    CORE --> ANT
    CORE --> OAI
    CORE --> GHB
```

## Key Design Principles

### 1. Singleton Pattern
Configuration, Memory Manager, Message Bus, and Workflow Runner use singletons for application-wide state consistency.

### 2. EventEmitter-Based Communication
Task Queue, Message Bus, and Workflow Runner emit events for loose coupling and lifecycle tracking.

### 3. Provider Strategy Pattern
LLM providers (Anthropic, OpenAI, Ollama) implement a common interface, enabling runtime switching.

### 4. Layered Architecture
Clear separation between:
- **MCP Layer**: External interface
- **Core Layer**: Business logic
- **Storage Layer**: Persistence
- **Provider Layer**: External integrations
- **Extension Layer**: Plugins and hooks

### 5. Graceful Degradation
Optional features (vector search, GitHub integration) degrade gracefully when not configured.

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 20+ | JavaScript runtime |
| Language | TypeScript 5.7 | Type safety |
| Database | SQLite 3 (better-sqlite3) | Embedded persistence |
| Search | FTS5 | Full-text search |
| Validation | Zod | Runtime schema validation |
| CLI | Commander.js | Command-line interface |
| Protocol | MCP SDK | Claude Code integration |

## Module Structure

```
src/
├── index.ts           # Public API exports
├── types.ts           # Core type definitions
├── agents/            # Agent definitions and management
│   ├── definitions/   # 11 specialized agent types
│   ├── registry.ts    # Agent type registry
│   └── spawner.ts     # Agent instance management
├── memory/            # Persistent storage
│   ├── sqlite-store.ts
│   ├── fts-search.ts
│   └── vector-search.ts
├── mcp/               # MCP server and tools
│   ├── server.ts
│   └── tools/         # 36 tool implementations
├── coordination/      # Task and message management
│   ├── task-queue.ts
│   ├── message-bus.ts
│   └── topology.ts
├── workflows/         # Multi-phase workflows
├── plugins/           # Plugin system
├── hooks/             # Lifecycle hooks
├── providers/         # LLM provider abstraction
├── github/            # GitHub CLI integration
├── cli/               # Command-line interface
└── utils/             # Shared utilities
```

## Related Documents

- [HLD.md](HLD.md) - Detailed high-level design
- [LLD.md](LLD.md) - Low-level component design
- [DATA.md](DATA.md) - Data model documentation
- [ADRs/](ADRs/) - Architecture decision records
