<div align="center">

# aistack

### Ultra-Modern Multi-Agent Orchestration for Claude Code

[![npm version](https://img.shields.io/npm/v/@blackms/aistack?style=for-the-badge&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@blackms/aistack)
[![CI](https://img.shields.io/github/actions/workflow/status/blackms/aistack/ci.yml?style=for-the-badge&logo=github&logoColor=white)](https://github.com/blackms/aistack/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/blackms/aistack?style=for-the-badge&logo=codecov&logoColor=white)](https://codecov.io/gh/blackms/aistack)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

**Production-grade agent orchestration with adversarial validation, persistent memory, and real-time web dashboard.**

<br/>

[Quick Start](#-quick-start) · [What It Does](#what-it-does) · [Features](#-features) · [Documentation](#-documentation)

<br/>

```
11 agents · 41 MCP tools · 6 LLM providers · SQLite + FTS5 · Web dashboard · Agent Identity · Drift Detection · Resource Exhaustion Monitoring
```

</div>

---

## What It Does

aistack helps you **coordinate multiple specialized AI agents** to work together on complex tasks. Think of it as a team of AI specialists:

**Instead of asking one AI to do everything, you can:**
- Spawn a **Coder** agent to write code
- Spawn an **Adversarial** agent to review and break it
- Spawn a **Tester** agent to write tests
- Spawn a **Documentation** agent to document it
- Store learnings in **persistent memory** for future use

**How it works:**
1. **Spawn specialized agents** - Each agent has specific expertise (coding, testing, reviewing, etc.)
2. **They communicate through a message bus** - Agents can coordinate and share information
3. **Memory persists across sessions** - Agents remember patterns, decisions, and learnings
4. **Adversarial validation** - Code is automatically reviewed and improved through iterative feedback
5. **Integrate with Claude Code** - Use agents directly from your IDE via MCP protocol

**Perfect for:**
- Code generation with automatic review cycles
- Multi-step development workflows (design → code → test → document)
- Building institutional knowledge that persists across projects
- Automating complex tasks that need different types of expertise

### Example Workflow

```
You ask: "Create a login API endpoint with tests"

aistack:
1. Spawns a Coder agent → writes the API code
2. Spawns an Adversarial agent → tries to break it, finds security issues
3. Coder fixes the issues
4. Spawns a Tester agent → writes comprehensive tests
5. Spawns a Documentation agent → generates API docs
6. Stores patterns in memory → "Always use bcrypt for passwords"

Next time: The memory helps agents make better decisions automatically
```

---

## Tech Stack

<table>
<tr>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/nodedotjs/339933" width="64" height="64" alt="Node.js" />
<br/><b>Node.js 20+</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/typescript/3178C6" width="64" height="64" alt="TypeScript" />
<br/><b>TypeScript</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/sqlite/003B57" width="64" height="64" alt="SQLite" />
<br/><b>SQLite + FTS5</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/vitest/6E9F18" width="64" height="64" alt="Vitest" />
<br/><b>Vitest</b>
</td>
</tr>
<tr>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/react/61DAFB" width="64" height="64" alt="React" />
<br/><b>React 18</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/mui/007FFF" width="64" height="64" alt="Material-UI" />
<br/><b>Material-UI</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/vite/646CFF" width="64" height="64" alt="Vite" />
<br/><b>Vite</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/anthropic/191919" width="64" height="64" alt="Anthropic" />
<br/><b>Anthropic</b>
</td>
</tr>
<tr>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/openai/412991" width="64" height="64" alt="OpenAI" />
<br/><b>OpenAI</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/ollama/000000" width="64" height="64" alt="Ollama" />
<br/><b>Ollama</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/github/181717" width="64" height="64" alt="GitHub" />
<br/><b>GitHub Actions</b>
</td>
<td align="center" width="120">
<img src="https://cdn.simpleicons.org/npm/CB3837" width="64" height="64" alt="NPM" />
<br/><b>NPM Package</b>
</td>
</tr>
</table>

---

## ✨ Features

### 🤖 11 Specialized Agent Types

Each agent has specific expertise and capabilities:

- **Coder** - Write, edit, and refactor code
- **Researcher** - Search and analyze codebases, gather information
- **Tester** - Write and run tests, coverage analysis
- **Reviewer** - Code review and best practices
- **Adversarial** - Attack code to find vulnerabilities (used in review loops)
- **Architect** - System design and technical decisions
- **Coordinator** - Orchestrate multiple agents for complex tasks
- **Analyst** - Data analysis and performance profiling
- **DevOps** - Deployment, infrastructure, monitoring
- **Documentation** - Generate and maintain documentation
- **Security Auditor** - Security audits, compliance, threat modeling

### 💾 Persistent Memory System

Knowledge that survives across sessions:

- **SQLite with FTS5** - Fast full-text search across all memory
- **Vector Embeddings** - Optional semantic search (OpenAI/Ollama)
- **Namespaces & Tags** - Organize memory by project, topic, or team
- **Version History** - Track changes and rollback if needed
- **Memory Relationships** - Link related concepts together

### 🔄 Adversarial Review Loop

Automatic code improvement through iterative feedback:

1. Coder agent generates code
2. Adversarial agent reviews and tries to break it
3. Coder fixes issues
4. Repeat up to 3 times until approved

Result: More robust, secure code with fewer bugs.

### 🪪 Agent Identity v1

Persistent agent identities with lifecycle management:

- **Stable UUIDs** - Agents have persistent `agent_id` across executions
- **Lifecycle States** - `created` → `active` → `dormant` → `retired`
- **Capabilities Tracking** - Store and version agent capabilities
- **Full Audit Trail** - Every identity change is logged
- **Agent-Scoped Memory** - Memory namespaces owned by specific agents

### 🎯 Semantic Drift Detection

Detect when task descriptions are semantically similar to ancestors:

- **Embedding-based Similarity** - Uses OpenAI or Ollama embeddings
- **Configurable Thresholds** - `threshold` (block/warn) and `warningThreshold` (warn only)
- **Two Behaviors** - `warn` (log and allow) or `prevent` (block creation)
- **Task Relationships** - Track `parent_of`, `derived_from`, `depends_on`, `supersedes`
- **Metrics & Events** - Full logging for drift detection analysis

### 🛡️ Resource Exhaustion Monitoring

Detect and prevent runaway agents consuming excessive resources:

- **Per-Agent Tracking** - Track files accessed, API calls, subtasks spawned, tokens consumed
- **Phase Progression** - `normal` → `warning` → `intervention` → `termination`
- **Configurable Thresholds** - Set limits for each resource type
- **Pause/Resume Control** - Automatically pause agents exceeding thresholds
- **Deliverable Checkpoints** - Reset time-based tracking when agents produce results
- **Slack Notifications** - Alert on warnings, interventions, and terminations

### 🎯 41 MCP Tools for Claude Code

Control aistack directly from Claude Code IDE:
- 6 agent tools (spawn, list, stop, status, types, update)
- 8 identity tools (create, get, list, update, activate, deactivate, retire, audit)
- 5 memory tools (store, search, get, list, delete) — with agent-scoped memory support
- 8 task tools (create, assign, complete, list, get, check_drift, get_relationships, drift_metrics)
- 4 session tools (start, end, status, active)
- 3 system tools (status, health, config)
- 7 GitHub tools (issues, PRs, repo info)

### 🌐 Web Dashboard

Real-time monitoring and control:
- Visual agent management
- Memory browser with search
- Task queue visualization
- Live WebSocket updates
- React 18 + Material-UI
- Dark mode support

### 🔌 6 LLM Providers

Choose your preferred AI:
- **Anthropic** - Claude Sonnet 4 (recommended)
- **OpenAI** - GPT-4o + embeddings
- **Ollama** - Local models (llama3.2)
- **ClaudeCode CLI** - Direct Claude Code integration
- **Gemini CLI** - Google Gemini 2.0
- **Codex** - GitHub Codex

### 🔐 Security & Auth

Production-ready security:
- JWT authentication
- BCrypt password hashing
- Role-based access control (Admin, Developer, Viewer)
- Security Auditor agent for code review

---

## 📚 Documentation

- **[GitHub Wiki](https://github.com/blackms/aistack/wiki)** - Comprehensive user guide (54 pages)
  - Getting Started tutorials
  - Agent guides for all 11 types
  - MCP tools reference
  - Practical recipes and examples
  - Advanced topics (plugins, custom agents, workflows)
  - Complete API reference

- **[Technical Docs](./docs)** - Architecture and implementation details
  - [API.md](./docs/API.md) - MCP tools and programmatic API
  - [ARCHITECTURE.md](./docs/ARCHITECTURE.md) - System architecture
  - [DATA.md](./docs/DATA.md) - Database schemas
  - [SECURITY.md](./docs/SECURITY.md) - Security model
  - [ONBOARDING.md](./docs/ONBOARDING.md) - Developer guide

---

## 🚀 Quick Start

### Installation

```bash
npm install @blackms/aistack
```

### Initialize & Connect to Claude Code

```bash
# Initialize project structure
npx @blackms/aistack init

# Add to Claude Code MCP
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

Create `aistack.config.json` in your project root:

```json
{
  "version": "1.5.0",
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-sonnet-4-20250514"
    },
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4o"
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "model": "llama3.2"
    }
  },
  "memory": {
    "path": "./data/aistack.db",
    "vectorSearch": {
      "enabled": false,
      "provider": "openai"
    }
  },
  "driftDetection": {
    "enabled": false,
    "threshold": 0.95,
    "warningThreshold": 0.8,
    "ancestorDepth": 3,
    "behavior": "warn",
    "asyncEmbedding": true
  },
  "resourceExhaustion": {
    "enabled": false,
    "thresholds": {
      "maxFilesAccessed": 50,
      "maxApiCalls": 100,
      "maxSubtasksSpawned": 20,
      "maxTimeWithoutDeliverableMs": 1800000,
      "maxTokensConsumed": 500000
    },
    "warningThresholdPercent": 0.7,
    "checkIntervalMs": 10000,
    "autoTerminate": false,
    "pauseOnIntervention": true
  },
  "auth": {
    "enabled": true,
    "jwtSecret": "${JWT_SECRET}"
  }
}
```

---

## 💡 Usage Examples

### Example 1: Code Generation with Review

**Via Claude Code (MCP)**:
```
In Claude Code, just ask:
"Use aistack to generate a REST API for user authentication with adversarial review"

aistack will:
1. Spawn a coder agent to write the API
2. Spawn an adversarial agent to find vulnerabilities
3. Fix issues iteratively (up to 3 rounds)
4. Return production-ready code
```

**Via CLI**:
```bash
# Start adversarial review loop
npx @blackms/aistack workflow run adversarial-review \
  --task "Create REST API for user authentication"

# Check the review status
npx @blackms/aistack agent list
```

**Via TypeScript**:
```typescript
import { createReviewLoop, getConfig } from '@blackms/aistack';

const result = await createReviewLoop(
  'Create REST API for user authentication',
  getConfig(),
  { maxIterations: 3 }
);

console.log(result.finalVerdict); // APPROVED
console.log(result.currentCode);   // Production-ready code
```

### Example 2: Build Institutional Knowledge

**Store patterns as you learn**:
```bash
# Store a coding pattern
npx @blackms/aistack memory store \
  -k "api:error-handling" \
  -c "Always return { success: boolean, data?, error? } structure" \
  -n "best-practices"

# Store an architecture decision
npx @blackms/aistack memory store \
  -k "db:connection" \
  -c "Use connection pooling with max 10 connections" \
  -n "architecture"
```

**Search when you need it**:
```bash
# Find all patterns about error handling
npx @blackms/aistack memory search -q "error handling" -n "best-practices"

# Find architecture decisions about databases
npx @blackms/aistack memory search -q "database" -n "architecture"
```

**In Claude Code**:
```
You: "What's our pattern for API error handling?"
Claude uses memory_search tool: Returns your stored pattern
Claude: "Based on your team's pattern, use { success, data, error } structure"
```

### Example 3: Multi-Agent Collaboration

**Generate feature with tests and docs**:
```typescript
import { spawnAgent, getMemoryManager, getConfig } from '@blackms/aistack';

// 1. Coder writes the feature
const coder = spawnAgent('coder', { name: 'feature-coder' });
const code = await executeTask(coder, 'Create user profile API');

// 2. Tester writes tests
const tester = spawnAgent('tester', { name: 'test-writer' });
const tests = await executeTask(tester, 'Write tests for user profile API');

// 3. Documentation agent generates docs
const docs = spawnAgent('documentation', { name: 'doc-writer' });
const documentation = await executeTask(docs, 'Document user profile API');

// 4. Store the pattern for future use
const memory = getMemoryManager(getConfig());
await memory.store('pattern:user-api', 'User API pattern with tests and docs', {
  namespace: 'patterns',
  metadata: { code, tests, documentation }
});
```

### Example 4: Use in Claude Code

After installing the MCP server:
```bash
claude mcp add aistack -- npx @blackms/aistack mcp start
```

In Claude Code, you can:
```
"Spawn a researcher agent to analyze this codebase"
→ Uses agent_spawn tool

"Store this pattern in memory: Always validate user input"
→ Uses memory_store tool

"Search memory for authentication patterns"
→ Uses memory_search tool

"Start an adversarial review of this function"
→ Uses review_loop_start tool

"List all active agents"
→ Uses agent_list tool
```

### Example 5: CLI Workflow

```bash
# 1. Start a session
npx @blackms/aistack session start --metadata '{"project": "myapp"}'

# 2. Spawn specialized agents
npx @blackms/aistack agent spawn -t coder -n backend-coder
npx @blackms/aistack agent spawn -t tester -n test-writer
npx @blackms/aistack agent spawn -t reviewer -n code-reviewer

# 3. Run tasks (agents process automatically)
npx @blackms/aistack agent run -t coder -p "Create login endpoint"
npx @blackms/aistack agent run -t tester -p "Test login endpoint"
npx @blackms/aistack agent run -t reviewer -p "Review login code"

# 4. Check system status
npx @blackms/aistack status

# 5. End session
npx @blackms/aistack session end
```

### Example 6: Web Dashboard

```bash
# Start the dashboard
npx @blackms/aistack web start
```

Then open http://localhost:3001 to:
- 👀 **Monitor** all active agents in real-time
- 🧠 **Browse** and search your memory database
- ✅ **Manage** tasks and workflows visually
- 📊 **View** system health and statistics
- 🔄 **Watch** adversarial review loops in progress

---

## 📦 MCP Tools

### Agent Tools (6)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `agent_spawn` | Spawn a new agent | `{ type, name?, sessionId?, metadata? }` | `/src/mcp/tools/agent-tools.ts:45` |
| `agent_list` | List active agents | `{ sessionId? }` | `/src/mcp/tools/agent-tools.ts:90` |
| `agent_stop` | Stop an agent | `{ id?, name? }` | `/src/mcp/tools/agent-tools.ts:117` |
| `agent_status` | Get agent status | `{ id?, name? }` | `/src/mcp/tools/agent-tools.ts:144` |
| `agent_types` | List available agent types | `{}` | `/src/mcp/tools/agent-tools.ts:188` |
| `agent_update_status` | Update agent status | `{ id, status }` | `/src/mcp/tools/agent-tools.ts:214` |

### Memory Tools (5)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `memory_store` | Store memory entry | `{ key, content, namespace?, metadata?, agentId? }` | `/src/mcp/tools/memory-tools.ts:48` |
| `memory_search` | Search with FTS5 | `{ query, namespace?, limit?, agentId?, includeShared? }` | `/src/mcp/tools/memory-tools.ts:94` |
| `memory_get` | Get by key | `{ key, namespace? }` | `/src/mcp/tools/memory-tools.ts:145` |
| `memory_list` | List all entries | `{ namespace?, limit?, offset?, agentId?, includeShared? }` | `/src/mcp/tools/memory-tools.ts:182` |
| `memory_delete` | Delete entry | `{ key, namespace? }` | `/src/mcp/tools/memory-tools.ts:221` |

### Identity Tools (8)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `identity_create` | Create agent identity | `{ agentType, displayName?, capabilities?, metadata? }` | `/src/mcp/tools/identity-tools.ts:98` |
| `identity_get` | Get identity by ID or name | `{ agentId?, displayName? }` | `/src/mcp/tools/identity-tools.ts:155` |
| `identity_list` | List identities | `{ status?, agentType?, limit?, offset? }` | `/src/mcp/tools/identity-tools.ts:205` |
| `identity_update` | Update identity metadata | `{ agentId, displayName?, metadata?, capabilities? }` | `/src/mcp/tools/identity-tools.ts:247` |
| `identity_activate` | Activate identity | `{ agentId, actorId? }` | `/src/mcp/tools/identity-tools.ts:311` |
| `identity_deactivate` | Deactivate identity | `{ agentId, reason?, actorId? }` | `/src/mcp/tools/identity-tools.ts:342` |
| `identity_retire` | Retire identity (permanent) | `{ agentId, reason?, actorId? }` | `/src/mcp/tools/identity-tools.ts:378` |
| `identity_audit` | Get audit trail | `{ agentId, limit? }` | `/src/mcp/tools/identity-tools.ts:414` |

### Task Tools (8)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `task_create` | Create task with drift detection | `{ agentType, input?, sessionId?, parentTaskId? }` | `/src/mcp/tools/task-tools.ts:50` |
| `task_assign` | Assign task to agent | `{ taskId, agentId }` | `/src/mcp/tools/task-tools.ts:138` |
| `task_complete` | Mark task complete | `{ taskId, output?, status? }` | `/src/mcp/tools/task-tools.ts:169` |
| `task_list` | List tasks | `{ sessionId?, status? }` | `/src/mcp/tools/task-tools.ts:206` |
| `task_get` | Get task details | `{ taskId }` | `/src/mcp/tools/task-tools.ts:236` |
| `task_check_drift` | Check for semantic drift | `{ taskInput, taskType, parentTaskId? }` | `/src/mcp/tools/task-tools.ts:273` |
| `task_get_relationships` | Get task relationships | `{ taskId, direction? }` | `/src/mcp/tools/task-tools.ts:328` |
| `task_drift_metrics` | Get drift detection metrics | `{ since? }` | `/src/mcp/tools/task-tools.ts:376` |

### Session Tools (4)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `session_start` | Start new session | `{ metadata? }` | `/src/mcp/tools/session-tools.ts:23` |
| `session_end` | End session | `{ sessionId }` | `/src/mcp/tools/session-tools.ts:56` |
| `session_status` | Get session status | `{ sessionId }` | `/src/mcp/tools/session-tools.ts:85` |
| `session_active` | List active sessions | `{}` | `/src/mcp/tools/session-tools.ts:138` |

### System Tools (3)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `system_status` | Get system status | `{}` | `/src/mcp/tools/system-tools.ts:12` |
| `system_health` | Health check | `{}` | `/src/mcp/tools/system-tools.ts:52` |
| `system_config` | Get config | `{}` | `/src/mcp/tools/system-tools.ts:131` |

### GitHub Tools (7)

| Tool | Description | Input | Code |
|------|-------------|-------|------|
| `github_issue_create` | Create issue | `{ owner, repo, title, body }` | `/src/mcp/tools/github-tools.ts:94` |
| `github_issue_list` | List issues | `{ owner, repo, state? }` | `/src/mcp/tools/github-tools.ts:137` |
| `github_issue_get` | Get issue | `{ owner, repo, number }` | `/src/mcp/tools/github-tools.ts:170` |
| `github_pr_create` | Create PR | `{ owner, repo, title, body, head, base }` | `/src/mcp/tools/github-tools.ts:198` |
| `github_pr_list` | List PRs | `{ owner, repo, state? }` | `/src/mcp/tools/github-tools.ts:240` |
| `github_pr_get` | Get PR | `{ owner, repo, number }` | `/src/mcp/tools/github-tools.ts:273` |
| `github_repo_info` | Get repo info | `{ owner, repo }` | `/src/mcp/tools/github-tools.ts:301` |

**Total: 41 MCP Tools**

> **Note:** Review loop functionality is available via the programmatic API (`createReviewLoop`) and CLI, but not exposed as MCP tools.

---

## 💻 Programmatic API

### TypeScript SDK

```typescript
import {
  spawnAgent,
  getMemoryManager,
  startMCPServer,
  getConfig,
  createReviewLoop,
} from '@blackms/aistack';

// Spawn an agent
const agent = spawnAgent('coder', {
  name: 'my-coder',
  metadata: { project: 'awesome-app' }
});

// Use memory with FTS5 search
const memory = getMemoryManager(getConfig());
await memory.store('architecture:pattern', 'Use dependency injection', {
  namespace: 'best-practices',
  tags: ['architecture', 'patterns'],
});

const results = await memory.search('dependency injection');
console.log(results); // FTS5 ranked results

// Start adversarial review loop
const reviewState = await createReviewLoop(
  'Write a secure authentication function',
  getConfig(),
  { maxIterations: 3 }
);

console.log(reviewState.finalVerdict); // APPROVED or REJECTED
console.log(reviewState.currentCode);
console.log(reviewState.reviews); // All review rounds

// Start MCP server
const server = await startMCPServer(getConfig());
console.log('MCP server listening on stdio');
```

### Submodule Imports

```typescript
import { MemoryManager } from '@blackms/aistack/memory';
import { spawnAgent, listAgentTypes, pauseAgent, resumeAgent } from '@blackms/aistack/agents';
import { startMCPServer } from '@blackms/aistack/mcp';
import { getResourceExhaustionService } from '@blackms/aistack/monitoring';

// Direct imports for smaller bundles
const agentTypes = listAgentTypes();
// => ['coder', 'researcher', 'tester', 'reviewer', 'adversarial', 'architect', 'coordinator', 'analyst', 'devops', 'documentation', 'security-auditor']
```

---

## 📂 Project Structure

```
aistack/
├── src/
│   ├── agents/          # 11 agent types with system prompts + identity service
│   ├── mcp/             # MCP server + 41 tools
│   ├── memory/          # SQLite + FTS5 + vector search
│   ├── tasks/           # Drift detection service
│   ├── monitoring/      # Resource exhaustion, metrics, health
│   ├── coordination/    # Task queue, message bus, review loop
│   ├── web/             # REST API + WebSocket server + identity routes
│   ├── providers/       # 6 LLM provider integrations
│   ├── workflows/       # Multi-phase workflow engine
│   ├── auth/            # JWT + RBAC authentication
│   ├── github/          # GitHub issues/PRs integration
│   ├── plugins/         # Plugin system
│   ├── hooks/           # Lifecycle hooks
│   └── cli/             # Command-line interface
│
├── web/                 # React 18 dashboard
│   └── src/
│       ├── pages/       # 11 dashboard pages
│       ├── components/  # React components
│       └── stores/      # Zustand state management
│
├── migrations/          # Database migrations
├── tests/               # Unit + integration tests
├── docs/                # Technical documentation
└── .github/workflows/   # CI/CD pipeline
```

---

## 🧪 Development & Testing

### Build & Test

```bash
npm install               # Install dependencies
npm run build             # Build TypeScript to dist/
npm test                  # Run all tests (unit + integration)
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:coverage     # Generate coverage report
npm run typecheck         # Type check without emit
npm run lint              # ESLint
```

### CI/CD Pipeline

GitHub Actions workflow with **5 parallel jobs**:

1. **Lint** - ESLint code quality checks
2. **Typecheck** - TypeScript type validation
3. **Unit Tests** - Fast isolated tests
4. **Integration Tests** - Database + agent integration
5. **Build** - Production build verification

**Code Coverage:** Uploaded to Codecov after test completion

**Code:** `.github/workflows/ci.yml`

### Web Dashboard Development

```bash
npm run dev:web           # Start Vite dev server (hot reload)
npm run build:web         # Build for production
```

---

## ⚠️ What aistack Does NOT Include

To set accurate expectations, here are features **explicitly not implemented**:

- ❌ **Docker containerization** (no `Dockerfile` in project root)
- ❌ **Kubernetes/Helm manifests** (no orchestration configs)
- ❌ **Cloud-specific deployments** (AWS, GCP, Azure templates)
- ❌ **GraphQL API** (REST + WebSocket only)
- ❌ **Multi-tenancy** (single SQLite instance per deployment)
- ❌ **Built-in monitoring/observability** (no Prometheus/Grafana)
- ❌ **Message queue systems** (no Kafka, RabbitMQ, Redis Streams)
- ❌ **Distributed tracing** (no OpenTelemetry integration)

aistack is designed as a **local-first, NPM-distributed package** for developer workflows, not cloud-native microservices.

---

## 🗺️ Roadmap

| Priority | Feature | Status |
|----------|---------|--------|
| **P1** | HTTP transport for MCP server | Planned |
| **P1** | Streaming responses (SSE) | Planned |
| **P2** | Agent state persistence to SQLite | Planned |
| **P2** | Built-in workflow templates | Planned |
| **P3** | Enhanced dashboard analytics | Planned |
| **P3** | Metrics and observability hooks | Planned |
| **P3** | Docker support (optional) | Under consideration |

<sub>Roadmap items are **planned features**, not current capabilities.</sub>

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

**PR Requirements:**
- All tests pass (`npm test`)
- Code linted (`npm run lint`)
- Type checked (`npm run typecheck`)
- Build succeeds (`npm run build`)
- Code coverage maintained or improved

---

## 📄 License

[MIT](LICENSE) © 2024

---

<div align="center">

**[Wiki](https://github.com/blackms/aistack/wiki)** · **[Documentation](./docs)** · **[Issues](https://github.com/blackms/aistack/issues)** · **[Discussions](https://github.com/blackms/aistack/discussions)** · **[NPM Package](https://www.npmjs.com/package/@blackms/aistack)**

<sub>Built with TypeScript · Made for Claude Code · Distributed via NPM</sub>

<br/>

---

<br/>

<sub>✅ **README verified against codebase v1.5.0+** - All claims backed by implemented code with file:line references (includes Resource Exhaustion Monitoring)</sub>

</div>
