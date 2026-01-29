# aistack Documentation

> Production-grade multi-agent orchestration framework for Claude Code

## Overview

aistack is a lightweight, production-ready multi-agent orchestration framework designed for Claude Code integration. It provides a complete system for managing specialized AI agents, persistent memory with semantic search, drift detection, consensus checkpoints, resource monitoring, and seamless MCP (Model Context Protocol) integration.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System architecture with C4 diagrams |
| [High-Level Design](HLD.md) | System overview and container views |
| [Low-Level Design](LLD.md) | Module breakdowns and component details |
| [API Reference](API.md) | Complete API documentation (46 MCP tools) |
| [Data Models](DATA.md) | Database schemas and storage details |
| [Security](SECURITY.md) | Security model and best practices |
| [Operations](OPERATIONS.md) | Deployment, monitoring, and troubleshooting |
| [Onboarding](ONBOARDING.md) | Getting started guide for developers |
| [ADRs](ADRs/) | Architecture Decision Records (6 ADRs) |

## Quick Start

### Installation

```bash
npm install @blackms/aistack
```

### Initialize Project

```bash
npx @blackms/aistack init
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
  "version": "1.5.3",
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
  "driftDetection": {
    "enabled": false,
    "threshold": 0.95,
    "behavior": "warn",
    "asyncEmbedding": true
  },
  "resourceExhaustion": {
    "enabled": false,
    "warningThresholdPercent": 0.7,
    "autoTerminate": false
  },
  "consensus": {
    "enabled": false,
    "requireForRiskLevels": ["high", "medium"],
    "reviewerStrategy": "adversarial"
  },
  "github": {
    "enabled": true,
    "useGhCli": true
  }
}
```

## Key Features

### Core Capabilities

- **11 Specialized Agents**: Coder, Researcher, Tester, Reviewer, Adversarial, Architect, Coordinator, Analyst, DevOps, Documentation, Security Auditor
- **Persistent Memory**: SQLite with FTS5 full-text search and optional vector embeddings
- **46 MCP Tools**: Complete Claude Code integration across 8 categories
- **6 LLM Providers**: Anthropic, OpenAI, Ollama, Claude Code CLI, Gemini CLI, Codex

### Advanced Features

- **Agent Identity v1**: Persistent agent identities with lifecycle management (created → active → dormant → retired)
- **Semantic Drift Detection**: Embedding-based similarity checking to prevent task duplication
- **Resource Exhaustion Monitoring**: Per-agent tracking with configurable thresholds and auto-pause
- **Consensus Checkpoints**: Risk-based gating for high-stakes task creation
- **Adversarial Review Loop**: Automatic code improvement through iterative feedback

### Infrastructure

- **Plugin System**: Extend agents, tools, hooks, and providers
- **Task Coordination**: Priority queue with hierarchical orchestration
- **Workflow Engine**: Multi-phase workflows with adversarial validation
- **Web Dashboard**: Real-time monitoring with React 18 + Material-UI

## MCP Tool Categories

| Category | Count | Description |
|----------|-------|-------------|
| Agent | 6 | Spawn, list, stop, status, types, update |
| Identity | 8 | Create, get, list, update, activate, deactivate, retire, audit |
| Memory | 5 | Store, search, get, list, delete |
| Task | 8 | Create, assign, complete, list, get, drift check, relationships, metrics |
| Consensus | 5 | Check, list pending, get, approve, reject |
| Session | 4 | Start, end, status, active |
| System | 3 | Status, health, config |
| GitHub | 7 | Issues (create/list/get), PRs (create/list/get), repo info |

**Total: 46 MCP Tools**

## System Requirements

- Node.js 20.0.0 or higher
- SQLite 3 (bundled via better-sqlite3)
- Optional: GitHub CLI (`gh`) for GitHub operations
- Optional: Ollama for local embeddings

## Version

Current version: **1.5.3**

## License

MIT License - see repository for details.

## Repository

https://github.com/blackms/aistack
