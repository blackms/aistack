# API Reference

> Complete API documentation for AgentStack

## Overview

AgentStack provides three API surfaces:

1. **MCP Tools** - 46 tools exposed via Model Context Protocol for Claude Code
2. **Programmatic API** - TypeScript/JavaScript library exports
3. **CLI Commands** - Command-line interface
4. **REST API** - HTTP endpoints for web dashboard and integrations

## MCP Tools Reference

### Agent Tools

#### `agent_spawn`

Create a new agent instance.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "Type of agent to spawn",
      "enum": ["coder", "researcher", "tester", "reviewer", "adversarial", "architect", "coordinator", "analyst", "devops", "documentation", "security-auditor"]
    },
    "name": {
      "type": "string",
      "description": "Optional name for the agent"
    },
    "sessionId": {
      "type": "string",
      "description": "Optional session to associate with"
    },
    "metadata": {
      "type": "object",
      "description": "Optional metadata"
    }
  },
  "required": ["type"]
}
```

**Response**:
```json
{
  "success": true,
  "agent": {
    "id": "uuid-v4",
    "type": "coder",
    "name": "coder-1",
    "status": "idle",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "prompt": "You are an expert software engineer..."
}
```

---

#### `agent_list`

List active agents.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Filter by session ID"
    }
  }
}
```

**Response**:
```json
{
  "agents": [
    {
      "id": "uuid-v4",
      "type": "coder",
      "name": "coder-1",
      "status": "running",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "sessionId": "session-1"
    }
  ],
  "count": 1
}
```

---

#### `agent_stop`

Stop an agent.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Agent ID to stop"
    },
    "name": {
      "type": "string",
      "description": "Agent name to stop (alternative to ID)"
    }
  }
}
```

**Response**:
```json
{
  "success": true,
  "agentId": "uuid-v4"
}
```

---

#### `agent_status`

Get agent details and capabilities.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Agent ID"
    },
    "name": {
      "type": "string",
      "description": "Agent name (alternative)"
    }
  }
}
```

**Response**:
```json
{
  "agent": {
    "id": "uuid-v4",
    "type": "coder",
    "name": "coder-1",
    "status": "running"
  },
  "capabilities": ["write-code", "edit-code", "refactor", "debug"],
  "systemPrompt": "You are an expert software engineer..."
}
```

---

#### `agent_types`

List available agent types.

**Input Schema**: None required

**Response**:
```json
{
  "types": [
    {
      "type": "coder",
      "name": "Coder Agent",
      "description": "Expert software engineer for writing and editing code",
      "capabilities": ["write-code", "edit-code", "refactor", "debug"]
    }
  ],
  "count": 7
}
```

---

#### `agent_update_status`

Update an agent's status.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": ["idle", "running", "completed", "failed", "stopped"]
    }
  },
  "required": ["id", "status"]
}
```

---

### Identity Tools

Agent Identity v1 provides persistent identity management for agents with lifecycle states and audit trails.

#### `identity_create`

Create a new persistent agent identity.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentType": {
      "type": "string",
      "description": "Type of agent (e.g., coder, researcher)"
    },
    "displayName": {
      "type": "string",
      "description": "Human-readable name for the identity"
    },
    "description": {
      "type": "string",
      "description": "Description of the identity"
    },
    "capabilities": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "version": { "type": "string" },
          "enabled": { "type": "boolean" }
        }
      }
    },
    "metadata": { "type": "object" },
    "autoActivate": {
      "type": "boolean",
      "description": "Automatically activate after creation"
    }
  },
  "required": ["agentType"]
}
```

**Response**:
```json
{
  "success": true,
  "identity": {
    "agentId": "uuid-v4",
    "agentType": "coder",
    "status": "created",
    "capabilities": [],
    "version": 1,
    "displayName": "My Coder",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "lastActiveAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### `identity_get`

Get an identity by ID or display name.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentId": { "type": "string", "description": "Identity UUID" },
    "displayName": { "type": "string", "description": "Display name lookup" }
  }
}
```

---

#### `identity_list`

List identities with optional filters.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["created", "active", "dormant", "retired"]
    },
    "agentType": { "type": "string" },
    "limit": { "type": "number" },
    "offset": { "type": "number" }
  }
}
```

---

#### `identity_update`

Update identity metadata (not status).

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentId": { "type": "string" },
    "displayName": { "type": "string" },
    "description": { "type": "string" },
    "metadata": { "type": "object" },
    "capabilities": { "type": "array" }
  },
  "required": ["agentId"]
}
```

---

#### `identity_activate`

Transition identity from `created` or `dormant` to `active`.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentId": { "type": "string" },
    "actorId": { "type": "string", "description": "Actor making the change" }
  },
  "required": ["agentId"]
}
```

---

#### `identity_deactivate`

Transition identity from `active` to `dormant`.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentId": { "type": "string" },
    "reason": { "type": "string" },
    "actorId": { "type": "string" }
  },
  "required": ["agentId"]
}
```

---

#### `identity_retire`

Permanently retire an identity (terminal state).

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentId": { "type": "string" },
    "reason": { "type": "string" },
    "actorId": { "type": "string" }
  },
  "required": ["agentId"]
}
```

---

#### `identity_audit`

Get the audit trail for an identity.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentId": { "type": "string" },
    "limit": { "type": "number", "default": 100 }
  },
  "required": ["agentId"]
}
```

**Response**:
```json
{
  "agentId": "uuid-v4",
  "count": 3,
  "entries": [
    {
      "id": "audit-uuid",
      "action": "created",
      "previousStatus": null,
      "newStatus": "created",
      "reason": null,
      "actorId": null,
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### Memory Tools

#### `memory_store`

Store a key-value entry with optional agent ownership.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "string",
      "description": "Unique key for the entry"
    },
    "content": {
      "type": "string",
      "description": "Content to store"
    },
    "namespace": {
      "type": "string",
      "description": "Namespace (default: 'default')"
    },
    "metadata": {
      "type": "object",
      "description": "Additional metadata"
    },
    "generateEmbedding": {
      "type": "boolean",
      "description": "Generate vector embedding"
    },
    "agentId": {
      "type": "string",
      "description": "Agent ID to associate this memory with (for scoped memory)"
    }
  },
  "required": ["key", "content"]
}
```

**Response**:
```json
{
  "success": true,
  "entry": {
    "id": "uuid-v4",
    "key": "pattern-singleton",
    "namespace": "architecture",
    "content": "Use singleton for config...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### `memory_search`

Search memory with hybrid FTS + vector search, with optional agent scoping.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "namespace": {
      "type": "string",
      "description": "Namespace filter"
    },
    "limit": {
      "type": "number",
      "description": "Max results (default: 10)"
    },
    "threshold": {
      "type": "number",
      "description": "Vector similarity threshold (default: 0.7)"
    },
    "useVector": {
      "type": "boolean",
      "description": "Enable vector search"
    },
    "agentId": {
      "type": "string",
      "description": "Filter by agent ownership"
    },
    "includeShared": {
      "type": "boolean",
      "description": "Include shared memory (agent_id = NULL), default: true"
    }
  },
  "required": ["query"]
}
```

**Response**:
```json
{
  "count": 2,
  "results": [
    {
      "entry": {
        "id": "uuid-v4",
        "key": "pattern-singleton",
        "content": "..."
      },
      "score": 0.95,
      "matchType": "vector"
    }
  ]
}
```

---

#### `memory_get`

Get entry by key.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "key": { "type": "string" },
    "namespace": { "type": "string" }
  },
  "required": ["key"]
}
```

---

#### `memory_list`

List entries with pagination.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "namespace": { "type": "string" },
    "limit": { "type": "number", "default": 20 },
    "offset": { "type": "number", "default": 0 }
  }
}
```

---

#### `memory_delete`

Delete an entry.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "key": { "type": "string" },
    "namespace": { "type": "string" }
  },
  "required": ["key"]
}
```

---

### Task Tools

#### `task_create`

Create a task for an agent type with optional drift detection.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentType": {
      "type": "string",
      "description": "Target agent type"
    },
    "input": {
      "type": "string",
      "description": "Task input/description"
    },
    "sessionId": {
      "type": "string",
      "description": "Session to associate with"
    },
    "parentTaskId": {
      "type": "string",
      "description": "Parent task ID for drift detection"
    }
  },
  "required": ["agentType"]
}
```

**Response**:
```json
{
  "success": true,
  "task": {
    "id": "uuid-v4",
    "agentType": "coder",
    "status": "pending",
    "input": "Implement feature X",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "parentTaskId": "parent-uuid"
  },
  "drift": {
    "isDrift": false,
    "highestSimilarity": 0.45,
    "action": "allowed"
  }
}
```

---

#### `task_assign`

Assign task to specific agent.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" },
    "agentId": { "type": "string" }
  },
  "required": ["taskId", "agentId"]
}
```

---

#### `task_complete`

Mark task as complete.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" },
    "output": { "type": "string" }
  },
  "required": ["taskId"]
}
```

---

#### `task_list`

List tasks with filters.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": { "type": "string" },
    "status": {
      "type": "string",
      "enum": ["pending", "running", "completed", "failed"]
    }
  }
}
```

---

#### `task_get`

Get task details.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" }
  },
  "required": ["taskId"]
}
```

---

#### `task_check_drift`

Check if a task description would trigger drift detection against ancestors.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskInput": {
      "type": "string",
      "description": "Task input/description to check"
    },
    "taskType": {
      "type": "string",
      "description": "Agent type for this task"
    },
    "parentTaskId": {
      "type": "string",
      "description": "Parent task ID to check against"
    }
  },
  "required": ["taskInput", "taskType"]
}
```

**Response**:
```json
{
  "success": true,
  "result": {
    "isDrift": true,
    "highestSimilarity": 0.97,
    "mostSimilarTaskId": "ancestor-uuid",
    "mostSimilarTaskInput": "Similar task description...",
    "action": "warned",
    "checkedAncestors": 3
  },
  "config": {
    "enabled": true,
    "threshold": 0.95,
    "warningThreshold": 0.8,
    "behavior": "warn"
  }
}
```

---

#### `task_get_relationships`

Get relationships for a task (parent/child, dependencies).

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" },
    "direction": {
      "type": "string",
      "enum": ["outgoing", "incoming", "both"],
      "default": "both"
    }
  },
  "required": ["taskId"]
}
```

**Response**:
```json
{
  "success": true,
  "count": 2,
  "relationships": [
    {
      "id": "rel-uuid",
      "fromTaskId": "parent-uuid",
      "toTaskId": "task-uuid",
      "relationshipType": "parent_of",
      "metadata": null,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

Relationship types: `parent_of`, `derived_from`, `depends_on`, `supersedes`

---

#### `task_drift_metrics`

Get drift detection metrics and statistics.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "since": {
      "type": "string",
      "description": "ISO date string to filter metrics since"
    }
  }
}
```

**Response**:
```json
{
  "success": true,
  "metrics": {
    "totalEvents": 50,
    "allowedCount": 40,
    "warnedCount": 8,
    "preventedCount": 2,
    "averageSimilarity": 0.65
  },
  "recentEvents": [
    {
      "id": "event-uuid",
      "taskId": "task-uuid",
      "taskType": "coder",
      "ancestorTaskId": "ancestor-uuid",
      "similarityScore": 0.97,
      "actionTaken": "warned",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "config": {
    "enabled": true,
    "threshold": 0.95,
    "warningThreshold": 0.8,
    "ancestorDepth": 3,
    "behavior": "warn"
  }
}
```

---

### Consensus Tools

Tools for managing consensus checkpoints that gate high-risk task creation.

#### `consensus_check`

Check if a task would require consensus before creation.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agentType": { "type": "string", "description": "Agent type for this task" },
    "input": { "type": "string", "description": "Task input/description" },
    "parentTaskId": { "type": "string", "description": "Parent task ID" },
    "riskLevel": { "type": "string", "enum": ["low", "medium", "high"], "description": "Risk level override" }
  },
  "required": ["agentType"]
}
```

**Response**:
```json
{
  "success": true,
  "requiresConsensus": true,
  "reason": "Risk level 'high' requires consensus",
  "riskLevel": "high",
  "depth": 2,
  "config": {
    "enabled": true,
    "requireForRiskLevels": ["high", "medium"],
    "maxDepth": 5
  }
}
```

---

#### `consensus_list_pending`

List pending consensus checkpoints.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "limit": { "type": "number", "description": "Max checkpoints to return" },
    "offset": { "type": "number", "description": "Offset for pagination" }
  }
}
```

**Response**:
```json
{
  "success": true,
  "count": 2,
  "checkpoints": [
    {
      "id": "uuid-v4",
      "taskId": "task-uuid",
      "riskLevel": "high",
      "status": "pending",
      "reviewerStrategy": "adversarial",
      "subtaskCount": 1,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "expiresAt": "2024-01-01T00:05:00.000Z"
    }
  ]
}
```

---

#### `consensus_get`

Get a consensus checkpoint by ID.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "checkpointId": { "type": "string", "description": "Checkpoint ID" }
  },
  "required": ["checkpointId"]
}
```

**Response**:
```json
{
  "success": true,
  "checkpoint": {
    "id": "uuid-v4",
    "taskId": "task-uuid",
    "proposedSubtasks": [...],
    "riskLevel": "high",
    "status": "pending",
    "reviewerStrategy": "adversarial",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "expiresAt": "2024-01-01T00:05:00.000Z"
  }
}
```

---

#### `consensus_approve`

Approve a consensus checkpoint.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "checkpointId": { "type": "string", "description": "Checkpoint ID" },
    "reviewedBy": { "type": "string", "description": "Reviewer ID" },
    "feedback": { "type": "string", "description": "Optional feedback" }
  },
  "required": ["checkpointId", "reviewedBy"]
}
```

**Response**:
```json
{
  "success": true,
  "checkpoint": {
    "id": "uuid-v4",
    "status": "approved",
    "decidedAt": "2024-01-01T00:02:00.000Z"
  }
}
```

---

#### `consensus_reject`

Reject a consensus checkpoint.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "checkpointId": { "type": "string", "description": "Checkpoint ID" },
    "reviewedBy": { "type": "string", "description": "Reviewer ID" },
    "feedback": { "type": "string", "description": "Rejection reason" },
    "rejectedSubtaskIds": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Specific subtask IDs to reject (partial rejection)"
    }
  },
  "required": ["checkpointId", "reviewedBy"]
}
```

**Response**:
```json
{
  "success": true,
  "checkpoint": {
    "id": "uuid-v4",
    "status": "rejected",
    "decidedAt": "2024-01-01T00:02:00.000Z"
  }
}
```

---

### Session Tools

#### `session_start`

Create a new session.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "metadata": { "type": "object" }
  }
}
```

**Response**:
```json
{
  "success": true,
  "session": {
    "id": "uuid-v4",
    "status": "active",
    "startedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### `session_end`

End the active session.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": { "type": "string" }
  }
}
```

---

#### `session_status`

Get session info.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "sessionId": { "type": "string" }
  },
  "required": ["sessionId"]
}
```

---

#### `session_active`

Get current active session.

**Input Schema**: None required

---

### System Tools

#### `system_status`

Get system statistics.

**Input Schema**: None required

**Response**:
```json
{
  "agents": {
    "active": 3,
    "byStatus": {
      "idle": 1,
      "running": 2
    }
  },
  "memory": {
    "entries": 150,
    "namespaces": ["default", "architecture"]
  },
  "tasks": {
    "pending": 5,
    "processing": 2
  }
}
```

---

#### `system_health`

Get system health check.

**Input Schema**: None required

**Response**:
```json
{
  "status": "healthy",
  "checks": {
    "database": true,
    "vectorSearch": true,
    "github": false
  }
}
```

---

#### `system_config`

Get current configuration.

**Input Schema**: None required

---

### GitHub Tools

#### `github_issue_create`

Create a GitHub issue.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "title": { "type": "string" },
    "body": { "type": "string" },
    "labels": { "type": "array", "items": { "type": "string" } },
    "assignees": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["owner", "repo", "title"]
}
```

---

#### `github_issue_list`

List repository issues.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "state": { "type": "string", "enum": ["open", "closed", "all"] },
    "labels": { "type": "string" },
    "limit": { "type": "number" }
  },
  "required": ["owner", "repo"]
}
```

---

#### `github_issue_get`

Get issue details.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "number": { "type": "number" }
  },
  "required": ["owner", "repo", "number"]
}
```

---

#### `github_pr_create`

Create a pull request.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "title": { "type": "string" },
    "head": { "type": "string", "description": "Branch with changes" },
    "base": { "type": "string", "description": "Target branch" },
    "body": { "type": "string" },
    "draft": { "type": "boolean" }
  },
  "required": ["owner", "repo", "title", "head", "base"]
}
```

---

#### `github_pr_list`

List pull requests.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "state": { "type": "string", "enum": ["open", "closed", "all"] },
    "limit": { "type": "number" }
  },
  "required": ["owner", "repo"]
}
```

---

#### `github_pr_get`

Get PR details.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" },
    "number": { "type": "number" }
  },
  "required": ["owner", "repo", "number"]
}
```

---

#### `github_repo_info`

Get repository information.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "owner": { "type": "string" },
    "repo": { "type": "string" }
  },
  "required": ["owner", "repo"]
}
```

---

### Review Loop (Programmatic API)

> **Note:** Review loop functionality is available via the programmatic API (`createReviewLoop`) and CLI (`workflow run adversarial-review`), but not exposed as MCP tools. Use the TypeScript SDK for full review loop capabilities.

#### `review_loop_start` (Programmatic)

Start a new adversarial review loop where a coder agent generates code and an adversarial agent reviews it iteratively.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "Code or task description to review"
    },
    "maxIterations": {
      "type": "number",
      "description": "Maximum review iterations (default: 3, max: 10)"
    },
    "sessionId": {
      "type": "string",
      "description": "Session ID to associate with"
    }
  },
  "required": ["code"]
}
```

**Response**:
```json
{
  "success": true,
  "loop": {
    "id": "uuid-v4",
    "status": "approved",
    "iteration": 2,
    "maxIterations": 3,
    "coderId": "agent-uuid",
    "adversarialId": "agent-uuid",
    "reviewCount": 2,
    "finalVerdict": "APPROVED"
  },
  "finalCode": "...",
  "message": "Code approved after 2 iteration(s)"
}
```

---

#### `review_loop_status`

Get the current status and details of a review loop.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "loopId": { "type": "string", "description": "Review loop ID" }
  },
  "required": ["loopId"]
}
```

**Response**:
```json
{
  "found": true,
  "loop": {
    "id": "uuid-v4",
    "status": "running",
    "iteration": 1,
    "maxIterations": 3
  },
  "latestReview": {
    "verdict": "NEEDS_CHANGES",
    "issueCount": 3,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### `review_loop_abort`

Stop a running review loop.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "loopId": { "type": "string", "description": "Review loop ID to abort" }
  },
  "required": ["loopId"]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Review loop aborted"
}
```

---

#### `review_loop_issues`

Get detailed issues from all reviews in a loop.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "loopId": { "type": "string", "description": "Review loop ID" }
  },
  "required": ["loopId"]
}
```

**Response**:
```json
{
  "found": true,
  "loopId": "uuid-v4",
  "reviews": [
    {
      "iteration": 1,
      "reviewId": "review-uuid",
      "verdict": "NEEDS_CHANGES",
      "issueCount": 2,
      "issues": [
        {
          "id": "issue-uuid",
          "severity": "high",
          "title": "SQL Injection vulnerability",
          "location": "file.ts:42",
          "attackVector": "...",
          "impact": "...",
          "requiredFix": "..."
        }
      ],
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### `review_loop_list`

List all active review loops.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**Response**:
```json
{
  "count": 2,
  "loops": [
    {
      "id": "uuid-v4",
      "status": "running",
      "iteration": 1,
      "maxIterations": 3
    }
  ]
}
```

---

#### `review_loop_get_code`

Get the current code from a review loop.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "loopId": { "type": "string", "description": "Review loop ID" }
  },
  "required": ["loopId"]
}
```

**Response**:
```json
{
  "found": true,
  "loopId": "uuid-v4",
  "status": "approved",
  "iteration": 2,
  "originalInput": "...",
  "currentCode": "...",
  "finalVerdict": "APPROVED"
}
```

---

## Programmatic API

### Configuration

```typescript
import { loadConfig, getConfig, saveConfig, validateConfig } from '@blackms/aistack';

// Load from file
const config = loadConfig('./aistack.config.json');

// Get cached singleton
const config = getConfig();

// Save configuration
saveConfig(config, './aistack.config.json');

// Validate
const { valid, errors } = validateConfig(config);
```

### Memory Manager

```typescript
import { getMemoryManager, MemoryManager } from '@blackms/aistack';

// Get singleton
const memory = getMemoryManager();

// Or create new instance
const memory = new MemoryManager(config);

// Store
const entry = await memory.store('key', 'content', {
  namespace: 'myns',
  metadata: { tags: ['important'] },
  generateEmbedding: true
});

// Search
const results = await memory.search('query', {
  namespace: 'myns',
  limit: 10,
  threshold: 0.7,
  useVector: true
});

// Get/Delete
const entry = memory.get('key', 'myns');
memory.delete('key', 'myns');

// Sessions
const session = memory.createSession({ project: 'myproject' });
memory.endSession(session.id);

// Tasks
const task = memory.createTask('coder', 'implement feature', session.id);
memory.updateTaskStatus(task.id, 'completed', 'Done');
```

### Agents

```typescript
import {
  spawnAgent,
  getAgent,
  listAgents,
  stopAgent,
  getAgentDefinition,
  registerAgent
} from '@blackms/aistack';

// Spawn agent
const agent = spawnAgent('coder', {
  name: 'my-coder',
  sessionId: 'session-1',
  metadata: { project: 'myproject' }
});

// Get by ID or name
const agent = getAgent('uuid');
const agent = getAgentByName('my-coder');

// List agents
const agents = listAgents('session-1');

// Stop
stopAgent(agent.id);

// Update status
updateAgentStatus(agent.id, 'running');

// Register custom agent
registerAgent({
  type: 'my-agent',
  name: 'My Custom Agent',
  description: 'Does custom things',
  systemPrompt: 'You are a custom agent...',
  capabilities: ['custom-capability']
});
```

### Providers

```typescript
import { createProvider, AnthropicProvider, OpenAIProvider, OllamaProvider } from '@blackms/aistack';

// Create from config
const provider = createProvider(config);

// Or create directly
const anthropic = new AnthropicProvider(apiKey, 'claude-sonnet-4-20250514');
const openai = new OpenAIProvider(apiKey, 'gpt-4o');
const ollama = new OllamaProvider('http://localhost:11434', 'llama3.2');

// Chat
const response = await provider.chat([
  { role: 'user', content: 'Hello' }
], {
  temperature: 0.7,
  maxTokens: 1000
});

// Embeddings (OpenAI and Ollama only - Anthropic does not implement embed())
const embedding = await provider.embed?.('text to embed');
```

### Coordination

```typescript
import { TaskQueue, MessageBus, HierarchicalCoordinator, getMessageBus } from '@blackms/aistack';

// Task Queue
const queue = new TaskQueue();
queue.enqueue(task, 8); // priority 1-10
queue.on('task:added', () => console.log('Task added'));
const task = queue.dequeue('coder');
queue.assign(task.id, agentId);
queue.complete(task.id);

// Message Bus
const bus = getMessageBus();
bus.send(fromId, toId, 'task:assign', { task });
bus.broadcast(fromId, 'status:update', { status: 'ready' });
const unsubscribe = bus.subscribe(agentId, (msg) => console.log(msg));

// Hierarchical Coordinator
const coordinator = new HierarchicalCoordinator({
  maxWorkers: 5,
  sessionId: 'session-1'
});
await coordinator.initialize();
await coordinator.submitTask(task, 8);
const status = coordinator.getStatus();
await coordinator.shutdown();
```

### Workflows

```typescript
import { WorkflowRunner, getWorkflowRunner, runDocSync } from '@blackms/aistack';

// Get runner
const runner = getWorkflowRunner();

// Register phase executor
runner.registerPhase('inventory', async (context) => {
  // Phase logic
  return {
    phase: 'inventory',
    success: true,
    findings: [],
    artifacts: { files: ['file1.md'] },
    duration: 0
  };
});

// Run workflow
const report = await runner.run({
  id: 'my-workflow',
  name: 'My Workflow',
  phases: ['inventory', 'analysis', 'sync'],
  maxIterations: 3
});

// Events
runner.on('workflow:start', (config) => {});
runner.on('phase:complete', (result) => {});
runner.on('finding', (finding) => {});
runner.on('workflow:complete', (report) => {});

// Built-in doc sync
const report = await runDocSync('./docs', './src');
```

### Plugins

```typescript
import { loadPlugin, discoverPlugins, listPlugins, getPlugin } from '@blackms/aistack';

// Load single plugin
const plugin = await loadPlugin('./plugins/my-plugin', config);

// Discover all plugins in directory
const count = await discoverPlugins(config);

// List loaded plugins
const plugins = listPlugins();

// Get by name
const plugin = getPlugin('my-plugin');
```

### Hooks

```typescript
import { registerHook, executeHooks, registerWorkflowTrigger } from '@blackms/aistack';

// Register custom hook
// Note: handler receives three parameters: context, memory, and config
registerHook('post-task', async (context, memory, config) => {
  console.log('Task completed:', context.taskId);
  // Access memory manager and config as needed
});

// Register workflow trigger
registerWorkflowTrigger({
  id: 'auto-docs',
  name: 'Auto Docs Sync',
  condition: (context) => context.data?.docsChanged === true,
  workflowId: 'doc-sync',
  options: { maxIterations: 3 }
});

// Execute hooks (internal use)
await executeHooks('post-task', context, memory, config);
```

### MCP Server

```typescript
import { startMCPServer, MCPServer } from '@blackms/aistack';

// Start server
const server = await startMCPServer(config);

// Or create manually
const server = new MCPServer(config);
await server.start();

// Get tool info
const toolCount = server.getToolCount();
const toolNames = server.getToolNames();

// Stop
await server.stop();
```

### Resource Exhaustion Service

```typescript
import {
  getResourceExhaustionService,
  resetResourceExhaustionService
} from '@blackms/aistack';

// Get singleton (requires config.resourceExhaustion.enabled: true)
const service = getResourceExhaustionService(store, config.resourceExhaustion);

// Track operations
service.initializeAgent(agentId);
service.recordFileOperation(agentId, 'read');
service.recordApiCall(agentId, tokensConsumed);
service.recordSubtaskSpawn(agentId);

// Record deliverables (resets time-based tracking)
service.recordDeliverable(agentId, 'task_completed', 'Implemented feature X');

// Evaluate phase progression
const phase = service.evaluateAgent(agentId); // 'normal' | 'warning' | 'intervention' | 'termination'

// Control agents
await service.pauseAgent(agentId, 'Resource thresholds exceeded');
service.resumeAgent(agentId);
const isPaused = service.isAgentPaused(agentId);

// Get metrics
const metrics = service.getAgentMetrics(agentId);
const summary = service.getResourceMetrics();
const events = service.getRecentEvents(10);

// Lifecycle
service.start();  // Start background monitoring
service.stop();   // Stop background monitoring
service.cleanupAgent(agentId);

// Reset singleton (for testing)
resetResourceExhaustionService();
```

---

## CLI Commands

### `aistack init`

Initialize a new AgentStack project.

```bash
npx aistack init
npx aistack init --path ./myproject
```

Creates:
- `aistack.config.json`
- `data/` directory
- `plugins/` directory

### `aistack agent`

Agent management commands.

```bash
# Spawn agent
npx aistack agent spawn -t coder -n my-coder

# List agents
npx aistack agent list
npx aistack agent list --session session-1

# Stop agent
npx aistack agent stop -i <agent-id>
npx aistack agent stop -n my-coder

# Get agent status
npx aistack agent status -i <agent-id>
npx aistack agent status -n my-coder

# List available agent types
npx aistack agent types

# Run a task with a new agent (spawn + execute)
npx aistack agent run -t coder -p "Write a function to parse JSON"
npx aistack agent run -t reviewer -p @task.txt --context @code.ts --provider claude-code
npx aistack agent run -t architect -p "Design API" --provider gemini-cli --model gemini-2.0-flash

# Execute a task with an existing agent
npx aistack agent exec -i <agent-id> -p "Refactor this function"
npx aistack agent exec -n my-coder -p @task.txt --context @code.ts --provider anthropic
```

**Agent run/exec options**:
- `-t, --type <type>`: Agent type (required for `run`)
- `-p, --prompt <prompt>`: Task prompt (use `@file` to read from file)
- `-n, --name <name>`: Agent name
- `-i, --id <id>`: Agent ID (for `exec`)
- `--provider <provider>`: LLM provider (anthropic, openai, ollama, claude-code, gemini-cli, codex)
- `--model <model>`: Model to use
- `--context <context>`: Additional context (use `@file` to read from file)
- `--show-prompt`: Display agent system prompt before execution

```bash
# Watch agent activity (real-time monitoring)
npx aistack agent watch
npx aistack agent watch --interval 5
npx aistack agent watch --session session-1 --type coder
npx aistack agent watch --status running --json
npx aistack agent watch --no-clear
```

**Agent watch options**:
- `-i, --interval <seconds>`: Refresh interval in seconds (default: 2, minimum: 1)
- `-s, --session <id>`: Filter by session ID
- `-t, --type <type>`: Filter by agent type (coder, tester, etc.)
- `--status <status>`: Filter by status (idle, running, completed, failed, stopped)
- `--json`: Output as JSON snapshot (no watch mode)
- `--no-clear`: Do not clear screen between refreshes

**Example output**:
```
AISTACK Agent Monitor                                     Last updated: 14:32:45
═══════════════════════════════════════════════════════════════════════════════
Agents: 3 active (1 running, 1 idle, 1 completed)                     Limit: 10
───────────────────────────────────────────────────────────────────────────────
STATUS   NAME                 TYPE         UPTIME     TASK
● RUN    my-coder             coder        2m 15s     Processing...
○ IDLE   test-agent           tester       5m 30s     —
✓ DONE   code-reviewer        reviewer     10m 45s    Done
───────────────────────────────────────────────────────────────────────────────
Press Ctrl+C to exit
```

### `aistack memory`

Memory operations.

```bash
# Store
npx aistack memory store -k "pattern" -c "Use singleton for config"
npx aistack memory store -k "pattern" -c "content" -n architecture

# Search
npx aistack memory search -q "singleton"
npx aistack memory search -q "pattern" -n architecture -l 5
```

### `aistack mcp`

MCP server commands.

```bash
# Start server (for Claude Code integration)
npx aistack mcp start
```

### `aistack plugin`

Plugin management.

```bash
# Add plugin
npx aistack plugin add ./my-plugin

# List plugins
npx aistack plugin list

# Remove plugin
npx aistack plugin remove my-plugin
```

### `aistack status`

Show system status.

```bash
npx aistack status
```

### `aistack workflow`

Workflow commands.

```bash
# Run workflow
npx aistack workflow run doc-sync
npx aistack workflow run doc-sync --docs ./docs --src ./src
```

### Global Options

```bash
-v, --verbose    # Set log level to debug
-q, --quiet      # Set log level to error
```

---

## Error Handling

All MCP tools return errors in a consistent format:

```json
{
  "error": "Error message description"
}
```

Programmatic API methods may throw errors which should be caught:

```typescript
try {
  const agent = spawnAgent('unknown-type');
} catch (error) {
  console.error('Failed to spawn agent:', error.message);
}
```

---

## REST API

The web server provides REST API endpoints for the dashboard and external integrations.

### Identity REST API

Base path: `/api/v1/identities`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/identities` | Create new identity |
| `GET` | `/api/v1/identities` | List identities with filters |
| `GET` | `/api/v1/identities/:id` | Get identity by ID |
| `GET` | `/api/v1/identities/name/:name` | Get identity by display name |
| `PATCH` | `/api/v1/identities/:id` | Update identity metadata |
| `POST` | `/api/v1/identities/:id/activate` | Activate identity |
| `POST` | `/api/v1/identities/:id/deactivate` | Deactivate identity |
| `POST` | `/api/v1/identities/:id/retire` | Retire identity (permanent) |
| `GET` | `/api/v1/identities/:id/audit` | Get audit trail |

**Example: Create Identity**
```bash
curl -X POST http://localhost:3001/api/v1/identities \
  -H "Content-Type: application/json" \
  -d '{"agentType": "coder", "displayName": "My Coder", "autoActivate": true}'
```

**Example: List Active Identities**
```bash
curl "http://localhost:3001/api/v1/identities?status=active&limit=10"
```

### Other REST Endpoints

| Path Prefix | Description |
|-------------|-------------|
| `/api/v1/agents` | Agent management |
| `/api/v1/memory` | Memory operations |
| `/api/v1/tasks` | Task management |
| `/api/v1/sessions` | Session management |
| `/api/v1/system` | System status and health |
| `/api/v1/workflows` | Workflow operations |
| `/api/v1/projects` | Project management |
| `/api/v1/specifications` | Specification management |
| `/api/v1/review-loops` | Review loop management |
| `/api/v1/consensus` | Consensus checkpoint management |
| `/api/v1/auth` | Authentication |

### Consensus REST API

Base path: `/api/v1/consensus`

These endpoints require `consensus.enabled: true` in configuration.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/consensus/config` | Get consensus configuration |
| `GET` | `/api/v1/consensus/pending` | List pending checkpoints (paginated) |
| `POST` | `/api/v1/consensus/check` | Check if consensus is required |
| `POST` | `/api/v1/consensus/expire` | Manually expire old checkpoints |
| `GET` | `/api/v1/consensus/:id` | Get checkpoint details |
| `GET` | `/api/v1/consensus/:id/events` | Get checkpoint audit log |
| `PUT` | `/api/v1/consensus/:id/approve` | Approve a checkpoint |
| `PUT` | `/api/v1/consensus/:id/reject` | Reject a checkpoint |
| `POST` | `/api/v1/consensus/:id/start-review` | Start agent review |

**Example: Check if consensus required**
```bash
curl -X POST http://localhost:3001/api/v1/consensus/check \
  -H "Content-Type: application/json" \
  -d '{"agentType": "coder", "input": "Delete production database"}'
```

**Example: Approve a checkpoint**
```bash
curl -X PUT http://localhost:3001/api/v1/consensus/checkpoint-uuid/approve \
  -H "Content-Type: application/json" \
  -d '{"reviewedBy": "user-1", "feedback": "Looks good"}'
```

### Resource Exhaustion REST API

These endpoints require `resourceExhaustion.enabled: true` in configuration.

#### `GET /api/v1/agents/:id/resources`

Get resource metrics for an agent.

**Response**:
```json
{
  "agentId": "uuid-v4",
  "filesRead": 15,
  "filesWritten": 3,
  "filesModified": 2,
  "apiCallsCount": 25,
  "subtasksSpawned": 2,
  "tokensConsumed": 45000,
  "startedAt": "2024-01-01T00:00:00.000Z",
  "lastDeliverableAt": "2024-01-01T00:15:00.000Z",
  "lastActivityAt": "2024-01-01T00:20:00.000Z",
  "phase": "normal",
  "pausedAt": null,
  "pauseReason": null
}
```

---

#### `POST /api/v1/agents/:id/deliverable`

Record a deliverable checkpoint for an agent, resetting time-based tracking.

**Request Body**:
```json
{
  "type": "task_completed",
  "description": "Implemented user authentication",
  "artifacts": ["src/auth/login.ts", "src/auth/middleware.ts"]
}
```

**Valid deliverable types**: `task_completed`, `code_committed`, `tests_passed`, `user_checkpoint`, `artifact_produced`

**Response** (201):
```json
{
  "id": "uuid-v4",
  "agentId": "agent-uuid",
  "type": "task_completed",
  "description": "Implemented user authentication",
  "artifacts": ["src/auth/login.ts", "src/auth/middleware.ts"],
  "createdAt": "2024-01-01T00:15:00.000Z"
}
```

---

#### `POST /api/v1/agents/:id/pause`

Pause an agent's execution.

**Request Body**:
```json
{
  "reason": "Manual pause for review"
}
```

**Response**:
```json
{
  "paused": true,
  "reason": "Manual pause for review"
}
```

---

#### `POST /api/v1/agents/:id/resume`

Resume a paused agent.

**Response**:
```json
{
  "resumed": true
}
```

---

#### `GET /api/v1/system/resources`

Get resource exhaustion summary for all agents.

**Response**:
```json
{
  "enabled": true,
  "config": {
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
  "metrics": {
    "totalAgentsTracked": 5,
    "agentsByPhase": {
      "normal": 3,
      "warning": 1,
      "intervention": 1
    },
    "pausedAgents": 1,
    "totalWarnings": 10,
    "totalInterventions": 2,
    "totalTerminations": 0,
    "recentEvents": []
  }
}
```

---

## Related Documents

- [HLD.md](HLD.md) - High-level design
- [LLD.md](LLD.md) - Low-level design
- [DATA.md](DATA.md) - Data models
