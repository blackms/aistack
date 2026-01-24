/**
 * Workflow hooks tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerWorkflowTrigger,
  unregisterWorkflowTrigger,
  getWorkflowTriggers,
  clearWorkflowTriggers,
  registerDefaultTriggers,
  type WorkflowTrigger,
} from '../../src/hooks/workflow.js';

describe('Workflow Triggers', () => {
  beforeEach(() => {
    clearWorkflowTriggers();
  });

  describe('registerWorkflowTrigger', () => {
    it('should register a trigger', () => {
      const trigger: WorkflowTrigger = {
        id: 'test-trigger',
        name: 'Test Trigger',
        condition: () => true,
        workflowId: 'test-workflow',
      };

      registerWorkflowTrigger(trigger);

      const triggers = getWorkflowTriggers();
      expect(triggers.length).toBe(1);
      expect(triggers[0].id).toBe('test-trigger');
    });

    it('should register multiple triggers', () => {
      registerWorkflowTrigger({
        id: 'trigger-1',
        name: 'Trigger 1',
        condition: () => true,
        workflowId: 'workflow-1',
      });

      registerWorkflowTrigger({
        id: 'trigger-2',
        name: 'Trigger 2',
        condition: () => false,
        workflowId: 'workflow-2',
      });

      expect(getWorkflowTriggers().length).toBe(2);
    });

    it('should store trigger options', () => {
      const trigger: WorkflowTrigger = {
        id: 'trigger-with-options',
        name: 'Trigger with Options',
        condition: () => true,
        workflowId: 'test',
        options: { key: 'value', number: 42 },
      };

      registerWorkflowTrigger(trigger);

      const triggers = getWorkflowTriggers();
      expect(triggers[0].options).toEqual({ key: 'value', number: 42 });
    });
  });

  describe('unregisterWorkflowTrigger', () => {
    it('should unregister a trigger by ID', () => {
      registerWorkflowTrigger({
        id: 'to-remove',
        name: 'To Remove',
        condition: () => true,
        workflowId: 'test',
      });

      const result = unregisterWorkflowTrigger('to-remove');

      expect(result).toBe(true);
      expect(getWorkflowTriggers().length).toBe(0);
    });

    it('should return false for non-existent trigger', () => {
      const result = unregisterWorkflowTrigger('non-existent');
      expect(result).toBe(false);
    });

    it('should only remove the specified trigger', () => {
      registerWorkflowTrigger({
        id: 'keep-1',
        name: 'Keep 1',
        condition: () => true,
        workflowId: 'test',
      });

      registerWorkflowTrigger({
        id: 'remove',
        name: 'Remove',
        condition: () => true,
        workflowId: 'test',
      });

      registerWorkflowTrigger({
        id: 'keep-2',
        name: 'Keep 2',
        condition: () => true,
        workflowId: 'test',
      });

      unregisterWorkflowTrigger('remove');

      const triggers = getWorkflowTriggers();
      expect(triggers.length).toBe(2);
      expect(triggers.map((t) => t.id)).toEqual(['keep-1', 'keep-2']);
    });
  });

  describe('getWorkflowTriggers', () => {
    it('should return empty array when no triggers', () => {
      expect(getWorkflowTriggers()).toEqual([]);
    });

    it('should return a copy of triggers', () => {
      registerWorkflowTrigger({
        id: 'test',
        name: 'Test',
        condition: () => true,
        workflowId: 'test',
      });

      const triggers1 = getWorkflowTriggers();
      const triggers2 = getWorkflowTriggers();

      expect(triggers1).not.toBe(triggers2);
      expect(triggers1).toEqual(triggers2);
    });
  });

  describe('clearWorkflowTriggers', () => {
    it('should clear all triggers', () => {
      registerWorkflowTrigger({
        id: 't1',
        name: 'T1',
        condition: () => true,
        workflowId: 'w1',
      });

      registerWorkflowTrigger({
        id: 't2',
        name: 'T2',
        condition: () => true,
        workflowId: 'w2',
      });

      clearWorkflowTriggers();

      expect(getWorkflowTriggers()).toEqual([]);
    });
  });

  describe('registerDefaultTriggers', () => {
    it('should register default doc-sync trigger', () => {
      registerDefaultTriggers();

      const triggers = getWorkflowTriggers();
      expect(triggers.length).toBeGreaterThan(0);

      const docSyncTrigger = triggers.find((t) => t.id === 'doc-sync-on-change');
      expect(docSyncTrigger).toBeDefined();
      expect(docSyncTrigger?.workflowId).toBe('doc-sync');
    });

    it('should trigger on docs directory', () => {
      registerDefaultTriggers();

      const trigger = getWorkflowTriggers().find((t) => t.id === 'doc-sync-on-change');
      const condition = trigger?.condition;

      expect(condition?.({ event: 'post-edit', data: { path: '/project/docs/readme.md' } })).toBe(
        true
      );
      expect(condition?.({ event: 'post-edit', data: { path: '/project/src/index.ts' } })).toBe(
        false
      );
    });

    it('should trigger on markdown files', () => {
      registerDefaultTriggers();

      const trigger = getWorkflowTriggers().find((t) => t.id === 'doc-sync-on-change');
      const condition = trigger?.condition;

      expect(condition?.({ event: 'post-edit', data: { path: '/project/README.md' } })).toBe(true);
      expect(condition?.({ event: 'post-edit', data: { path: '/project/notes.md' } })).toBe(true);
      expect(condition?.({ event: 'post-edit', data: { path: '/project/file.txt' } })).toBe(false);
    });

    it('should handle missing path', () => {
      registerDefaultTriggers();

      const trigger = getWorkflowTriggers().find((t) => t.id === 'doc-sync-on-change');
      const condition = trigger?.condition;

      expect(condition?.({ event: 'post-edit', data: {} })).toBe(false);
      expect(condition?.({ event: 'post-edit' })).toBe(false);
    });
  });

  describe('trigger conditions', () => {
    it('should evaluate condition function', () => {
      const conditionFn = vi.fn().mockReturnValue(true);

      registerWorkflowTrigger({
        id: 'conditional',
        name: 'Conditional',
        condition: conditionFn,
        workflowId: 'test',
      });

      const trigger = getWorkflowTriggers()[0];
      const context = { event: 'test', data: { key: 'value' } };

      const result = trigger.condition(context);

      expect(conditionFn).toHaveBeenCalledWith(context);
      expect(result).toBe(true);
    });

    it('should support complex conditions', () => {
      registerWorkflowTrigger({
        id: 'complex',
        name: 'Complex',
        condition: (ctx) => {
          const files = (ctx.data?.files as string[]) || [];
          return files.some((f) => f.endsWith('.test.ts'));
        },
        workflowId: 'test-runner',
      });

      const trigger = getWorkflowTriggers()[0];

      expect(trigger.condition({ event: 'change', data: { files: ['foo.ts', 'bar.test.ts'] } })).toBe(
        true
      );
      expect(trigger.condition({ event: 'change', data: { files: ['foo.ts', 'bar.ts'] } })).toBe(
        false
      );
    });
  });
});
