/**
 * `aistack ingest issue <url>` — drive the autonomous issue→PR workflow.
 *
 * The webhook listener and this CLI both end up calling
 * `runIssueToPRWorkflow`; the CLI is the convenient entry point for manual
 * runs and for the E2E test rig.
 */

import { Command } from 'commander';
import { getConfig } from '../../utils/config.js';
import { ingestIssue, runIssueToPRWorkflow } from '../../github/index.js';

export function createIngestCommand(): Command {
  const command = new Command('ingest').description('Ingest external work items (issues, PRs)');

  command
    .command('issue <url>')
    .description('Ingest a GitHub/GitLab issue and open a draft PR autonomously')
    .option('--dry-run', 'Run the workflow without creating a PR or writing labels')
    .option('--no-labels', 'Skip label updates on the source issue')
    .option('--base <branch>', 'Base branch for the draft PR', 'main')
    .option('--head <branch>', 'Head branch for the draft PR (default: aistack/<provider>-<n>-<uuid>)')
    .option('--max-iterations <n>', 'Maximum adversarial review iterations', '2')
    .option('--watch', 'Stream lifecycle events to stdout (implies verbose)')
    .action(async (url: string, options) => {
      const opts = options as {
        dryRun?: boolean;
        labels?: boolean; // commander negates --no-labels into labels:false
        base?: string;
        head?: string;
        maxIterations?: string;
        watch?: boolean;
      };

      try {
        const config = getConfig();
        if (opts.watch) {
          console.log(`[ingest] fetching issue ${url}`);
        }

        const { issue, client } = await ingestIssue(url, {
          credentials: { token: config.github.token },
        });

        if (opts.watch) {
          console.log(`[ingest] provider=${issue.provider} owner=${issue.owner} repo=${issue.repo} #${issue.number}`);
          console.log(`[ingest] title: ${issue.title}`);
          console.log(`[ingest] labels: ${issue.labels.join(', ') || '<none>'}`);
          console.log('[ingest] starting workflow...');
        }

        const result = await runIssueToPRWorkflow(issue, client, config, {
          dryRun: opts.dryRun ?? false,
          skipLabels: opts.labels === false,
          base: opts.base,
          head: opts.head,
          maxIterations: opts.maxIterations ? Number(opts.maxIterations) : undefined,
        });

        console.log('\nWorkflow result:');
        console.log(`  status:     ${result.status}`);
        console.log(`  branch:     ${result.branch}`);
        console.log(`  reviews:    ${result.reviews.length} iteration(s)`);
        if (result.pullRequest) {
          console.log(`  pull req:   ${result.pullRequest.url}`);
        }
        if (result.error) {
          console.log(`  error:      ${result.error}`);
        }

        if (result.status === 'failed') {
          process.exit(1);
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  return command;
}
