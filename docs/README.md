# AgentStack Documentation

> Clean multi-agent orchestration framework for Claude Code

## Overview

AgentStack is a lightweight, production-ready multi-agent orchestration framework designed for Claude Code integration. It provides a complete system for managing specialized AI agents, persistent memory with semantic search, and seamless MCP (Model Context Protocol) integration.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System architecture with C4 diagrams |
| [High-Level Design](HLD.md) | System overview and container views |
| [Low-Level Design](LLD.md) | Module breakdowns and component details |
| [API Reference](API.md) | Complete API documentation |
| [Data Models](DATA.md) | Data schemas and storage details |
| [Security](SECURITY.md) | Security considerations and practices |
| [Operations](OPERATIONS.md) | Deployment, monitoring, and runbooks |
| [Onboarding](ONBOARDING.md) | Getting started guide for new developers |
| [ADRs](ADRs/) | Architecture Decision Records |

## Quick Start

### Installation

```bash
npm install @blackms/aistack
```

### Initialize Project

```bash
npx aistack init
```

This creates:
- `aistack.config.json` - Configuration file
- `data/` - SQLite database directory
- `plugins/` - Plugin directory

### Add to Claude Code

```bash
claude mcp add aistack -- npx @blackms/aistack mcp start
```

### Configuration Example

```json
{
  "version": "1.0.0",
  "memory": {
    "path": "./data/aistack.db",
    "defaultNamespace": "default",
    "vectorSearch": {
      "enabled": true,
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
    "enabled": true,
    "useGhCli": true
  }
}
```

## Key Features

- **7 Specialized Agents**: Coder, Tester, Reviewer, Researcher, Architect, Coordinator, Analyst
- **Persistent Memory**: SQLite with FTS5 full-text search and optional vector embeddings
- **30 MCP Tools**: Complete Claude Code integration
- **Plugin System**: Extend agents, tools, hooks, and providers
- **Task Coordination**: Priority queue with hierarchical orchestration
- **Workflow Engine**: Multi-phase workflows with adversarial validation

## System Requirements

- Node.js 20.0.0 or higher
- SQLite 3 (bundled via better-sqlite3)
- Optional: GitHub CLI (`gh`) for GitHub operations

## License

MIT License - see repository for details.

## Repository

https://github.com/blackms/aistack.git
