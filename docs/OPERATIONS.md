# Operations Guide

> Deployment, monitoring, troubleshooting, and runbooks

## Deployment

### Prerequisites

- Node.js 20.0.0 or higher
- npm or yarn package manager
- Optional: GitHub CLI (`gh`) for GitHub features
- Optional: Ollama for local LLM inference

### Installation Methods

#### NPM Global Install

```bash
npm install -g @blackms/aistack
```

#### NPM Local Install

```bash
npm install @blackms/aistack
```

#### From Source

```bash
git clone https://github.com/blackms/aistack.git
cd aistack
npm install
npm run build
```

### Initialization

```bash
# Create new project
npx aistack init

# With custom path
npx aistack init --path ./my-project
```

This creates:
```
./
├── aistack.config.json    # Configuration
├── data/                  # Database directory
└── plugins/               # Plugin directory
```

### Configuration

#### Minimal Configuration

```json
{
  "version": "1.0.0",
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

#### Full Configuration

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
  "agents": {
    "maxConcurrent": 5,
    "defaultTimeout": 300
  },
  "github": {
    "enabled": true,
    "useGhCli": true
  },
  "plugins": {
    "enabled": true,
    "directory": "./plugins"
  },
  "mcp": {
    "transport": "stdio"
  },
  "hooks": {
    "sessionStart": true,
    "sessionEnd": true,
    "preTask": true,
    "postTask": true
  }
}
```

### Claude Code Integration

Add AgentStack as an MCP server:

```bash
claude mcp add agentstack -- npx @blackms/aistack mcp start
```

Or manually edit Claude Code settings:

```json
{
  "mcpServers": {
    "agentstack": {
      "command": "npx",
      "args": ["@blackms/aistack", "mcp", "start"]
    }
  }
}
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | If using Anthropic |
| `OPENAI_API_KEY` | OpenAI API key | If using OpenAI/embeddings |
| `GITHUB_TOKEN` | GitHub token | If not using gh CLI |

## CLI Providers

AgentStack supports CLI-based providers for agent execution:

| Provider | CLI Tool | Installation |
|----------|----------|--------------|
| Claude Code | `claude` | `npm install -g @anthropic-ai/claude-code` |
| Gemini CLI | `gemini` | `pip install google-generativeai` |
| Codex | `codex` | Install from Codex repository |

Verify CLI provider availability:
```bash
# Check Claude Code
claude --version

# Check Gemini CLI
gemini --version

# Check Codex
codex --version
```

## Monitoring

### System Status

```bash
# CLI status check
npx aistack status
```

**Output**:
```
AgentStack Status
─────────────────
Agents: 3 active (1 idle, 2 running)
Memory: 150 entries in 2 namespaces
Tasks: 5 pending, 2 processing
Health: All systems operational
```

### MCP Tool: system_status

Returns JSON with current metrics:

```json
{
  "agents": {
    "active": 3,
    "byStatus": { "idle": 1, "running": 2 }
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

### MCP Tool: system_health

Health check with component status:

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

### Logging

Set log level via CLI:

```bash
# Debug logging
npx aistack -v mcp start

# Quiet (errors only)
npx aistack -q mcp start
```

Log levels: `debug` < `info` < `warn` < `error`

### Log Output Format

```
[2024-01-01T00:00:00.000Z] [INFO] [mcp] Registered MCP tools {"count":30}
[2024-01-01T00:00:01.000Z] [DEBUG] [mcp] Calling tool {"name":"agent_spawn","args":{...}}
```

## Troubleshooting

### Common Issues

#### MCP Server Won't Start

**Symptoms**: Claude Code shows "server unavailable"

**Diagnosis**:
```bash
# Test server directly
npx aistack mcp start
```

**Solutions**:
1. Check Node.js version: `node --version` (must be >= 20)
2. Verify config file exists and is valid JSON
3. Check file permissions on config and data directory

#### Database Errors

**Symptoms**: "SQLITE_ERROR" or "database locked"

**Diagnosis**:
```bash
# Check database integrity
sqlite3 ./data/aistack.db "PRAGMA integrity_check"
```

**Solutions**:
1. Ensure only one process accesses database
2. Check disk space
3. Restore from backup if corrupted

#### API Key Errors

**Symptoms**: "Unauthorized" or "Invalid API key"

**Diagnosis**:
```bash
# Check environment variable
echo $ANTHROPIC_API_KEY
```

**Solutions**:
1. Verify API key is set correctly
2. Check config file interpolation syntax: `${VAR_NAME}`
3. Test API key directly with curl

#### Vector Search Not Working

**Symptoms**: Search returns only FTS results

**Diagnosis**:
```bash
# Check config
cat aistack.config.json | grep vectorSearch
```

**Solutions**:
1. Ensure `vectorSearch.enabled: true`
2. Verify embedding provider API key
3. Check entries have embeddings: `SELECT COUNT(*) FROM memory WHERE embedding IS NOT NULL`

#### GitHub Integration Fails

**Symptoms**: GitHub tools return errors

**Diagnosis**:
```bash
# Check gh CLI
gh auth status
```

**Solutions**:
1. Authenticate gh CLI: `gh auth login`
2. Verify GitHub config: `github.enabled: true, useGhCli: true`
3. Check repository permissions

### Debug Mode

Enable detailed logging:

```bash
# Via CLI
npx aistack -v mcp start

# Via environment
DEBUG=* npx aistack mcp start
```

### Reset State

```bash
# Clear database (WARNING: deletes all data)
rm ./data/aistack.db

# Reinitialize
npx aistack init
```

## Backup & Recovery

### Database Backup

```bash
# SQLite backup command
sqlite3 ./data/aistack.db ".backup './backups/aistack-$(date +%Y%m%d).db'"

# Or simple copy (when server stopped)
cp ./data/aistack.db ./backups/
```

### Automated Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="./backups"
DB_PATH="./data/aistack.db"
RETENTION_DAYS=7

# Create backup
mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/aistack-$(date +%Y%m%d-%H%M%S).db'"

# Clean old backups
find "$BACKUP_DIR" -name "aistack-*.db" -mtime +$RETENTION_DAYS -delete
```

### Recovery

```bash
# Stop server first

# Restore from backup
cp ./backups/aistack-20240101.db ./data/aistack.db

# Restart server
```

## Performance Tuning

### Memory Configuration

For large datasets, adjust SQLite pragmas:

```typescript
// In custom initialization
db.pragma('cache_size = -64000');  // 64MB cache
db.pragma('mmap_size = 268435456'); // 256MB mmap
```

### Agent Limits

```json
{
  "agents": {
    "maxConcurrent": 10,      // Increase for parallel work
    "defaultTimeout": 600     // Increase for long tasks
  }
}
```

### Vector Search

For better vector search performance:

1. Use `text-embedding-3-small` (faster, 1536 dims)
2. Limit search to specific namespaces
3. Batch embedding generation

## Runbooks

### Runbook: Server Restart

1. Check current status: `npx aistack status`
2. Stop server (if running as daemon)
3. Clear any stale locks: `rm ./data/*.lock`
4. Start server: `npx aistack mcp start`
5. Verify health: Use `system_health` tool

### Runbook: Database Migration

1. Backup current database
2. Stop server
3. Run migration SQL if needed
4. Update config version
5. Start server
6. Verify data integrity

### Runbook: API Key Rotation

1. Generate new API key from provider
2. Update environment variable
3. Restart server
4. Verify functionality
5. Revoke old key

### Runbook: Plugin Installation

1. Review plugin source code
2. Copy to plugins directory
3. Restart server (auto-discovery)
4. Verify plugin loaded: Check logs
5. Test plugin functionality

### Runbook: Capacity Planning

**Estimate storage needs**:
- Memory entries: ~1KB per entry (without embeddings)
- Embeddings: +6KB per entry (1536 dims)
- FTS index: ~20% of content size

**Estimate API costs**:
- Embeddings: ~$0.02 per 1M tokens
- Chat: Varies by model and usage

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist ./dist
COPY templates ./templates

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["mcp", "start"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  agentstack:
    build: .
    volumes:
      - ./data:/app/data
      - ./aistack.config.json:/app/aistack.config.json:ro
    environment:
      - ANTHROPIC_API_KEY
      - OPENAI_API_KEY
    stdin_open: true
    tty: true
```

## Related Documents

- [SECURITY.md](SECURITY.md) - Security considerations
- [DATA.md](DATA.md) - Database schema details
- [API.md](API.md) - Tool reference
