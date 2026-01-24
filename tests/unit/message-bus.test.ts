/**
 * Message bus tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MessageBus,
  getMessageBus,
  resetMessageBus,
  type Message,
} from '../../src/coordination/message-bus.js';

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('send', () => {
    it('should send a message to a specific agent', () => {
      const message = bus.send('agent-1', 'agent-2', 'task', { action: 'test' });

      expect(message.id).toBeDefined();
      expect(message.from).toBe('agent-1');
      expect(message.to).toBe('agent-2');
      expect(message.type).toBe('task');
      expect(message.payload).toEqual({ action: 'test' });
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it('should increment message count', () => {
      bus.send('a', 'b', 'type', {});
      bus.send('a', 'b', 'type', {});

      expect(bus.getMessageCount()).toBe(2);
    });

    it('should emit direct and message events', () => {
      const directHandler = vi.fn();
      const messageHandler = vi.fn();

      bus.on('direct', directHandler);
      bus.on('message', messageHandler);

      bus.send('agent-1', 'agent-2', 'test', {});

      expect(directHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler).toHaveBeenCalledTimes(1);
    });

    it('should notify direct subscribers', () => {
      const subscriber = vi.fn();
      bus.subscribe('agent-2', subscriber);

      bus.send('agent-1', 'agent-2', 'test', { data: 'value' });

      expect(subscriber).toHaveBeenCalledTimes(1);
      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'agent-1',
          to: 'agent-2',
          type: 'test',
        })
      );
    });

    it('should not notify other subscribers', () => {
      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();

      bus.subscribe('agent-2', subscriber1);
      bus.subscribe('agent-3', subscriber2);

      bus.send('agent-1', 'agent-2', 'test', {});

      expect(subscriber1).toHaveBeenCalledTimes(1);
      expect(subscriber2).not.toHaveBeenCalled();
    });

    it('should emit error event on subscriber exception', () => {
      const errorHandler = vi.fn();
      bus.on('error', errorHandler);

      bus.subscribe('agent-2', () => {
        throw new Error('Subscriber failed');
      });

      bus.send('agent-1', 'agent-2', 'test', {});

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ type: 'test' })
      );
    });
  });

  describe('broadcast', () => {
    it('should broadcast a message', () => {
      const message = bus.broadcast('agent-1', 'announce', { info: 'test' });

      expect(message.id).toBeDefined();
      expect(message.from).toBe('agent-1');
      expect(message.to).toBeUndefined();
      expect(message.type).toBe('announce');
    });

    it('should emit broadcast and message events', () => {
      const broadcastHandler = vi.fn();
      const messageHandler = vi.fn();

      bus.on('broadcast', broadcastHandler);
      bus.on('message', messageHandler);

      bus.broadcast('agent-1', 'test', {});

      expect(broadcastHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler).toHaveBeenCalledTimes(1);
    });

    it('should notify all subscribers', () => {
      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();
      const subscriber3 = vi.fn();

      bus.subscribe('agent-1', subscriber1);
      bus.subscribe('agent-2', subscriber2);
      bus.subscribe('agent-3', subscriber3);

      bus.broadcast('coordinator', 'sync', { timestamp: Date.now() });

      expect(subscriber1).toHaveBeenCalledTimes(1);
      expect(subscriber2).toHaveBeenCalledTimes(1);
      expect(subscriber3).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribe', () => {
    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = bus.subscribe('agent-1', callback);

      bus.send('other', 'agent-1', 'test', {});
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      bus.send('other', 'agent-1', 'test', {});
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should allow multiple subscriptions for same agent', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.subscribe('agent-1', callback1);
      bus.subscribe('agent-1', callback2);

      bus.send('other', 'agent-1', 'test', {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should increase subscriber count', () => {
      expect(bus.getSubscriberCount()).toBe(0);

      bus.subscribe('agent-1', () => {});
      expect(bus.getSubscriberCount()).toBe(1);

      bus.subscribe('agent-2', () => {});
      expect(bus.getSubscriberCount()).toBe(2);
    });
  });

  describe('subscribeAll', () => {
    it('should receive all messages', () => {
      const callback = vi.fn();
      bus.subscribeAll(callback);

      bus.send('a', 'b', 'direct', {});
      bus.broadcast('a', 'broadcast', {});

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = bus.subscribeAll(callback);

      bus.send('a', 'b', 'test', {});
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      bus.send('a', 'b', 'test', {});
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('should remove all subscriptions for agent', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.subscribe('agent-1', callback1);
      bus.subscribe('agent-1', callback2);

      const result = bus.unsubscribe('agent-1');
      expect(result).toBe(true);

      bus.send('other', 'agent-1', 'test', {});
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it('should return false for non-existent subscription', () => {
      const result = bus.unsubscribe('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getSubscriberCount', () => {
    it('should return 0 initially', () => {
      expect(bus.getSubscriberCount()).toBe(0);
    });

    it('should track subscriber count', () => {
      bus.subscribe('a', () => {});
      bus.subscribe('b', () => {});
      bus.subscribe('c', () => {});

      expect(bus.getSubscriberCount()).toBe(3);

      bus.unsubscribe('a');
      expect(bus.getSubscriberCount()).toBe(2);
    });
  });

  describe('getMessageCount', () => {
    it('should return 0 initially', () => {
      expect(bus.getMessageCount()).toBe(0);
    });

    it('should count all messages', () => {
      bus.send('a', 'b', 'test', {});
      bus.send('a', 'c', 'test', {});
      bus.broadcast('a', 'announce', {});

      expect(bus.getMessageCount()).toBe(3);
    });
  });

  describe('clear', () => {
    it('should clear all subscriptions', () => {
      bus.subscribe('a', () => {});
      bus.subscribe('b', () => {});

      bus.clear();

      expect(bus.getSubscriberCount()).toBe(0);
    });

    it('should remove all event listeners', () => {
      bus.on('message', () => {});
      bus.on('broadcast', () => {});

      bus.clear();

      expect(bus.listenerCount('message')).toBe(0);
      expect(bus.listenerCount('broadcast')).toBe(0);
    });
  });
});

describe('Message Bus Singleton', () => {
  beforeEach(() => {
    resetMessageBus();
  });

  describe('getMessageBus', () => {
    it('should return same instance', () => {
      const bus1 = getMessageBus();
      const bus2 = getMessageBus();

      expect(bus1).toBe(bus2);
    });
  });

  describe('resetMessageBus', () => {
    it('should create new instance after reset', () => {
      const bus1 = getMessageBus();
      bus1.send('a', 'b', 'test', {});

      resetMessageBus();

      const bus2 = getMessageBus();
      expect(bus2.getMessageCount()).toBe(0);
    });
  });
});
