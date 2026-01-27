# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
