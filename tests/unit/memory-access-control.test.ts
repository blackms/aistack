/**
 * Memory Access Control tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MemoryAccessControl,
  getAccessControl,
  resetAccessControl,
} from '../../src/memory/access-control.js';

describe('MemoryAccessControl', () => {
  let accessControl: MemoryAccessControl;

  beforeEach(() => {
    resetAccessControl();
    accessControl = getAccessControl();
  });

  afterEach(() => {
    resetAccessControl();
  });

  describe('getSessionNamespace', () => {
    it('should generate session namespace from session ID', () => {
      const sessionId = 'abc-123-def';
      const namespace = accessControl.getSessionNamespace(sessionId);
      expect(namespace).toBe('session:abc-123-def');
    });

    it('should throw error when sessionId is empty', () => {
      expect(() => accessControl.getSessionNamespace('')).toThrow('sessionId is required');
    });
  });

  describe('isSessionNamespace', () => {
    it('should return true for session namespaces', () => {
      expect(accessControl.isSessionNamespace('session:abc-123')).toBe(true);
    });

    it('should return false for non-session namespaces', () => {
      expect(accessControl.isSessionNamespace('default')).toBe(false);
      expect(accessControl.isSessionNamespace('my-namespace')).toBe(false);
      expect(accessControl.isSessionNamespace('sessions')).toBe(false);
    });
  });

  describe('extractSessionId', () => {
    it('should extract session ID from session namespace', () => {
      expect(accessControl.extractSessionId('session:abc-123')).toBe('abc-123');
    });

    it('should return null for non-session namespaces', () => {
      expect(accessControl.extractSessionId('default')).toBeNull();
      expect(accessControl.extractSessionId('my-namespace')).toBeNull();
    });
  });

  describe('validateAccess', () => {
    it('should allow access to own session namespace', () => {
      const context = { sessionId: 'session-a' };
      const namespace = 'session:session-a';

      expect(() => {
        accessControl.validateAccess(context, namespace, 'read');
      }).not.toThrow();

      expect(() => {
        accessControl.validateAccess(context, namespace, 'write');
      }).not.toThrow();

      expect(() => {
        accessControl.validateAccess(context, namespace, 'delete');
      }).not.toThrow();
    });

    it('should deny access to other session namespace', () => {
      const context = { sessionId: 'session-a' };
      const namespace = 'session:session-b';

      expect(() => {
        accessControl.validateAccess(context, namespace, 'read');
      }).toThrow('Access denied');

      expect(() => {
        accessControl.validateAccess(context, namespace, 'write');
      }).toThrow('Access denied');

      expect(() => {
        accessControl.validateAccess(context, namespace, 'delete');
      }).toThrow('Access denied');
    });

    it('should allow access to non-session namespaces', () => {
      const context = { sessionId: 'session-a' };

      expect(() => {
        accessControl.validateAccess(context, 'default', 'read');
      }).not.toThrow();

      expect(() => {
        accessControl.validateAccess(context, 'global', 'read');
      }).not.toThrow();
    });

    it('should throw when sessionId is missing', () => {
      const context = { sessionId: '' };
      expect(() => {
        accessControl.validateAccess(context, 'default', 'read');
      }).toThrow('sessionId is required');
    });
  });

  describe('canAccessEntry', () => {
    it('should allow access to own session entries', () => {
      const context = { sessionId: 'session-a' };
      expect(accessControl.canAccessEntry(context, 'session:session-a')).toBe(true);
    });

    it('should deny access to other session entries', () => {
      const context = { sessionId: 'session-a' };
      expect(accessControl.canAccessEntry(context, 'session:session-b')).toBe(false);
    });

    it('should allow access to non-session entries', () => {
      const context = { sessionId: 'session-a' };
      expect(accessControl.canAccessEntry(context, 'default')).toBe(true);
      expect(accessControl.canAccessEntry(context, 'global')).toBe(true);
    });

    it('should return false when sessionId is missing', () => {
      const context = { sessionId: '' };
      expect(accessControl.canAccessEntry(context, 'session:session-a')).toBe(false);
    });

    it('should respect includeShared flag', () => {
      const contextWithShared = { sessionId: 'session-a', agentId: 'agent-1', includeShared: true };
      const contextWithoutShared = { sessionId: 'session-a', agentId: 'agent-1', includeShared: false };

      // Both should allow access to own agent's entries
      expect(accessControl.canAccessEntry(contextWithShared, 'session:session-a', 'agent-1')).toBe(true);
      expect(accessControl.canAccessEntry(contextWithoutShared, 'session:session-a', 'agent-1')).toBe(true);

      // includeShared: false should deny access to other agent's entries
      expect(accessControl.canAccessEntry(contextWithoutShared, 'session:session-a', 'agent-2')).toBe(false);

      // includeShared: true (default) should allow access to shared entries
      expect(accessControl.canAccessEntry(contextWithShared, 'session:session-a', undefined)).toBe(true);
    });
  });

  describe('deriveNamespace', () => {
    it('should use explicit namespace when provided', () => {
      const context = { sessionId: 'session-a' };
      expect(accessControl.deriveNamespace(context, 'custom-namespace')).toBe('custom-namespace');
    });

    it('should derive session namespace when no explicit namespace', () => {
      const context = { sessionId: 'session-a' };
      expect(accessControl.deriveNamespace(context)).toBe('session:session-a');
    });

    it('should validate access to explicit namespace', () => {
      const context = { sessionId: 'session-a' };
      expect(() => {
        accessControl.deriveNamespace(context, 'session:session-b');
      }).toThrow('Access denied');
    });
  });

  describe('shouldFilterBySession', () => {
    it('should return requested namespace when provided', () => {
      const context = { sessionId: 'session-a' };
      expect(accessControl.shouldFilterBySession(context, 'custom-namespace')).toBe('custom-namespace');
    });

    it('should return session namespace when no namespace provided', () => {
      const context = { sessionId: 'session-a' };
      expect(accessControl.shouldFilterBySession(context)).toBe('session:session-a');
    });

    it('should validate access to requested namespace', () => {
      const context = { sessionId: 'session-a' };
      expect(() => {
        accessControl.shouldFilterBySession(context, 'session:session-b');
      }).toThrow('Access denied');
    });
  });

  describe('singleton', () => {
    it('should return same instance from getAccessControl', () => {
      const ac1 = getAccessControl();
      const ac2 = getAccessControl();
      expect(ac1).toBe(ac2);
    });

    it('should create new instance after reset', () => {
      const ac1 = getAccessControl();
      resetAccessControl();
      const ac2 = getAccessControl();
      expect(ac1).not.toBe(ac2);
    });
  });
});
