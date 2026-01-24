# Architecture Decision Records (ADRs)

> Documenting significant architectural decisions

## Overview

This directory contains Architecture Decision Records (ADRs) that capture important architectural decisions made during the development of AgentStack.

## ADR Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| [ADR-001](ADR-001-sqlite-persistence.md) | SQLite for Persistence | Accepted | 2024 |
| [ADR-002](ADR-002-singleton-pattern.md) | Singleton Pattern for Global State | Accepted | 2024 |
| [ADR-003](ADR-003-eventemitter-coordination.md) | EventEmitter for Coordination | Accepted | 2024 |
| [ADR-004](ADR-004-mcp-stdio-transport.md) | MCP over Stdio Transport | Accepted | 2024 |
| [ADR-005](ADR-005-hybrid-search.md) | Hybrid FTS + Vector Search | Accepted | 2024 |
| [ADR-006](ADR-006-plugin-system.md) | Plugin System Design | Accepted | 2024 |

## ADR Template

```markdown
# ADR-NNN: Title

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing and/or doing?

## Alternatives Considered
What other options were evaluated?

## Consequences
What becomes easier or more difficult as a result of this change?

## References
Links to related documents, issues, or discussions.
```

## Contributing

When making significant architectural changes:

1. Create a new ADR file: `ADR-NNN-short-title.md`
2. Follow the template above
3. Update this index
4. Reference the ADR in relevant code comments
