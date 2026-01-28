# Security Considerations

> Security practices, threat model, and mitigation strategies

## Overview

AgentStack handles sensitive data including API keys, user content, and system operations. This document outlines security considerations and best practices.

## Threat Model

### Assets

| Asset | Sensitivity | Description |
|-------|-------------|-------------|
| API Keys | Critical | LLM provider credentials |
| Memory Content | High | User-stored data and context |
| Configuration | Medium | System settings and paths |
| Embeddings | Medium | Vector representations of content |
| Task Data | Medium | Task inputs and outputs |

### Threat Actors

1. **Malicious Plugins**: Untrusted code loaded at runtime
2. **Prompt Injection**: Malicious content in stored memory
3. **Local Attacker**: Access to filesystem or database
4. **Network Attacker**: Interception of API calls

## Security Controls

### API Key Management

**Current Implementation**:
- API keys read from config file or environment variables
- Environment variable interpolation: `${ANTHROPIC_API_KEY}`
- Keys passed directly to provider constructors

**Best Practices**:
```bash
# Use environment variables (recommended)
export ANTHROPIC_API_KEY="sk-..."
export OPENAI_API_KEY="sk-..."

# Config file references env vars
{
  "providers": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

**Recommendations**:
- Never commit API keys to version control
- Use environment variables in production
- Rotate keys periodically
- Use scoped/limited API keys when possible

### Database Security

**SQLite Implementation**:
- Embedded database (no network exposure)
- File-based storage (filesystem permissions apply)
- Parameterized queries prevent SQL injection

**Input Validation**:
```typescript
// Zod validation for all inputs
const schema = z.object({
  key: z.string().min(1).max(255),
  content: z.string().max(1_000_000),
  namespace: z.string().max(100).optional()
});
```

**FTS5 Query Escaping**:
```typescript
function escapeFtsQuery(query: string): string {
  // Escape special characters to prevent FTS injection
  return query.replace(/["'*()-:]/g, char => `"${char}"`);
}
```

### Plugin Security

**Risks**:
- Plugins execute arbitrary code
- Access to all exports and APIs
- No sandboxing

**Current Mitigations**:
- Manual plugin installation required
- Plugin validation on load
- Plugin registry tracking

**Recommendations**:
1. Only install plugins from trusted sources
2. Review plugin code before installation
3. Use separate environments for untrusted plugins
4. Monitor plugin behavior

### GitHub Integration

**Implementation**:
- Uses `gh` CLI (requires pre-authentication)
- Subprocess execution with timeout
- No direct token handling in most cases

**Subprocess Security**:
```typescript
// Proper argument handling (no shell injection)
execFileSync('gh', ['issue', 'create', '--title', title], {
  timeout: 30000,
  encoding: 'utf-8'
});
```

**Risks**:
- Authenticated gh CLI has repository access
- Commands could be influenced by user input

**Mitigations**:
- Input validation before gh commands
- Timeout on all subprocess calls
- No shell interpolation (execFileSync)

### Session-Based Memory Isolation

**Purpose**: Prevent agents in different sessions from accessing each other's memory (cross-session contamination).

**Implementation** (v1.5.2+):
- Each session gets a dedicated namespace: `session:{sessionId}`
- Memory operations are scoped to the caller's session
- Cross-session access attempts are blocked and logged
- `sessionId` is required for all write/delete operations

**Access Control** (`src/memory/access-control.ts`):
```typescript
// Validate that memory operations stay within session boundaries
validateAccess(context: MemoryAccessContext, namespace: string, operation: 'read'|'write'|'delete'): void

// Check if context can access a specific entry
canAccessEntry(context: MemoryAccessContext, entryNamespace: string, entryAgentId?: string): boolean
```

**Session Cleanup**:
- When a session ends, all session-scoped memory is automatically deleted
- Agents in the session are stopped
- Audit logging tracks cleanup operations

**REST API Protection**:
- `POST /api/v1/memory` requires `sessionId` for write operations
- `DELETE /api/v1/memory/:key` requires `sessionId` for delete operations
- Read operations can optionally filter by session

### MCP Protocol Security

**Transport**:
- stdio transport (no network exposure)
- Process-level isolation from client

**Input Validation**:
- All tool inputs validated with Zod schemas
- Unknown tools return error

**Output Handling**:
- JSON serialization of results
- Error messages sanitized

## Security Best Practices

### Configuration

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "github": {
    "enabled": false
  },
  "plugins": {
    "enabled": false
  }
}
```

1. **Disable unused features**: Set `github.enabled` and `plugins.enabled` to false if not needed
2. **Use environment variables**: Never hardcode API keys
3. **Restrict file permissions**: `chmod 600 aistack.config.json`

### Deployment

1. **Filesystem**:
   ```bash
   # Secure config file
   chmod 600 aistack.config.json

   # Secure database
   chmod 600 ./data/aistack.db
   ```

2. **Process Isolation**:
   - Run as non-root user
   - Use container isolation if possible

3. **Network**:
   - AgentStack makes outbound HTTPS calls to:
     - `api.anthropic.com`
     - `api.openai.com`
     - `localhost:11434` (Ollama, if enabled)
   - No inbound connections (stdio transport)

### Monitoring

**Logging**:
- All tool calls logged
- Errors logged with context
- API keys truncated in logs

**What to Monitor**:
- Unusual API call patterns
- Failed authentication attempts
- Plugin load events
- Error rates

## Known Limitations

### No Encryption at Rest

- SQLite database is unencrypted
- Embeddings stored as plaintext BLOBs
- Mitigation: Use filesystem encryption

### Session-Level Access Control Only

- Session-based memory isolation prevents cross-session contamination (v1.5.2+)
- All MCP tools available to any MCP client (no per-tool ACLs)
- No user authentication at the protocol level
- Mitigation: Process-level access control, session-based isolation

### Plugin Trust

- No code signing or verification
- Full API access
- Mitigation: Manual review and trusted sources

### Memory Content

- Stored content could contain sensitive data
- No automatic PII detection
- Mitigation: User responsibility for content

## Security Checklist

### Before Deployment

- [ ] API keys in environment variables
- [ ] Config file permissions restricted
- [ ] Database file permissions restricted
- [ ] Unused features disabled
- [ ] Plugins reviewed (if enabled)

### Ongoing

- [ ] API keys rotated periodically
- [ ] Logs reviewed for anomalies
- [ ] Dependencies updated
- [ ] Database backed up securely

### Incident Response

1. **API Key Compromise**:
   - Immediately rotate affected keys
   - Review API usage logs
   - Update configuration

2. **Database Exposure**:
   - Assess data sensitivity
   - Consider re-encryption
   - Review access logs

3. **Plugin Vulnerability**:
   - Disable affected plugin
   - Review plugin actions
   - Update or remove plugin

## Vulnerability Reporting

Report security issues to the repository maintainers via:
- GitHub Security Advisories
- Private disclosure to maintainers

## Related Documents

- [OPERATIONS.md](OPERATIONS.md) - Operational security
- [DATA.md](DATA.md) - Data storage details
- [API.md](API.md) - Input validation details
