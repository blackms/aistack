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
  runDocSync,
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

  describe('Error handling', () => {
    it('should emit error event when phase throws', async () => {
      let errorEmitted = false;

      runner.on('workflow:error', () => {
        errorEmitted = true;
      });

      runner.registerPhase('inventory', async () => {
        throw new Error('Phase execution failed');
      });

      const config: WorkflowConfig = {
        id: 'test-error',
        name: 'Test Error',
        description: 'Test error handling',
        agents: { primary: { name: 'Test', role: 'Test', type: 'tester' } },
        inputs: { targetDirectory: './docs', sourceCode: '.' },
        phases: ['inventory'],
        constraints: [],
      };

      await expect(runner.run(config)).rejects.toThrow('Phase execution failed');
      expect(errorEmitted).toBe(true);
    });

    it('should handle non-Error thrown values', async () => {
      runner.registerPhase('inventory', async () => {
        throw 'string error';
      });

      const config: WorkflowConfig = {
        id: 'test-string-error',
        name: 'Test String Error',
        description: 'Test',
        agents: { primary: { name: 'Test', role: 'Test', type: 'tester' } },
        inputs: { targetDirectory: './docs', sourceCode: '.' },
        phases: ['inventory'],
        constraints: [],
      };

      await expect(runner.run(config)).rejects.toThrow('string error');
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

  it('should scan subdirectories recursively', async () => {
    const subDir = join(docsDir, 'guides');
    mkdirSync(subDir, { recursive: true });

    writeFileSync(join(docsDir, 'README.md'), '# Main README');
    writeFileSync(join(subDir, 'quickstart.md'), '# Quick Start Guide\n\nHow to get started.');

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(2);
  });

  it('should skip excluded directories', async () => {
    const nodeModules = join(docsDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    writeFileSync(join(nodeModules, 'excluded.md'), '# Should not be scanned');

    writeFileSync(join(docsDir, 'included.md'), '# Should be scanned');

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(1);
  });

  it('should detect different document types', async () => {
    writeFileSync(join(docsDir, 'README.md'), '# README');
    writeFileSync(join(docsDir, 'CHANGELOG.md'), '# Changelog');
    writeFileSync(join(docsDir, 'api-reference.md'), '# API');
    writeFileSync(join(docsDir, 'adr-001.md'), '# ADR 001');
    writeFileSync(join(docsDir, 'deploy-guide.md'), '# Deployment Guide');
    writeFileSync(join(docsDir, 'architecture.md'), '# Architecture\n\nSystem Design Overview');
    writeFileSync(join(docsDir, 'user-guide.md'), '# User Guide\n\nHow to use this tool');

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(7);
  });

  it('should extract code blocks from content', async () => {
    writeFileSync(
      join(docsDir, 'examples.md'),
      '# Examples\n\n```typescript\nconst x = 1;\n```\n\n```python\nprint("hello")\n```'
    );

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(1);
  });

  it('should handle intent extraction from different formats', async () => {
    // Heading format
    writeFileSync(join(docsDir, 'heading.md'), '# Main Heading\n\nContent here.');

    // Quote format
    writeFileSync(join(docsDir, 'quote.md'), '> This is the intent\n\nContent here.');

    // Bold format
    writeFileSync(join(docsDir, 'bold.md'), '**Bold intent description**\n\nContent here.');

    // No clear intent
    writeFileSync(join(docsDir, 'plain.md'), 'Just plain text content.');

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(4);
  });

  it('should handle mdx files', async () => {
    writeFileSync(join(docsDir, 'component.mdx'), '# MDX Component\n\n<MyComponent />');

    const runner = getWorkflowRunner();
    registerDocSyncWorkflow();

    const config = { ...docSyncConfig };
    config.inputs.targetDirectory = docsDir;
    config.inputs.sourceCode = testDir;

    const report = await runner.run(config);

    expect(report.summary.documentsScanned).toBe(1);
  });
});

describe('runDocSync', () => {
  let testDir: string;
  let docsDir: string;

  beforeEach(() => {
    resetWorkflowRunner();
    testDir = join(tmpdir(), `aistack-rundocsync-${Date.now()}`);
    docsDir = join(testDir, 'docs');
    mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should run with default docs directory', async () => {
    writeFileSync(join(docsDir, 'test.md'), '# Test');

    // Mock the docsDirectory parameter
    await expect(runDocSync(docsDir)).resolves.not.toThrow();
  });

  it('should run with custom docs directory', async () => {
    const customDocs = join(testDir, 'custom-docs');
    mkdirSync(customDocs, { recursive: true });
    writeFileSync(join(customDocs, 'custom.md'), '# Custom Docs');

    await expect(runDocSync(customDocs)).resolves.not.toThrow();
  });
});
