/**
 * memory command - Memory operations
 */

import { Command } from 'commander';
import { getMemoryManager } from '../../memory/index.js';
import { getConfig } from '../../utils/config.js';

export function createMemoryCommand(): Command {
  const command = new Command('memory')
    .description('Memory operations');

  // store subcommand
  command
    .command('store')
    .description('Store a key-value pair')
    .requiredOption('-k, --key <key>', 'Key for the entry')
    .requiredOption('-c, --content <content>', 'Content to store')
    .option('-n, --namespace <namespace>', 'Namespace')
    .option('--embed', 'Generate embedding for vector search')
    .action(async (options) => {
      const { key, content, namespace, embed } = options as {
        key: string;
        content: string;
        namespace?: string;
        embed?: boolean;
      };

      try {
        const config = getConfig();
        const memory = getMemoryManager(config);

        const entry = await memory.store(key, content, {
          namespace,
          generateEmbedding: embed,
        });

        console.log('Entry stored:\n');
        console.log(`  ID:        ${entry.id}`);
        console.log(`  Key:       ${entry.key}`);
        console.log(`  Namespace: ${entry.namespace}`);
        console.log(`  Created:   ${entry.createdAt.toISOString()}`);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // search subcommand
  command
    .command('search')
    .description('Search memory')
    .requiredOption('-q, --query <query>', 'Search query')
    .option('-n, --namespace <namespace>', 'Namespace to search')
    .option('-l, --limit <number>', 'Maximum results', '10')
    .option('--vector', 'Use vector search')
    .action(async (options) => {
      const { query, namespace, limit, vector } = options as {
        query: string;
        namespace?: string;
        limit: string;
        vector?: boolean;
      };

      try {
        const config = getConfig();
        const memory = getMemoryManager(config);

        const results = await memory.search(query, {
          namespace,
          limit: parseInt(limit, 10),
          useVector: vector,
        });

        if (results.length === 0) {
          console.log('No results found.');
          return;
        }

        console.log(`Found ${results.length} result(s):\n`);

        for (const result of results) {
          console.log(`Key:       ${result.entry.key}`);
          console.log(`Namespace: ${result.entry.namespace}`);
          console.log(`Score:     ${result.score} (${result.matchType})`);
          console.log(`Content:   ${result.entry.content.slice(0, 200)}${result.entry.content.length > 200 ? '...' : ''}`);
          console.log('─'.repeat(50));
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // list subcommand
  command
    .command('list')
    .description('List memory entries')
    .option('-n, --namespace <namespace>', 'Filter by namespace')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .option('-o, --offset <number>', 'Offset for pagination', '0')
    .action((options) => {
      const { namespace, limit, offset } = options as {
        namespace?: string;
        limit: string;
        offset: string;
      };

      try {
        const config = getConfig();
        const memory = getMemoryManager(config);

        const entries = memory.list(namespace, parseInt(limit, 10), parseInt(offset, 10));
        const total = memory.count(namespace);

        if (entries.length === 0) {
          console.log('No entries found.');
          return;
        }

        console.log(`Entries (${entries.length} of ${total}):\n`);
        console.log('Key                                    Namespace     Updated');
        console.log('─'.repeat(80));

        for (const entry of entries) {
          const key = entry.key.length > 35 ? entry.key.slice(0, 32) + '...' : entry.key;
          console.log(
            `${key.padEnd(40)} ${entry.namespace.padEnd(14)} ${entry.updatedAt.toISOString().slice(0, 19)}`
          );
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // delete subcommand
  command
    .command('delete')
    .description('Delete a memory entry')
    .requiredOption('-k, --key <key>', 'Key to delete')
    .option('-n, --namespace <namespace>', 'Namespace')
    .action((options) => {
      const { key, namespace } = options as { key: string; namespace?: string };

      try {
        const config = getConfig();
        const memory = getMemoryManager(config);

        const deleted = memory.delete(key, namespace);

        if (deleted) {
          console.log('Entry deleted successfully.');
        } else {
          console.log('Entry not found.');
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // stats subcommand
  command
    .command('stats')
    .description('Show memory statistics')
    .option('-n, --namespace <namespace>', 'Filter by namespace')
    .action((options) => {
      const { namespace } = options as { namespace?: string };

      try {
        const config = getConfig();
        const memory = getMemoryManager(config);

        const total = memory.count(namespace);
        const vectorStats = memory.getVectorStats(namespace);

        console.log('Memory statistics:\n');
        console.log(`  Total entries:     ${total}`);
        console.log(`  Vector indexed:    ${vectorStats.indexed}`);
        console.log(`  Vector coverage:   ${vectorStats.coverage}%`);
        console.log(`  Vector enabled:    ${config.memory.vectorSearch.enabled ? 'yes' : 'no'}`);
        if (namespace) {
          console.log(`  Namespace filter:  ${namespace}`);
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  return command;
}
