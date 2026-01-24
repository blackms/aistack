/**
 * FTS Search tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FTSSearch } from '../../src/memory/fts-search.js';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FTSSearch', () => {
  let store: SQLiteStore;
  let fts: FTSSearch;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-fts-test-${Date.now()}.db`);
    store = new SQLiteStore(dbPath);
    // Access the internal db for FTS
    fts = new FTSSearch((store as any).db);
  });

  afterEach(() => {
    store.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('search', () => {
    it('should find matching entries', () => {
      store.store('key1', 'The quick brown fox jumps over the lazy dog');
      store.store('key2', 'A lazy cat sleeps all day');
      store.store('key3', 'Quick foxes are very fast animals');

      const results = fts.search('quick fox');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchType).toBe('fts');
    });

    it('should return empty for no matches', () => {
      store.store('key1', 'Hello world');

      const results = fts.search('nonexistent term xyz');

      expect(results).toEqual([]);
    });

    it('should filter by namespace', () => {
      store.store('key1', 'apple banana cherry', { namespace: 'fruits' });
      store.store('key2', 'apple pie recipe', { namespace: 'recipes' });

      const results = fts.search('apple', { namespace: 'fruits' });

      expect(results.length).toBe(1);
      expect(results[0].entry.namespace).toBe('fruits');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        store.store(`key${i}`, `content with keyword number ${i}`);
      }

      const results = fts.search('keyword', { limit: 5 });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should include score in results', () => {
      store.store('key1', 'test content with search term');

      const results = fts.search('search');

      expect(results.length).toBe(1);
      expect(results[0].score).toBeGreaterThanOrEqual(0);
      expect(results[0].score).toBeLessThanOrEqual(1);
    });
  });

  describe('phraseSearch', () => {
    it('should find exact phrases', () => {
      store.store('key1', 'The quick brown fox jumps');
      store.store('key2', 'A slow gray cat sleeps');

      const results = fts.phraseSearch('quick brown');

      expect(results.length).toBe(1);
      expect(results[0].entry.key).toBe('key1');
    });

    it('should handle quotes in phrase', () => {
      store.store('key1', 'He said "hello world" today');

      const results = fts.phraseSearch('hello world');

      expect(results.length).toBe(1);
    });
  });

  describe('prefixSearch', () => {
    it('should find entries by prefix', () => {
      store.store('key1', 'programming language');
      store.store('key2', 'program execution');
      store.store('key3', 'project management');

      const results = fts.prefixSearch('prog');

      expect(results.length).toBe(2);
    });

    it('should handle multiple prefix terms', () => {
      store.store('key1', 'quick brown fox');
      store.store('key2', 'quickly running');

      const results = fts.prefixSearch('qui bro');

      expect(results.length).toBe(1);
    });
  });

  describe('termExists', () => {
    it('should return true for existing term', () => {
      store.store('key1', 'hello world');

      expect(fts.termExists('hello')).toBe(true);
    });

    it('should return false for non-existing term', () => {
      store.store('key1', 'hello world');

      expect(fts.termExists('nonexistent')).toBe(false);
    });

    it('should check within namespace', () => {
      store.store('key1', 'apple fruit', { namespace: 'ns1' });
      store.store('key2', 'banana fruit', { namespace: 'ns2' });

      expect(fts.termExists('apple', 'ns1')).toBe(true);
      expect(fts.termExists('apple', 'ns2')).toBe(false);
    });
  });

  describe('suggest', () => {
    it('should return suggestions for partial term', () => {
      store.store('key1', 'programming is fun');
      store.store('key2', 'programmer writes code');
      store.store('key3', 'progress tracking');

      const suggestions = fts.suggest('prog');

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.startsWith('prog'))).toBe(true);
    });

    it('should respect limit', () => {
      store.store('key1', 'test1 test2 test3 test4 test5 test6');

      const suggestions = fts.suggest('test', 3);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should return empty for no matches', () => {
      store.store('key1', 'hello world');

      const suggestions = fts.suggest('xyz');

      expect(suggestions).toEqual([]);
    });
  });
});
