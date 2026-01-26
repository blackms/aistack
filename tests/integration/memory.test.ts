/**
 * Memory Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestEnv, cleanupTestEnv, createTestConfig } from './setup.js';
import { getMemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';

describe('Memory Integration', () => {
  let config: AgentStackConfig;

  beforeEach(() => {
    setupTestEnv();
    config = createTestConfig();
  });

  afterEach(() => {
    resetMemoryManager();
    cleanupTestEnv();
  });

  it('should store and retrieve memory entries', async () => {
    const memory = getMemoryManager(config);

    // Store entry
    const entry = await memory.store('test-key', 'test content', {
      namespace: 'test-namespace',
      metadata: { foo: 'bar' },
    });

    expect(entry.key).toBe('test-key');
    expect(entry.content).toBe('test content');
    expect(entry.namespace).toBe('test-namespace');
    expect(entry.metadata).toEqual({ foo: 'bar' });

    // Retrieve entry
    const retrieved = memory.get('test-key', 'test-namespace');
    expect(retrieved).toBeDefined();
    expect(retrieved?.content).toBe('test content');
  });

  it('should update existing entries', async () => {
    const memory = getMemoryManager(config);

    // Store initial entry
    await memory.store('update-key', 'initial content');

    // Update entry
    const updated = await memory.store('update-key', 'updated content');

    expect(updated.content).toBe('updated content');
    expect(updated.key).toBe('update-key');

    // Verify update persisted
    const retrieved = memory.get('update-key');
    expect(retrieved?.content).toBe('updated content');
  });

  it('should search entries with FTS', async () => {
    const memory = getMemoryManager(config);

    // Store multiple entries
    await memory.store('entry-1', 'The quick brown fox jumps over the lazy dog');
    await memory.store('entry-2', 'A lazy afternoon in the park');
    await memory.store('entry-3', 'The brown bear lives in the forest');

    // Search for "lazy"
    const results = await memory.search('lazy');

    expect(results.length).toBeGreaterThanOrEqual(2);
    const keys = results.map(r => r.entry.key);
    expect(keys).toContain('entry-1');
    expect(keys).toContain('entry-2');
  });

  it('should delete entries', async () => {
    const memory = getMemoryManager(config);

    // Store entry
    await memory.store('delete-key', 'content to delete');

    // Verify it exists
    let retrieved = memory.get('delete-key');
    expect(retrieved).toBeDefined();

    // Delete entry
    const deleted = memory.delete('delete-key');
    expect(deleted).toBe(true);

    // Verify it's gone
    retrieved = memory.get('delete-key');
    expect(retrieved).toBeNull();
  });

  it('should list entries with pagination', async () => {
    const memory = getMemoryManager(config);

    // Store multiple entries
    for (let i = 0; i < 10; i++) {
      await memory.store(`entry-${i}`, `content ${i}`, {
        namespace: 'pagination-test',
      });
    }

    // List with limit
    const entries = memory.list('pagination-test', 5, 0);
    expect(entries.length).toBe(5);

    // List next page
    const nextEntries = memory.list('pagination-test', 5, 5);
    expect(nextEntries.length).toBe(5);

    // Verify no overlap
    const firstKeys = new Set(entries.map(e => e.key));
    const secondKeys = new Set(nextEntries.map(e => e.key));
    const intersection = [...firstKeys].filter(k => secondKeys.has(k));
    expect(intersection.length).toBe(0);
  });

  it('should count entries', async () => {
    const memory = getMemoryManager(config);

    // Store entries in different namespaces
    await memory.store('key1', 'content1', { namespace: 'ns1' });
    await memory.store('key2', 'content2', { namespace: 'ns1' });
    await memory.store('key3', 'content3', { namespace: 'ns2' });

    // Count entries
    const ns1Count = memory.count('ns1');
    const ns2Count = memory.count('ns2');
    const totalCount = memory.count();

    expect(ns1Count).toBe(2);
    expect(ns2Count).toBe(1);
    expect(totalCount).toBeGreaterThanOrEqual(3);
  });

  it('should handle sessions', async () => {
    const memory = getMemoryManager(config);

    // Create session
    const session = memory.createSession({ foo: 'bar' });
    expect(session.status).toBe('active');
    expect(session.metadata).toEqual({ foo: 'bar' });

    // Get session
    const retrieved = memory.getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(session.id);

    // End session
    memory.endSession(session.id);
    const ended = memory.getSession(session.id);
    expect(ended?.status).toBe('ended');
  });
});
