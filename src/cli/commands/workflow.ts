/**
 * workflow command - Run and manage workflows
 */

import { Command } from 'commander';
import { runDocSync, getWorkflowRunner, resetWorkflowRunner } from '../../workflows/index.js';
import { registerDefaultTriggers, getWorkflowTriggers, clearWorkflowTriggers } from '../../hooks/index.js';
import { logger } from '../../utils/logger.js';
import { existsSync } from 'node:fs';
import { loadConfig } from '../../utils/config.js';
import { getCheckpointer } from '../../persistence/checkpointer.js';

const log = logger.child('workflow');

// File extensions that route to the DSL executor instead of the named-workflow runner.
const DSL_EXTENSIONS = ['.yaml', '.yml', '.json'];

function looksLikeWorkflowFile(arg: string): boolean {
  const lower = arg.toLowerCase();
  if (DSL_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  // Also accept any existing file path.
  if (existsSync(arg)) return true;
  return false;
}

export function createWorkflowCommand(): Command {
  const command = new Command('workflow')
    .description('Run and manage workflows');

  // Run subcommand — accepts either a named workflow (legacy) or a DSL file path.
  command
    .command('run <workflow>')
    .description('Run a workflow (named workflow or YAML/JSON DSL file)')
    .option('-d, --docs <path>', 'Documentation directory', './docs')
    .option('-s, --source <path>', 'Source code directory', '.')
    .option('-v, --verbose', 'Verbose output')
    .option('--input <json>', 'Task input as JSON string (DSL mode)')
    .option('--watch', 'Hot-reload: re-run on file change (DSL mode)')
    .action(async (workflow: string, options) => {
      const { docs, verbose, input, watch } = options as {
        docs: string;
        verbose?: boolean;
        input?: string;
        watch?: boolean;
      };

      // Route to DSL executor if argument looks like a workflow file path.
      if (looksLikeWorkflowFile(workflow)) {
        const { runDslWorkflowFile } = await import('./workflow-dsl-runner.js');
        await runDslWorkflowFile(workflow, { input, watch, verbose });
        return;
      }

      console.log(`Running workflow: ${workflow}\n`);

      const runner = getWorkflowRunner();

      // Subscribe to events if verbose
      if (verbose) {
        runner.on('phase:start', (phase) => {
          console.log(`  [PHASE] Starting: ${phase}`);
        });
        runner.on('phase:complete', (result) => {
          console.log(`  [PHASE] Completed: ${result.phase} (${result.success ? 'PASS' : 'FAIL'})`);
          if (result.findings.length > 0) {
            console.log(`         Findings: ${result.findings.length}`);
          }
        });
        runner.on('finding', (finding) => {
          console.log(`  [FINDING] ${finding.severity.toUpperCase()}: ${finding.claim}`);
          console.log(`            ${finding.contradiction}`);
        });
      }

      try {
        switch (workflow) {
          case 'doc-sync':
          case 'documentation_truth_sync_with_adversarial_review':
            await runDocSync(docs);
            console.log('\nWorkflow completed.');
            break;
          default:
            console.error(`Unknown workflow: ${workflow}`);
            console.log('\nAvailable workflows:');
            console.log('  doc-sync    Documentation sync with adversarial review');
            process.exit(1);
        }
      } catch (error) {
        console.error('Workflow failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      log.info('Workflow executed', { workflow });
    });

  // List subcommand
  command
    .command('list')
    .description('List available workflows')
    .action(() => {
      console.log('Available workflows:\n');
      console.log('  doc-sync');
      console.log('    Documentation Truth Sync with Adversarial Review');
      console.log('    Ensures all documentation is perfectly aligned with the codebase');
      console.log('    Phases: inventory → analysis → sync → consistency → adversarial → reconciliation');
      console.log('');
    });

  // Triggers subcommand
  command
    .command('triggers')
    .description('Manage workflow triggers')
    .option('-l, --list', 'List registered triggers')
    .option('-r, --register-defaults', 'Register default triggers')
    .option('-c, --clear', 'Clear all triggers')
    .action((options) => {
      const { list, registerDefaults, clear } = options as {
        list?: boolean;
        registerDefaults?: boolean;
        clear?: boolean;
      };

      if (clear) {
        clearWorkflowTriggers();
        console.log('All workflow triggers cleared.');
        return;
      }

      if (registerDefaults) {
        registerDefaultTriggers();
        console.log('Default triggers registered.');
      }

      if (list || registerDefaults) {
        const triggers = getWorkflowTriggers();
        console.log(`\nRegistered triggers (${triggers.length}):\n`);
        for (const trigger of triggers) {
          console.log(`  ${trigger.id}`);
          console.log(`    Name: ${trigger.name}`);
          console.log(`    Workflow: ${trigger.workflowId}`);
          console.log('');
        }
        if (triggers.length === 0) {
          console.log('  No triggers registered.');
          console.log('  Use --register-defaults to add default triggers.\n');
        }
      }
    });

  // Reset subcommand
  command
    .command('reset')
    .description('Reset workflow runner state')
    .action(() => {
      resetWorkflowRunner();
      console.log('Workflow runner reset.');
    });

  // Resume subcommand — durable execution (AIG-633)
  command
    .command('resume <sessionId>')
    .description('Resume a workflow from its latest checkpoint (durable execution)')
    .option('--from-step <stepId>', 'Resume from a specific step instead of the latest checkpoint')
    .option('--dry-run', 'Print the loaded checkpoint state without re-executing the workflow')
    .action(async (sessionId: string, options) => {
      const { fromStep, dryRun } = options as { fromStep?: string; dryRun?: boolean };

      const config = loadConfig();
      if (!config.checkpointing?.enabled) {
        console.error('Checkpointing is disabled in aistack.config.json.');
        console.error('Enable it with:  "checkpointing": { "enabled": true }');
        process.exit(1);
      }

      const checkpointer = getCheckpointer(config);
      const checkpoint = fromStep
        ? checkpointer.loadByStep(sessionId, fromStep)
        : checkpointer.loadLatest(sessionId);

      if (!checkpoint) {
        console.error(`No checkpoint found for session ${sessionId}${fromStep ? ` at step ${fromStep}` : ''}.`);
        process.exit(1);
      }

      console.log(`Loaded checkpoint for session ${sessionId}`);
      console.log(`  agent:      ${checkpoint.agentId}`);
      console.log(`  step:       ${checkpoint.stepId}`);
      console.log(`  created at: ${checkpoint.createdAt.toISOString()}`);
      console.log(`  format:     ${checkpoint.format}`);

      if (dryRun) {
        console.log('\n--dry-run: loaded state (truncated to 2 KiB):');
        const blob = JSON.stringify(checkpoint.state, null, 2);
        console.log(blob.length > 2048 ? blob.slice(0, 2048) + '\n... [truncated]' : blob);
        return;
      }

      // Resume hook: the workflow runtime is expected to consult the
      // checkpoint state via `getCheckpointer().loadLatest(sessionId)` at
      // startup. For now we surface the checkpoint and let downstream
      // workflow executors pick it up — full reattachment to a specific
      // workflow definition is workflow-specific and out of scope for
      // this command.
      console.log('\nCheckpoint is now available to the workflow runtime.');
      console.log('Re-run the original workflow with the same session id to continue execution.');
      log.info('Workflow resume requested', { sessionId, stepId: checkpoint.stepId });
    });

  return command;
}
