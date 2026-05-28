/**
 * audit command — operate on the hash-chained audit log (AIG-635)
 *
 * Sub-commands:
 *   - export   stream entries as JSONL (or CSV) for evidence packs
 *   - verify   recompute hashes and (optionally) HMAC signatures end-to-end
 *   - status   summary: count, latest seq/hash, signed mode
 */

import { Command } from 'commander';
import { createWriteStream } from 'node:fs';
import { getConfig } from '../../utils/config.js';
import { getAuditChain } from '../../audit/index.js';
import type { AuditEntry } from '../../audit/index.js';

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function entryToCsvRow(e: AuditEntry): string {
  return [
    e.seq,
    e.createdAt.toISOString(),
    e.eventType,
    e.prevHash,
    e.hash,
    e.signatureAlg ?? '',
    e.signature ?? '',
    csvEscape(JSON.stringify(e.payload)),
  ].join(',');
}

export function createAuditCommand(): Command {
  const command = new Command('audit').description('Hash-chained audit log operations');

  command
    .command('export')
    .description('Export audit entries as JSONL or CSV (evidence pack)')
    .option('--since <iso>', 'Only entries created on/after this ISO-8601 timestamp')
    .option('--until <iso>', 'Only entries created on/before this ISO-8601 timestamp')
    .option('-f, --format <fmt>', 'Output format: jsonl | csv', 'jsonl')
    .option('-o, --output <path>', 'Write to file instead of stdout')
    .action(async (options: { since?: string; until?: string; format: string; output?: string }) => {
      const config = getConfig();
      const chain = getAuditChain(config);
      if (!chain) {
        console.error('Audit log is disabled. Enable with config.audit.enabled = true.');
        process.exit(1);
      }

      const sinceMs = options.since ? Date.parse(options.since) : undefined;
      const untilMs = options.until ? Date.parse(options.until) : undefined;
      if (options.since && Number.isNaN(sinceMs)) {
        console.error(`Invalid --since timestamp: ${options.since}`);
        process.exit(1);
      }
      if (options.until && Number.isNaN(untilMs)) {
        console.error(`Invalid --until timestamp: ${options.until}`);
        process.exit(1);
      }

      const fmt = options.format.toLowerCase();
      if (fmt !== 'jsonl' && fmt !== 'csv') {
        console.error(`Unsupported format: ${options.format} (use jsonl or csv)`);
        process.exit(1);
      }

      const out = options.output ? createWriteStream(options.output, { encoding: 'utf8' }) : process.stdout;
      const writeLine = (line: string): void => {
        out.write(line + '\n');
      };

      if (fmt === 'csv') {
        writeLine('seq,created_at,event_type,prev_hash,hash,signature_alg,signature,payload_json');
      }

      let count = 0;
      for await (const entry of chain.export({ sinceMs, untilMs })) {
        if (fmt === 'jsonl') {
          writeLine(
            JSON.stringify({
              seq: entry.seq,
              createdAt: entry.createdAt.toISOString(),
              eventType: entry.eventType,
              prevHash: entry.prevHash,
              hash: entry.hash,
              signatureAlg: entry.signatureAlg,
              signature: entry.signature,
              payload: entry.payload,
            }),
          );
        } else {
          writeLine(entryToCsvRow(entry));
        }
        count += 1;
      }

      if (options.output) {
        out.end();
        console.error(`Exported ${count} entries to ${options.output}`);
      } else {
        console.error(`Exported ${count} entries`);
      }
    });

  command
    .command('verify')
    .description('Verify chain integrity (and HMAC signatures if signed)')
    .option('--from-seq <n>', 'Start sequence (inclusive)', (v) => Number(v))
    .option('--to-seq <n>', 'End sequence (inclusive)', (v) => Number(v))
    .action((options: { fromSeq?: number; toSeq?: number }) => {
      const config = getConfig();
      const chain = getAuditChain(config);
      if (!chain) {
        console.error('Audit log is disabled. Enable with config.audit.enabled = true.');
        process.exit(1);
      }

      const result = chain.verify({ fromSeq: options.fromSeq, toSeq: options.toSeq });
      if (result.valid) {
        console.log(
          `OK: chain valid (${result.entriesChecked} entries verified${chain.isSigned() ? ', HMAC-SHA256 signed' : ', unsigned'})`,
        );
        process.exit(0);
      } else {
        console.error(
          `FAIL: chain broken${result.brokenAt !== undefined ? ` at seq=${result.brokenAt}` : ''}: ${result.reason ?? 'unknown reason'}`,
        );
        console.error(`(entries verified before failure: ${result.entriesChecked})`);
        process.exit(2);
      }
    });

  command
    .command('status')
    .description('Show audit chain summary')
    .action(() => {
      const config = getConfig();
      const chain = getAuditChain(config);
      if (!chain) {
        console.log('Audit log: disabled');
        return;
      }
      const latest = chain.latest();
      console.log(`Audit log: enabled (${chain.isSigned() ? 'HMAC-SHA256 signed' : 'unsigned'})`);
      console.log(`Entries:   ${chain.count()}`);
      if (latest) {
        console.log(`Latest:    seq=${latest.seq} type=${latest.eventType} at ${latest.createdAt.toISOString()}`);
        console.log(`           hash=${latest.hash}`);
      }
    });

  return command;
}
