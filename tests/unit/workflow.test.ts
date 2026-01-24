/**
 * Workflow tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WorkflowRunner,
  getWorkflowRunner,
  resetWorkflowRunner,
  docSyncConfig,
  registerDocSyncWorkflow,
  type WorkflowConfig,
  type PhaseResult,
} from '../../src/workflows/index.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WorkflowRunner', () => {
  let runner: WorkflowRunner;

  beforeEach(() => {
    resetWorkflowRunner();
    runner = getWorkflowRunner();
  });

  describe('Phase registration', () => {
    it('should register a phase executor', () => {
      const executor = async () => ({
        phase: 'inventory' as const,
        success: true,
        findings: [],
        artifacts: {},
        duration: 0,
      });

      runner.registerPhase('inventory', executor);
      // No error means success
      expect(true).toBe(true);
    });

    it('should skip unregistered phases', async () => {
      const config: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        agents: {
          primary: {
            name: 'Test Agent',
            role: 'Tester',
            type: 'tester',
          },
        },
        inputs: {
          targetDirectory: './docs',
          sourceCode: '.',
        },
        phases: ['inventory'],
        constraints: [],
      };

      const report = await runner.run(config);

      expect(report.verdict).toBe('FAIL');
      expect(report.phases.length).toBe(1);
      expect(report.phases[0].success).toBe(true);
    });
  });

  describe('Event emission', () => {
    it('should emit workflow:start event', async () => {
      let startEmitted = false;

      runner.on('workflow:start', () => {
        startEmitted = true;
      });

      const config: WorkflowConfig = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        agents: { primary: { name: 'Test', role: 'Test', type: 'tester' } },
        inputs: { targetDirectory: './docs', sourceCode: '.' },
        phases: [],
        constraints: [],
      };

      await runner.run(config);

      expect(startEmitted).toBe(true);
    });

    it('should emit workflow:complete event', async () => {
      let completeEmitted = false;

      runner.on('workflow:complete', () => {
        completeEmitted = true;
      });

      const config: WorkflowConfig = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        agents: { primary: { name: 'Test', role: 'Test', type: 'tester' } },
        inputs: { targetDirectory: './docs', sourceCode: '.' },
        phases: [],
        constraints: [],
      };

      await runner.run(config);

      expect(completeEmitted).toBe(true);
    });

    it('should emit phase events', async () => {
      const events: string[] = [];

      runner.on('phase:start', (phase) => events.push(`start:${phase}`));
      runner.on('phase:complete', (result) => events.push(`complete:${result.phase}`));

      runner.registerPhase('inventory', async () => ({
        phase: 'inventory',
        success: true,
        findings: [],
        artifacts: {},
        duration: 0,
      }));

      const config: WorkflowConfig = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        agents: { primary: { name: 'Test', role: 'Test', type: 'tester' } },
        inputs: { targetDirectory: './docs', sourceCode: '.' },
        phases: ['inventory'],
        constraints: [],
      };

      await runner.run(config);

      expect(events).toContain('start:inventory');
      expect(events).toContain('complete:inventory');
    });
  });

  describe('Reconciliation loop', () => {
    it('should retry on adversarial failure', async () => {
      let adversarialCalls = 0;

      runner.registerPhase('sync', async () => ({
        phase: 'sync',
        success: true,
        findings: [],
        artifacts: { syncResults: [] },
        duration: 0,
      }));

      runner.registerPhase('adversarial', async () => {
        adversarialCalls++;
        // Fail first two times, pass on third
        return {
          phase: 'adversarial',
          success: adversarialCalls >= 3,
          findings: adversarialCalls < 3 ? [{
            claim: 'Test claim',
            contradiction: 'Test contradiction',
            severity: 'high' as const,
            evidence: [],
          }] : [],
          artifacts: {},
          duration: 0,
        };
      });

      const config: WorkflowConfig = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        agents: { primary: { name: 'Test', role: 'Test', type: 'tester' } },
        inputs: { targetDirectory: './docs', sourceCode: '.' },
        phases: ['sync', 'adversarial'],
        constraints: [],
        maxIterations: 3,
      };

      const report = await runner.run(config);

      expect(adversarialCalls).toBe(3);
      expect(report.verdict).toBe('PASS');
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const runner1 = getWorkflowRunner();
      const runner2 = getWorkflowRunner();
      expect(runner1).toBe(runner2);
    });

    it('should reset instance', () => {
      const runner1 = getWorkflowRunner();
      resetWorkflowRunner();
      const runner2 = getWorkflowRunner();
      expect(runner1).not.toBe(runner2);
    });
  });
});

describe('Doc Sync Workflow', () => {
  let testDir: string;
  let docsDir: string;

  beforeEach(() => {
    resetWorkflowRunner();
    testDir = join(tmpdir(), `aistack-workflow-test-${Date.now()}`);
    docsDir = join(testDir, 'docs');
    mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should have correct config structure', () => {
    expect(docSyncConfig.id).toBe('documentation_truth_sync_with_adversarial_review');
    expect(docSyncConfig.phases).toEqual([
      'inventory',
      'analysis',
      'sync',
      'consistency',
      'adversarial',
      'reconciliation',
    ]);
    expect(docSyncConfig.agents.primary).toBeDefined();
    expect(docSyncConfig.agents.adversarial).toBeDefined();
  });

  it('should run inventory phase with empty docs', async () => {
    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(0);
  });

  it('should find markdown files', async () => {
    // Create test markdown files
    writeFileSync(join(docsDir, 'README.md'), '# Test README\n\nThis is a test.');
    writeFileSync(join(docsDir, 'guide.md'), '# User Guide\n\nHow to use this.');

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(2);
  });

  it('should detect code references', async () => {
    writeFileSync(
      join(docsDir, 'api.md'),
      '# API Reference\n\nSee `src/index.ts` for the main entry point.'
    );

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(1);
    // Should find the missing file reference
    const findings = report.phases.flatMap((p) => p.findings);
    expect(findings.some((f) => f.evidence.includes('src/index.ts'))).toBe(true);
  });
});
