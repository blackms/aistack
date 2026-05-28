/**
 * `aistack workflow inspect <session-id>` — surface the pending interrupt
 * (if any) for a given workflow session, including the captured state and
 * the schema of the value the human is expected to provide.
 *
 * Lives in its own command file so the existing workflow command remains
 * untouched apart from a single registration line.
 */

import { Command } from 'commander';
import { getInterruptStore } from '../../coordination/interrupt.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('cli:workflow-inspect');

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.floor(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function createWorkflowInspectCommand(): Command {
  return new Command('inspect')
    .description('Inspect a workflow session: pending interrupts + state snapshot')
    .argument('<session-id>', 'Workflow session identifier')
    .option('--json', 'Emit the full record as JSON (machine-readable)')
    .option('--all', 'Include resolved/cancelled interrupts as well')
    .action((sessionId: string, options: { json?: boolean; all?: boolean }) => {
      const store = getInterruptStore();
      const records = options.all
        ? store.list({ sessionId })
        : store.list({ sessionId, status: 'pending' });

      if (options.json) {
        process.stdout.write(JSON.stringify(records, null, 2) + '\n');
        return;
      }

      if (records.length === 0) {
        console.log(`No ${options.all ? '' : 'pending '}interrupts for session ${sessionId}.`);
        return;
      }

      console.log(`Session: ${sessionId}`);
      console.log(`Interrupts: ${records.length}\n`);
      for (const r of records) {
        console.log(`  [${r.status.toUpperCase()}] ${r.id}`);
        console.log(`    prompt:    ${r.prompt}`);
        if (r.workflowId) console.log(`    workflow:  ${r.workflowId}`);
        console.log(`    created:   ${r.createdAt} (age ${formatAge(r.createdAt)})`);
        if (r.claimedAt) console.log(`    claimed:   ${r.claimedAt}`);
        if (r.resolvedAt) console.log(`    resolved:  ${r.resolvedAt}`);
        if (r.schema) {
          console.log(`    schema:    ${JSON.stringify(r.schema)}`);
        }
        if (r.state && Object.keys(r.state).length > 0) {
          console.log(`    state:`);
          for (const line of JSON.stringify(r.state, null, 2).split('\n')) {
            console.log(`      ${line}`);
          }
        }
        if (r.status === 'pending') {
          console.log('');
          console.log(`    Resume with:`);
          console.log(`      aistack workflow resume ${r.sessionId} --input='<json>'`);
          console.log(`    Or edit state first:`);
          console.log(`      aistack workflow resume ${r.sessionId} --edit-state='path.to.field=value' --input='<json>'`);
        }
        console.log('');
      }
      log.debug('Listed interrupts', { sessionId, count: records.length });
    });
}
