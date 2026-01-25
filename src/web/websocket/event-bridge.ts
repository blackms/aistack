/**
 * Event bridge - connects internal EventEmitters to WebSocket clients
 */

import { EventEmitter } from 'node:events';
import { logger } from '../../utils/logger.js';

const log = logger.child('web:events');

// Agent events emitter - used by routes to emit events
export const agentEvents = new EventEmitter();

// WebSocket event types
export interface AgentSpawnedEvent {
  id: string;
  type: string;
  name: string;
}

export interface AgentStoppedEvent {
  id: string;
}

export interface AgentStatusEvent {
  id: string;
  status: string;
}

export interface TaskCreatedEvent {
  task: unknown;
}

export interface TaskAssignedEvent {
  taskId: string;
  agentId: string;
}

export interface TaskCompletedEvent {
  taskId: string;
  result?: unknown;
}

export interface WorkflowStartEvent {
  workflowId: string;
  config: unknown;
}

export interface WorkflowPhaseEvent {
  workflowId: string;
  phase: string;
  status: string;
}

export interface WorkflowCompleteEvent {
  workflowId: string;
  report: unknown;
}

export interface WorkflowErrorEvent {
  workflowId: string;
  error: string;
}

export interface MessageReceivedEvent {
  from: string;
  to: string;
  content: string;
}

// Project events
export interface ProjectCreatedEvent {
  id: string;
  name: string;
  path: string;
}

export interface ProjectUpdatedEvent {
  id: string;
  changes: Record<string, unknown>;
}

export interface ProjectTaskCreatedEvent {
  projectId: string;
  taskId: string;
  title: string;
}

export interface ProjectTaskPhaseEvent {
  projectId: string;
  taskId: string;
  fromPhase: string;
  toPhase: string;
}

export interface SpecCreatedEvent {
  id: string;
  taskId: string;
  type: string;
  title: string;
}

export interface SpecStatusEvent {
  id: string;
  status: string;
  reviewedBy?: string;
}

export interface AgentProgressEvent {
  agentId: string;
  taskId: string;
  progress: number;
  message?: string;
}

// Event names
export type EventName =
  | 'agent:spawned'
  | 'agent:stopped'
  | 'agent:status'
  | 'agent:progress'
  | 'task:created'
  | 'task:assigned'
  | 'task:completed'
  | 'workflow:start'
  | 'workflow:phase'
  | 'workflow:complete'
  | 'workflow:error'
  | 'workflow:finding'
  | 'message:received'
  | 'project:created'
  | 'project:updated'
  | 'project:task:created'
  | 'project:task:phase'
  | 'spec:created'
  | 'spec:status';

// Event bridge class for managing WebSocket subscriptions
export class EventBridge {
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  constructor() {
    // Wire up all agent events to broadcast
    const events: EventName[] = [
      'agent:spawned',
      'agent:stopped',
      'agent:status',
      'agent:progress',
      'task:created',
      'task:assigned',
      'task:completed',
      'workflow:start',
      'workflow:phase',
      'workflow:complete',
      'workflow:error',
      'workflow:finding',
      'message:received',
      'project:created',
      'project:updated',
      'project:task:created',
      'project:task:phase',
      'spec:created',
      'spec:status',
    ];

    for (const event of events) {
      agentEvents.on(event, (data: unknown) => {
        this.broadcast(event, data);
      });
    }
  }

  /**
   * Subscribe to all events
   */
  subscribe(callback: (event: string, data: unknown) => void): () => void {
    const wrappedCallback = (data: unknown) => callback('*', data);

    // Subscribe to all events
    if (!this.listeners.has('*')) {
      this.listeners.set('*', new Set());
    }
    this.listeners.get('*')!.add(wrappedCallback);

    // Return unsubscribe function
    return () => {
      this.listeners.get('*')?.delete(wrappedCallback);
    };
  }

  /**
   * Subscribe to specific event
   */
  subscribeToEvent(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Broadcast event to all subscribers
   */
  broadcast(event: string, data: unknown): void {
    log.debug('Broadcasting event', { event });

    // Notify event-specific listeners
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(data);
        } catch (error) {
          log.error('Error in event listener', {
            event,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try {
          listener({ event, data });
        } catch (error) {
          log.error('Error in wildcard listener', {
            event,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }
  }

  /**
   * Get subscriber count for an event
   */
  getSubscriberCount(event?: string): number {
    if (event) {
      return this.listeners.get(event)?.size ?? 0;
    }

    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.size;
    }
    return total;
  }

  /**
   * Clear all listeners
   */
  clear(): void {
    this.listeners.clear();
  }
}

// Singleton instance
let eventBridge: EventBridge | null = null;

export function getEventBridge(): EventBridge {
  if (!eventBridge) {
    eventBridge = new EventBridge();
  }
  return eventBridge;
}

export function resetEventBridge(): void {
  if (eventBridge) {
    eventBridge.clear();
    eventBridge = null;
  }
}
