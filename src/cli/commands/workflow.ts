/**
 * workflow command - Run and manage workflows
 */

import { Command } from 'commander';
import { runDocSync, getWorkflowRunner, resetWorkflowRunner } from '../../workflows/index.js';
import { registerDefaultTriggers, getWorkflowTriggers, clearWorkflowTriggers } from '../../hooks/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('workflow');

export function createWorkflowCommand(): Command {
  const command = new Command('workflow')
    .description('Run and manage workflows');

  // Run subcommand
  command
    .command('run <workflow>')
    .description('Run a workflow')
    .option('-d, --docs <path>', 'Documentation directory', './docs')
    .option('-s, --source <path>', 'Source code directory', '.')
    .option('-v, --verbose', 'Verbose output')
    .action(async (workflow: string, options) => {
      const { docs, verbose } = options as {
        docs: string;
        verbose?: boolean;
      };

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

  return command;
}
