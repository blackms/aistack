# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.1] - 2026-01-30

### Added

- Smart Dispatcher for automatic agent type selection (#20).

### Changed

- Added a Discord community badge to the README.

### Fixed

- Reduced the uptime threshold in the health test to tolerate CI timing variations.

## [1.5.4] - 2026-01-29

### Added

- Consensus checkpoints for high-stakes tasks (#5).
- `deleteTask` method with CASCADE cleanup verification (#19).

### Changed

- Improved consensus checkpoints based on code review feedback.
- Raised test coverage to 85%+ (#6).
- Documentation: full adversarial documentation sync (v1.5.3), session-based memory isolation sync (v1.5.2), and documented consensus checkpoints, the async embedding race condition (#15), and API cost implications for drift detection (#13).

### Fixed

- Removed unused imports in `consensus-service.ts`.

## [1.5.2] - 2026-01-28

### Fixed

- Prevented memory contamination between agents running in different sessions (#17).

## [1.5.1] - 2026-01-28

### Changed

- Maintenance release (version bump only).

## [1.5.0] - 2026-01-27

### Added

- Semantic drift detection for task descriptions, with embedding-based similarity checking, configurable thresholds, and task relationship tracking (#12).
- Resource exhaustion triggers for agent monitoring (#4, #16).

### Changed

- Synced HLD/LLD and full documentation to v1.5.0 with adversarial verification.
- Added documentation working files to `.gitignore`.

## [1.4.0] - 2026-01-27

### Added

- Agent Identity v1: persistent agent identities with lifecycle management, agent-scoped memory, REST API, and 8 MCP tools (#10).
- Agent watch command for real-time monitoring (`aistack agent watch`).
- Comprehensive usage examples section in the documentation.

### Changed

- Simplified the README (removed architecture diagrams, clarified what aistack does).
- Synchronized documentation with the v1.3.1 codebase.

### Fixed

- Addressed code review issues in the agent watch command.
- Merged unit and integration coverage reports to fix an 8% Codecov discrepancy.

## [1.3.1] - 2026-01-27

### Added

- P2 and P3 enhancements across agents, workflows, memory, monitoring, and integrations (#2).

### Changed

- Optimized the CI/CD pipeline for 60-75% faster execution.
- Expanded test coverage for auth routes, monitoring modules, web utils, auth middleware, and the Slack notifier.

### Fixed

- Ran tests in the coverage job instead of reusing artifacts.
- Separated unit and integration tests to prevent database conflicts.
- Wrapped the error in an object for the logger in the auth service.
- Addressed code review issues from PR #2.

## [1.3.0] - 2026-01-25

### Added

- Adversarial agent with an iterative review loop.

### Changed

- Enhanced the README with web dashboard and architecture diagrams.

### Fixed

- Used an environment variable for the WebSocket URL in development.
- Configured coverage to properly include/exclude files.
- Removed unused imports in the review-loop modules.

## [1.2.0] - 2026-01-25

### Added

- IDE-like task workflow UI with project management.

### Fixed

- Removed an unused import in the projects route.

## [1.1.0] - 2026-01-25

### Added

- Web interface for AgentStack.
- Agent `run` and `exec` commands for CLI execution.

### Changed

- Revamped the README with a modern, startup-grade design.
- Synced documentation with the codebase implementation.
- Increased global test coverage to 90%+.

### Fixed

- Updated `CodexProvider` to use `codex exec` for non-interactive execution.
- Resolved lint errors in the web module.
- Improved server test reliability on CI.

## [1.0.10] - 2026-01-24

### Changed

- Maintenance release (version bump only).

## [1.0.9] - 2026-01-24

### Added

- CLI-based LLM providers (Claude Code, Gemini CLI, Codex).

### Fixed

- Resolved ESLint unused-variable errors.

## [1.0.8] - 2026-01-24

### Added

- Workflow system with adversarial documentation sync.
- Auto-trigger of the doc-sync workflow on documentation changes in the post-task hook.

### Changed

- Improved test coverage to 83.41%, adding tests across MCP tools, spawner, registry, system tools, topology, plugin loading, vector search, embeddings, hooks, and providers.
- Fixed README accuracy issues and added a LICENSE file.

### Fixed

- Added the lcov coverage format for Codecov.

## [1.0.7] - 2026-01-24

### Changed

- Increased test coverage from 14% to 36% and added Codecov configuration.

## [1.0.6] - 2026-01-24

### Changed

- Updated repository references after the GitHub rename to aistack.

## [1.0.5] - 2026-01-24

### Added

- Initial public release of the agent orchestration toolkit (formerly agentstack), published as `@blackms/aistack`.
- CI/CD workflows and enhanced README badges.
- Modern README with adversarial validation.

### Changed

- Renamed the package from `agentstack` to `@blackms/aistack`.
- Migrated to ESLint 9 flat config.

### Fixed

- Corrected the repository URL for npm provenance.
- Fixed the test for the `aistack.db` rename.
- Resolved lint errors.

[Unreleased]: https://github.com/blackms/aistack/compare/v1.6.1...HEAD
[1.6.1]: https://github.com/blackms/aistack/compare/v1.5.4...v1.6.1
[1.5.4]: https://github.com/blackms/aistack/compare/v1.5.2...v1.5.4
[1.5.2]: https://github.com/blackms/aistack/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/blackms/aistack/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/blackms/aistack/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/blackms/aistack/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/blackms/aistack/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/blackms/aistack/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/blackms/aistack/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/blackms/aistack/compare/v1.0.10...v1.1.0
[1.0.10]: https://github.com/blackms/aistack/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/blackms/aistack/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/blackms/aistack/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/blackms/aistack/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/blackms/aistack/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/blackms/aistack/releases/tag/v1.0.5
