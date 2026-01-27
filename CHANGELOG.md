# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-01-27

### Added

- **Semantic Drift Detection**: Detect when task descriptions are semantically similar to ancestor tasks (#3)
  - Embedding-based similarity checking using OpenAI or Ollama
  - Configurable thresholds: `threshold` (block/warn) and `warningThreshold` (warn only)
  - Two behaviors: `warn` (log and allow) or `prevent` (block creation)
  - Task relationship tracking: `parent_of`, `derived_from`, `depends_on`, `supersedes`
  - Metrics and event logging for drift detection analysis

- **Drift Detection MCP Tools**: 4 new/updated tools
  - `task_create` - Now supports `parentTaskId` for drift checking
  - `task_check_drift` - Check if a task would trigger drift detection
  - `task_get_relationships` - Get task relationships (parent/child, dependencies)
  - `task_drift_metrics` - Get drift detection metrics and recent events

- **Drift Detection Configuration**:
  ```json
  {
    "driftDetection": {
      "enabled": true,
      "threshold": 0.95,
      "warningThreshold": 0.8,
      "ancestorDepth": 3,
      "behavior": "warn",
      "asyncEmbedding": true
    }
  }
  ```

- **Database Schema**: New tables for drift detection
  - `task_embeddings` - Store task embeddings for similarity comparison
  - `task_relationships` - Track parent/child and dependency relationships
  - `drift_detection_events` - Log drift detection events for metrics

### Changed

- `EmbeddingProvider` interface now exposes `model` property
- Config validation ensures `warningThreshold < threshold`

## [1.4.0] - 2026-01-27

### Added

- **Agent Identity v1**: Persistent agent identities with lifecycle management
  - Stable `agent_id` (UUID) that persists across executions
  - Lifecycle states: `created` → `active` → `dormant` → `retired`
  - Agent capabilities and metadata storage
  - Full audit trail for all identity lifecycle events

- **Agent-Scoped Memory**: Memory namespaces owned by agents
  - `agentId` parameter for memory operations
  - `includeShared` option to access shared memory (agent_id = NULL)
  - Memory isolation between agents

- **Identity REST API**: New endpoints at `/api/v1/identities`
  - `POST /api/v1/identities` - Create new identity
  - `GET /api/v1/identities` - List identities with filters
  - `GET /api/v1/identities/:id` - Get identity by ID
  - `GET /api/v1/identities/name/:name` - Get identity by display name
  - `PATCH /api/v1/identities/:id` - Update identity metadata
  - `POST /api/v1/identities/:id/activate` - Activate identity
  - `POST /api/v1/identities/:id/deactivate` - Deactivate identity
  - `POST /api/v1/identities/:id/retire` - Retire identity (permanent)
  - `GET /api/v1/identities/:id/audit` - Get audit trail

- **Identity MCP Tools**: 8 new tools for identity management
  - `identity_create` - Create a new persistent agent identity
  - `identity_get` - Get identity by ID or display name
  - `identity_list` - List identities with filters
  - `identity_update` - Update identity metadata
  - `identity_activate` - Activate an identity
  - `identity_deactivate` - Deactivate an identity
  - `identity_retire` - Retire an identity permanently
  - `identity_audit` - Get audit trail for an identity

- **Spawner Integration**: Identity support in agent spawning
  - `identityId` option to spawn with existing identity
  - `createIdentity` option to auto-create ephemeral identity
  - Stopping an agent transitions its identity to `dormant`

### Changed

- Memory tools (`memory_store`, `memory_search`, `memory_list`) now support `agentId` parameter
- `stopAgent` now deactivates linked identity instead of just touching lastActiveAt

### Fixed

- SQL syntax error when using OFFSET without LIMIT in identity queries
- Unused import in agent-watch command

## [1.3.1] - 2026-01-27

### Fixed

- Code review issues in agent watch command

## [1.3.0] - 2026-01-27

### Added

- Agent watch command for real-time monitoring (`aistack agent watch`)
