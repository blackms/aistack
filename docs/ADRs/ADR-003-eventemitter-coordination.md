# ADR-003: EventEmitter for Coordination

## Status

Accepted

## Context

AgentStack needs a mechanism for:
- Task lifecycle notifications (added, assigned, completed)
- Inter-agent communication (messages, broadcasts)
- Workflow progress tracking (phase start, findings, completion)
- Loose coupling between components

Requirements:
- Asynchronous notification delivery
- Multiple subscribers per event
- Type-safe event handling (TypeScript)
- Low overhead, no external dependencies

## Decision

Use Node.js built-in `EventEmitter` for all coordination and notification needs.

### Implementation Patterns

#### 1. Task Queue Events

```typescript
class TaskQueue extends EventEmitter {
  enqueue(task: Task, priority: number): void {
    // Add to queue
    this.emit('task:added', task);
  }

  complete(taskId: string): boolean {
    // Complete task
    this.emit('task:completed', taskId);
    if (this.isEmpty) {
      this.emit('queue:empty');
    }
  }
}
```

#### 2. Message Bus

```typescript
class MessageBus extends EventEmitter {
  private subscribers: Map<string, Set<(msg: Message) => void>> = new Map();

  send(from: string, to: string, type: string, payload: unknown): Message {
    const message = { id: this.nextId(), from, to, type, payload, timestamp: new Date() };

    // Notify specific subscriber
    const handlers = this.subscribers.get(to);
    handlers?.forEach(h => h(message));

    // Notify global listeners
    this.emit('message', message);

    return message;
  }

  subscribe(agentId: string, callback: (msg: Message) => void): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(callback);

    return () => this.subscribers.get(agentId)?.delete(callback);
  }
}
```

#### 3. Workflow Runner Events

```typescript
class WorkflowRunner extends EventEmitter {
  async run(config: WorkflowConfig): Promise<WorkflowReport> {
    this.emit('workflow:start', config);

    for (const phase of config.phases) {
      this.emit('phase:start', phase);
      const result = await this.executePhase(phase, context);

      for (const finding of result.findings) {
        this.emit('finding', finding);
      }

      this.emit('phase:complete', result);
    }

    this.emit('workflow:complete', report);
    return report;
  }
}
```

### Event Types

| Component | Events |
|-----------|--------|
| TaskQueue | `task:added`, `task:assigned`, `task:completed`, `queue:empty` |
| MessageBus | `message` (global) |
| WorkflowRunner | `workflow:start`, `workflow:complete`, `workflow:error`, `phase:start`, `phase:complete`, `finding` |

## Alternatives Considered

### 1. RxJS Observables

**Pros**: Rich operators, backpressure, type-safe
**Cons**: Large dependency, learning curve, complexity

### 2. Custom pub/sub implementation

**Pros**: Full control, tailored to needs
**Cons**: Reinventing the wheel, potential bugs

### 3. External message queue (Redis, RabbitMQ)

**Pros**: Distributed, persistent, scalable
**Cons**: External dependency, deployment complexity

### 4. Callbacks/Promises only

**Pros**: Simple, no events
**Cons**: One-to-one only, no broadcast capability

## Consequences

### Positive

- **Zero dependencies**: Uses Node.js built-in
- **Familiar API**: Standard EventEmitter pattern
- **Loose coupling**: Publishers don't know subscribers
- **Multiple subscribers**: Many listeners per event
- **Synchronous delivery**: Immediate notification

### Negative

- **Memory leaks**: Forgotten listeners accumulate
- **No backpressure**: Fast emitter can overwhelm slow consumer
- **Error handling**: Uncaught errors in listeners can crash
- **Type safety**: Event names and payloads not type-checked

### Mitigations

- Return unsubscribe functions from subscribe methods
- Document all events with their payloads
- Wrap listener calls in try-catch
- Use TypeScript interfaces for event maps (WorkflowEvents)

## Type Safety Approach

```typescript
// Define event interface
export interface WorkflowEvents {
  'workflow:start': (config: WorkflowConfig) => void;
  'workflow:complete': (report: WorkflowReport) => void;
  'workflow:error': (error: Error) => void;
  'phase:start': (phase: WorkflowPhase) => void;
  'phase:complete': (result: PhaseResult) => void;
  'finding': (finding: Finding) => void;
}

// Typed emit/on (runtime enforcement, not compile-time)
class WorkflowRunner extends EventEmitter {
  emit<K extends keyof WorkflowEvents>(
    event: K,
    ...args: Parameters<WorkflowEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
```

## References

- [Node.js EventEmitter documentation](https://nodejs.org/api/events.html)
- [src/coordination/task-queue.ts](../../src/coordination/task-queue.ts)
- [src/coordination/message-bus.ts](../../src/coordination/message-bus.ts)
- [src/workflows/runner.ts](../../src/workflows/runner.ts)
