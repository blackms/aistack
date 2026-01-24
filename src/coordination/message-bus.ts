/**
 * Message bus - EventEmitter-based inter-agent messaging
 */

import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';

const log = logger.child('bus');

export interface Message {
  id: string;
  from: string;
  to?: string; // undefined = broadcast
  type: string;
  payload: unknown;
  timestamp: Date;
}

export interface MessageBusEvents {
  'message': (message: Message) => void;
  'broadcast': (message: Message) => void;
  'direct': (message: Message) => void;
  'error': (error: Error, message?: Message) => void;
}

export class MessageBus extends EventEmitter {
  private messageCount = 0;
  private subscribers: Map<string, Set<(message: Message) => void>> = new Map();

  constructor() {
    super();
  }

  /**
   * Send a message to a specific agent
   */
  send(from: string, to: string, type: string, payload: unknown): Message {
    const message: Message = {
      id: `msg-${++this.messageCount}`,
      from,
      to,
      type,
      payload,
      timestamp: new Date(),
    };

    // Emit direct message event
    this.emit('direct', message);
    this.emit('message', message);

    // Notify direct subscribers
    const subs = this.subscribers.get(to);
    if (subs) {
      for (const callback of subs) {
        try {
          callback(message);
        } catch (error) {
          this.emit('error', error instanceof Error ? error : new Error(String(error)), message);
        }
      }
    }

    log.debug('Message sent', { id: message.id, from, to, type });
    return message;
  }

  /**
   * Broadcast a message to all agents
   */
  broadcast(from: string, type: string, payload: unknown): Message {
    const message: Message = {
      id: `msg-${++this.messageCount}`,
      from,
      type,
      payload,
      timestamp: new Date(),
    };

    // Emit broadcast event
    this.emit('broadcast', message);
    this.emit('message', message);

    // Notify all subscribers
    for (const subs of this.subscribers.values()) {
      for (const callback of subs) {
        try {
          callback(message);
        } catch (error) {
          this.emit('error', error instanceof Error ? error : new Error(String(error)), message);
        }
      }
    }

    log.debug('Message broadcast', { id: message.id, from, type });
    return message;
  }

  /**
   * Subscribe to messages for an agent
   */
  subscribe(agentId: string, callback: (message: Message) => void): () => void {
    let subs = this.subscribers.get(agentId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(agentId, subs);
    }
    subs.add(callback);

    log.debug('Agent subscribed', { agentId });

    // Return unsubscribe function
    return () => {
      subs?.delete(callback);
      if (subs?.size === 0) {
        this.subscribers.delete(agentId);
      }
    };
  }

  /**
   * Subscribe to all messages
   */
  subscribeAll(callback: (message: Message) => void): () => void {
    this.on('message', callback);
    return () => this.off('message', callback);
  }

  /**
   * Unsubscribe an agent
   */
  unsubscribe(agentId: string): boolean {
    const deleted = this.subscribers.delete(agentId);
    if (deleted) {
      log.debug('Agent unsubscribed', { agentId });
    }
    return deleted;
  }

  /**
   * Get subscriber count
   */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Get message count
   */
  getMessageCount(): number {
    return this.messageCount;
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.subscribers.clear();
    this.removeAllListeners();
    log.debug('Bus cleared');
  }
}

// Singleton instance
let busInstance: MessageBus | null = null;

/**
 * Get or create the message bus
 */
export function getMessageBus(): MessageBus {
  if (!busInstance) {
    busInstance = new MessageBus();
  }
  return busInstance;
}

/**
 * Reset the message bus
 */
export function resetMessageBus(): void {
  if (busInstance) {
    busInstance.clear();
    busInstance = null;
  }
}
