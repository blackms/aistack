/**
 * `aistack agent-portable` — export / import / convert portable agent files.
 *
 * Three sub-commands:
 *   export   Write a `.aistack-agent` snapshot for a spawned identity or a
 *            built-in agent type template.
 *   import   Restore a `.aistack-agent` (or compatible Letta `.af`) into the
 *            local installation.
 *   inspect  Validate and pretty-print bundle metadata without importing.
 *
 * Kept separate from `agent.ts` (which already has many sub-commands) to
 * minimise merge risk with parallel feature branches.
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getConfig } from '../../utils/config.js';
import {
  exportAgent,
  exportAgentByType,
  importAgent,
  importLettaAf,
  serialize as serializePortable,
} from '../../agents/portable.js';
import {
  readBundle,
  writeBundle,
  type BundleFormat,
} from '../../agents/portable-bundle.js';
import type { PortableAgentFile } from '../../agents/portable-schema.js';

export function createAgentPortableCommand(): Command {
  const command = new Command('agent-portable')
    .description('Export, import, and inspect portable .aistack-agent files')
    .alias('portable');

  // ---- export ----------------------------------------------------------
  command
    .command('export')
    .description('Export an agent (by identity id or type template) to a .aistack-agent file')
    .option('-i, --id <identityId>', 'Spawned-agent identity UUID')
    .option('-t, --type <type>', 'Built-in agent type (template export — no memory)')
    .option('-o, --out <path>', 'Output path (default: stdout)')
    .option('--no-memory', 'Strip memory entries from the bundle')
    .option('--format <format>', 'Output format: json|tgz', 'json')
    .option('--label <label...>', 'Add free-form labels to metadata')
    .action(async (options) => {
      const opts = options as {
        id?: string;
        type?: string;
        out?: string;
        memory: boolean; // commander negates --no-memory
        format: string;
        label?: string[];
      };

      if (!opts.id && !opts.type) {
        console.error('Error: --id <identityId> or --type <agentType> is required');
        process.exit(1);
      }
      if (opts.id && opts.type) {
        console.error('Error: --id and --type are mutually exclusive');
        process.exit(1);
      }

      const format = parseBundleFormat(opts.format);
      if (!format) {
        console.error(`Error: invalid --format '${opts.format}' (expected json|tgz)`);
        process.exit(1);
      }

      try {
        let file: PortableAgentFile;
        if (opts.id) {
          const config = getConfig();
          file = exportAgent(opts.id, config, {
            noMemory: !opts.memory,
            labels: opts.label,
          });
        } else {
          file = exportAgentByType(opts.type!, {
            noMemory: true, // type templates never carry memory
            labels: opts.label,
          });
        }

        if (opts.out) {
          const path = resolve(opts.out);
          await writeBundle(path, file, format);
          console.error(`Wrote ${path} (${format})`);
        } else {
          // stdout: only the json form makes sense (binary on stdout is hostile)
          if (format !== 'json') {
            console.error('Error: --format tgz requires --out <path>');
            process.exit(1);
          }
          process.stdout.write(serializePortable(file) + '\n');
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // ---- import ----------------------------------------------------------
  command
    .command('import')
    .description('Import a .aistack-agent file (or a Letta .af with --letta)')
    .argument('<file>', 'Path to the bundle to import')
    .option('--rename <name>', 'Override the imported agent display name')
    .option('--no-memory', 'Do not restore memory entries')
    .option('--new-identity', 'Allocate a fresh identity id even if the bundle has one')
    .option('--letta', 'Treat the input as a Letta .af and run best-effort conversion')
    .action(async (filePath: string, options) => {
      const opts = options as {
        rename?: string;
        memory: boolean;
        newIdentity?: boolean;
        letta?: boolean;
      };

      try {
        const config = getConfig();
        let portable: PortableAgentFile;
        if (opts.letta) {
          const raw = JSON.parse(await readFile(resolve(filePath), 'utf-8')) as unknown;
          portable = importLettaAf(raw);
        } else {
          portable = await readBundle(resolve(filePath));
        }

        const result = await importAgent(portable, config, {
          rename: opts.rename,
          noMemory: !opts.memory,
          newIdentity: opts.newIdentity,
        });

        console.log(`Imported agent '${result.agentName}' (${result.agentType})`);
        console.log(`  identity: ${result.identityId}`);
        console.log(`  memory entries: ${result.importedEntries}`);
        if (result.warnings.length > 0) {
          console.log(`  warnings:`);
          for (const w of result.warnings) {
            console.log(`    - ${w}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // ---- inspect ---------------------------------------------------------
  command
    .command('inspect')
    .description('Validate and pretty-print bundle metadata without importing')
    .argument('<file>', 'Path to the bundle to inspect')
    .option('--letta', 'Parse as Letta .af (after conversion)')
    .action(async (filePath: string, options) => {
      const opts = options as { letta?: boolean };
      try {
        let portable: PortableAgentFile;
        if (opts.letta) {
          const raw = JSON.parse(await readFile(resolve(filePath), 'utf-8')) as unknown;
          portable = importLettaAf(raw);
        } else {
          portable = await readBundle(resolve(filePath));
        }
        console.log('Portable agent file:');
        console.log(`  format:        ${portable.format_version}`);
        console.log(`  agent.type:    ${portable.agent.type}`);
        console.log(`  agent.name:    ${portable.agent.name}`);
        console.log(`  identity_id:   ${portable.agent.identity_id ?? '<none>'}`);
        console.log(`  memory:        ${portable.memory_snapshot.entries_count} entries`);
        console.log(`  exported_at:   ${portable.metadata.exported_at}`);
        console.log(`  exporter:      ${portable.metadata.exporter}`);
        if (portable.metadata.labels && portable.metadata.labels.length > 0) {
          console.log(`  labels:        ${portable.metadata.labels.join(', ')}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // ---- convert (json <-> string for piping) ----------------------------
  command
    .command('convert')
    .description('Read a Letta .af from stdin, emit a .aistack-agent JSON on stdout')
    .action(async () => {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) {
        chunks.push(c as Buffer);
      }
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        const raw = JSON.parse(text) as unknown;
        const portable = importLettaAf(raw);
        process.stdout.write(serializePortable(portable) + '\n');
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  return command;
}

function parseBundleFormat(value: string): BundleFormat | null {
  if (value === 'json' || value === 'tgz') {
    return value;
  }
  return null;
}

