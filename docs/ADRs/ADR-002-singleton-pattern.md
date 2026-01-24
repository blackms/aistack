# ADR-002: Singleton Pattern for Global State

## Status

Accepted

## Context

AgentStack has several components that need application-wide shared state:
- Configuration (loaded once, used everywhere)
- Memory Manager (single database connection)
- Message Bus (central pub/sub for agents)
- Workflow Runner (single orchestrator)

The challenge is providing easy access to these components while avoiding:
- Excessive parameter passing
- Complex dependency injection
- Multiple instances causing conflicts

## Decision

Use the singleton pattern with lazy initialization for global state components.

### Implementation Pattern

```typescript
// Singleton instance
let instance: Component | null = null;

// Getter with lazy initialization
export function getInstance(): Component {
  if (!instance) {
    instance = new Component();
  }
  return instance;
}

// Reset for testing
export function resetInstance(): void {
  instance = null;
}
```

### Components Using Singleton

| Component | Getter | Reset |
|-----------|--------|-------|
| Config | `getConfig()` | `resetConfig()` |
| Memory Manager | `getMemoryManager()` | `resetMemoryManager()` |
| Message Bus | `getMessageBus()` | `resetMessageBus()` |
| Workflow Runner | `getWorkflowRunner()` | `resetWorkflowRunner()` |

### Components NOT Using Singleton

| Component | Reason |
|-----------|--------|
| TaskQueue | One per coordinator instance |
| HierarchicalCoordinator | Multiple can exist |
| LLM Providers | Multiple with different configs |
| Spawned Agents | Multiple instances by design |

## Alternatives Considered

### 1. Dependency Injection Container

**Pros**: Explicit dependencies, testable, flexible
**Cons**: Complex setup, learning curve, overkill for this scope

### 2. Module-level constants

**Pros**: Very simple
**Cons**: No reset capability, initialization order issues

### 3. Context object passed everywhere

**Pros**: Explicit, no global state
**Cons**: Verbose, every function needs context parameter

### 4. Service locator pattern

**Pros**: Centralized, flexible
**Cons**: Hidden dependencies, anti-pattern concerns

## Consequences

### Positive

- **Simple access**: `getConfig()` anywhere in codebase
- **Lazy initialization**: Only created when needed
- **Testability**: `resetConfig()` for test isolation
- **Single source of truth**: Guaranteed single instance
- **Reduced boilerplate**: No parameter threading

### Negative

- **Hidden dependencies**: Not visible in function signatures
- **Testing requires reset**: Must call reset between tests
- **Initialization order**: First access determines config
- **Not suitable for all components**: Task queues need multiple instances

### Mitigations

- Document which components are singletons
- Provide reset functions for all singletons
- Use explicit instances where multiple are needed
- Keep singleton responsibilities focused

## Code Examples

### Configuration Singleton

```typescript
// src/utils/config.ts
let cachedConfig: AgentStackConfig | null = null;

export function getConfig(): AgentStackConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
```

### Memory Manager Singleton

```typescript
// src/memory/index.ts
let memoryInstance: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
  if (!memoryInstance) {
    const config = getConfig();
    memoryInstance = new MemoryManager(config);
  }
  return memoryInstance;
}

export function resetMemoryManager(): void {
  if (memoryInstance) {
    memoryInstance.close();
    memoryInstance = null;
  }
}
```

### Test Isolation

```typescript
// tests/unit/example.test.ts
import { beforeEach, afterEach } from 'vitest';
import { resetConfig, resetMemoryManager } from '../src';

beforeEach(() => {
  resetConfig();
  resetMemoryManager();
});

afterEach(() => {
  resetMemoryManager();
});
```

## References

- [src/utils/config.ts](../../src/utils/config.ts)
- [src/memory/index.ts](../../src/memory/index.ts)
- [src/coordination/message-bus.ts](../../src/coordination/message-bus.ts)
