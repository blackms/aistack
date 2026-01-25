/**
 * Event bridge tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  agentEvents,
  EventBridge,
  getEventBridge,
  resetEventBridge,
} from '../../../src/web/websocket/event-bridge.js';

describe('Event Bridge', () => {
  let bridge: EventBridge;

  beforeEach(() => {
    resetEventBridge();
    bridge = getEventBridge();
  });

  afterEach(() => {
    resetEventBridge();
  });

  describe('getEventBridge', () => {
    it('should return singleton instance', () => {
      const bridge1 = getEventBridge();
      const bridge2 = getEventBridge();
      expect(bridge1).toBe(bridge2);
    });
  });

  describe('resetEventBridge', () => {
    it('should clear and reset the bridge', () => {
      const callback = vi.fn();
      bridge.subscribeToEvent('test', callback);
      expect(bridge.getSubscriberCount('test')).toBe(1);

      resetEventBridge();
      const newBridge = getEventBridge();

      expect(newBridge.getSubscriberCount('test')).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('should subscribe to all events', () => {
      const callback = vi.fn();
      bridge.subscribe(callback);

      bridge.broadcast('test:event', { data: 'test' });

      expect(callback).toHaveBeenCalledWith('*', expect.objectContaining({
        event: 'test:event',
        data: { data: 'test' },
      }));
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = bridge.subscribe(callback);

      unsubscribe();
      bridge.broadcast('test:event', { data: 'test' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('subscribeToEvent', () => {
    it('should subscribe to specific event', () => {
      const callback = vi.fn();
      bridge.subscribeToEvent('agent:spawned', callback);

      bridge.broadcast('agent:spawned', { id: '123' });

      expect(callback).toHaveBeenCalledWith({ id: '123' });
    });

    it('should not receive other events', () => {
      const callback = vi.fn();
      bridge.subscribeToEvent('agent:spawned', callback);

      bridge.broadcast('agent:stopped', { id: '123' });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = bridge.subscribeToEvent('test', callback);

      unsubscribe();
      bridge.broadcast('test', { data: 'test' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('broadcast', () => {
    it('should notify event-specific listeners', () => {
      const callback = vi.fn();
      bridge.subscribeToEvent('task:created', callback);

      bridge.broadcast('task:created', { task: { id: '1' } });

      expect(callback).toHaveBeenCalledWith({ task: { id: '1' } });
    });

    it('should notify wildcard listeners', () => {
      const callback = vi.fn();
      bridge.subscribe(callback);

      bridge.broadcast('workflow:start', { workflowId: 'wf-1' });

      expect(callback).toHaveBeenCalled();
    });

    it('should handle errors in listeners gracefully', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const normalCallback = vi.fn();

      bridge.subscribeToEvent('test', errorCallback);
      bridge.subscribeToEvent('test', normalCallback);

      // Should not throw
      expect(() => bridge.broadcast('test', {})).not.toThrow();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe('getSubscriberCount', () => {
    it('should return count for specific event', () => {
      bridge.subscribeToEvent('test', vi.fn());
      bridge.subscribeToEvent('test', vi.fn());
      bridge.subscribeToEvent('other', vi.fn());

      expect(bridge.getSubscriberCount('test')).toBe(2);
      expect(bridge.getSubscriberCount('other')).toBe(1);
    });

    it('should return 0 for unknown event', () => {
      expect(bridge.getSubscriberCount('unknown')).toBe(0);
    });

    it('should return total count when no event specified', () => {
      bridge.subscribeToEvent('test1', vi.fn());
      bridge.subscribeToEvent('test2', vi.fn());
      bridge.subscribeToEvent('test2', vi.fn());

      expect(bridge.getSubscriberCount()).toBe(3);
    });
  });

  describe('clear', () => {
    it('should remove all listeners', () => {
      bridge.subscribeToEvent('test1', vi.fn());
      bridge.subscribeToEvent('test2', vi.fn());
      bridge.subscribe(vi.fn());

      bridge.clear();

      expect(bridge.getSubscriberCount()).toBe(0);
    });
  });
});

describe('agentEvents', () => {
  beforeEach(() => {
    resetEventBridge();
  });

  afterEach(() => {
    agentEvents.removeAllListeners();
  });

  it('should emit agent:spawned events to bridge', () => {
    const bridge = getEventBridge();
    const callback = vi.fn();
    bridge.subscribeToEvent('agent:spawned', callback);

    agentEvents.emit('agent:spawned', { id: '123', type: 'coder', name: 'test' });

    expect(callback).toHaveBeenCalledWith({ id: '123', type: 'coder', name: 'test' });
  });

  it('should emit agent:stopped events to bridge', () => {
    const bridge = getEventBridge();
    const callback = vi.fn();
    bridge.subscribeToEvent('agent:stopped', callback);

    agentEvents.emit('agent:stopped', { id: '123' });

    expect(callback).toHaveBeenCalledWith({ id: '123' });
  });

  it('should emit agent:status events to bridge', () => {
    const bridge = getEventBridge();
    const callback = vi.fn();
    bridge.subscribeToEvent('agent:status', callback);

    agentEvents.emit('agent:status', { id: '123', status: 'running' });

    expect(callback).toHaveBeenCalledWith({ id: '123', status: 'running' });
  });

  it('should emit task:created events to bridge', () => {
    const bridge = getEventBridge();
    const callback = vi.fn();
    bridge.subscribeToEvent('task:created', callback);

    agentEvents.emit('task:created', { task: { id: 't1' } });

    expect(callback).toHaveBeenCalledWith({ task: { id: 't1' } });
  });

  it('should emit workflow:start events to bridge', () => {
    const bridge = getEventBridge();
    const callback = vi.fn();
    bridge.subscribeToEvent('workflow:start', callback);

    agentEvents.emit('workflow:start', { workflowId: 'wf-1' });

    expect(callback).toHaveBeenCalledWith({ workflowId: 'wf-1' });
  });

  it('should emit message:received events to bridge', () => {
    const bridge = getEventBridge();
    const callback = vi.fn();
    bridge.subscribeToEvent('message:received', callback);

    agentEvents.emit('message:received', { from: 'user', to: 'agent', content: 'hello' });

    expect(callback).toHaveBeenCalledWith({ from: 'user', to: 'agent', content: 'hello' });
  });
});
