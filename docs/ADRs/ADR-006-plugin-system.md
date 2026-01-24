# ADR-006: Plugin System Design

## Status

Accepted

## Context

AgentStack needs extensibility for:
- Custom agent types with specialized behaviors
- Additional MCP tools
- Lifecycle hooks for custom logic
- Alternative LLM providers

Requirements:
- Runtime loading without recompilation
- Clean extension points
- Minimal core footprint
- Safe isolation (within reason)

## Decision

Implement a plugin system with:
1. **ES Module loading**: Dynamic import of plugin packages
2. **Standard interface**: `AgentStackPlugin` contract
3. **Directory scanning**: Auto-discovery in plugins folder
4. **Explicit registration**: Plugins register their extensions

### Plugin Interface

```typescript
interface AgentStackPlugin {
  // Required
  name: string;
  version: string;

  // Optional metadata
  description?: string;

  // Extension points
  agents?: AgentDefinition[];      // Custom agent types
  tools?: MCPToolDefinition[];     // Additional MCP tools
  hooks?: HookDefinition[];        // Lifecycle hooks
  providers?: ProviderDefinition[]; // LLM providers

  // Lifecycle
  init?(config: AgentStackConfig): Promise<void>;
  cleanup?(): Promise<void>;
}
```

### Plugin Loading

```typescript
export async function loadPlugin(
  pluginPath: string,
  config: AgentStackConfig
): Promise<AgentStackPlugin | null> {
  try {
    // Dynamic import
    const module = await import(pluginPath);
    const plugin = module.default as AgentStackPlugin;

    // Validate required fields
    if (!plugin.name || !plugin.version) {
      log.warn('Invalid plugin: missing name or version');
      return null;
    }

    // Initialize
    if (plugin.init) {
      await plugin.init(config);
    }

    // Register agents
    if (plugin.agents) {
      for (const agent of plugin.agents) {
        registerAgent(agent);
      }
    }

    // Store in registry
    registerPluginEntry(plugin);

    return plugin;
  } catch (error) {
    log.error('Failed to load plugin', { path: pluginPath, error });
    return null;
  }
}
```

### Plugin Discovery

```typescript
export async function discoverPlugins(config: AgentStackConfig): Promise<number> {
  const pluginDir = config.plugins.directory;
  let loaded = 0;

  // Scan directory for package.json files
  const entries = await readdir(pluginDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pkgPath = join(pluginDir, entry.name, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const mainPath = join(pluginDir, entry.name, pkg.module || pkg.main);

        if (await loadPlugin(mainPath, config)) {
          loaded++;
        }
      }
    }
  }

  return loaded;
}
```

### Plugin Example

```typescript
// plugins/my-plugin/index.ts
import type { AgentStackPlugin, AgentDefinition } from '@blackms/aistack';

const customAgent: AgentDefinition = {
  type: 'my-custom-agent',
  name: 'My Custom Agent',
  description: 'Does custom things',
  systemPrompt: 'You are a custom agent...',
  capabilities: ['custom-capability']
};

const plugin: AgentStackPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom plugin',
  agents: [customAgent],

  async init(config) {
    console.log('Plugin initialized');
  },

  async cleanup() {
    console.log('Plugin cleanup');
  }
};

export default plugin;
```

## Alternatives Considered

### 1. Configuration-based extensions

**Pros**: No code, declarative
**Cons**: Limited flexibility, can't add behavior

### 2. Hooks-only system

**Pros**: Simple, safe
**Cons**: Can't add new agent types or tools

### 3. Subclassing core components

**Pros**: Full control
**Cons**: Tight coupling, breaking changes risk

### 4. Dependency injection framework

**Pros**: Clean architecture, testable
**Cons**: Complex, learning curve

## Consequences

### Positive

- **Extensibility**: Add agents, tools, hooks, providers
- **Isolation**: Plugins are separate packages
- **Discovery**: Auto-loading from directory
- **Lifecycle**: Init and cleanup hooks
- **Standard interface**: Clear contract

### Negative

- **Security risk**: Plugins run with full access
- **No sandbox**: Can access all Node.js APIs
- **Version conflicts**: Plugin dependencies may clash
- **Loading order**: Dependencies between plugins not handled

### Mitigations

- Document security considerations
- Recommend trusted plugin sources only
- Validate plugin structure on load
- Log all plugin operations

## Configuration

```json
{
  "plugins": {
    "enabled": true,
    "directory": "./plugins"
  }
}
```

## Plugin Registry

```typescript
interface PluginEntry {
  plugin: AgentStackPlugin;
  enabled: boolean;
  config: Record<string, unknown>;
}

const plugins: Map<string, PluginEntry> = new Map();

export function getPlugin(name: string): AgentStackPlugin | null {
  return plugins.get(name)?.plugin ?? null;
}

export function listPlugins(): AgentStackPlugin[] {
  return Array.from(plugins.values())
    .filter(e => e.enabled)
    .map(e => e.plugin);
}
```

## Extension Points

### Agents

```typescript
// Plugin provides
agents: [{ type: 'my-agent', ... }]

// System registers in agent registry
registerAgent(agentDefinition);
```

### Tools

```typescript
// Plugin provides
tools: [{
  name: 'my_tool',
  description: 'Does something',
  inputSchema: { ... },
  handler: async (params) => { ... }
}]

// System adds to MCP server
mcpServer.registerTool(tool);
```

### Hooks

```typescript
// Plugin provides
hooks: [{
  name: 'my-hook',
  event: 'post-task',
  handler: async (context) => { ... }
}]

// System calls during lifecycle
registerHook(hookDefinition);
```

### Providers

```typescript
// Plugin provides
providers: [{
  name: 'my-provider',
  factory: (config) => new MyProvider(config)
}]

// System registers in provider factory
registerProvider(name, provider);
```

## References

- [src/plugins/loader.ts](../../src/plugins/loader.ts)
- [src/plugins/registry.ts](../../src/plugins/registry.ts)
- [src/plugins/types.ts](../../src/plugins/types.ts)
