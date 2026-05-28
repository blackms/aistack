/**
 * federation command - join/leave/status/peers for multi-machine federation.
 *
 * The command operates against an in-process FederationManager built from
 * the active aistack config. `join` runs the manager until SIGINT (so the
 * node can be addressed by peers); `status` and `peers` consult a
 * one-shot manager that only inspects discovery + static peers without
 * starting the server.
 */

import { Command } from 'commander';
import { getConfig } from '../../utils/config.js';
import {
  createFederation,
  FederationManager,
  type FederationConfig,
} from '../../federation/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('cli:federation');

function readFederationConfig(): FederationConfig {
  const cfg = getConfig() as ReturnType<typeof getConfig> & { federation?: FederationConfig };
  return (
    cfg.federation ?? {
      enabled: false,
      discoveryMethod: 'static',
      advertise: false,
      peers: [],
      routingPolicy: 'least-loaded',
    }
  );
}

export function createFederationCommand(): Command {
  const command = new Command('federation').description('Manage multi-machine federation');

  // join
  command
    .command('join')
    .description('Join the federation and keep the node running until SIGINT')
    .option('--port <port>', 'Override bindPort')
    .option('--advertise', 'Force advertise=true regardless of config')
    .action(async (options: { port?: string; advertise?: boolean }) => {
      const cfg = readFederationConfig();
      if (options.port) cfg.bindPort = Number.parseInt(options.port, 10);
      if (options.advertise) cfg.advertise = true;
      cfg.enabled = true;

      const fed = createFederation(cfg);
      try {
        await fed.join();
        const status = fed.status();
        console.log('Joined federation:');
        console.log(`  nodeId:      ${status.nodeId}`);
        console.log(`  name:        ${status.name}`);
        console.log(`  address:     ${status.address}`);
        console.log(`  discovery:   ${status.discoveryMethod}`);
        console.log('Press Ctrl+C to leave.');
      } catch (err) {
        console.error(`Failed to join federation: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      const shutdown = async (): Promise<void> => {
        log.info('Caught SIGINT - leaving federation');
        try {
          await fed.leave();
        } finally {
          process.exit(0);
        }
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());

      // Keep alive
      await new Promise<void>(() => undefined);
    });

  // leave
  command
    .command('leave')
    .description('Leave the federation (signals the local node to stop)')
    .action(() => {
      // The join process is a foreground command; leave is a hint to the
      // operator. We document the SIGINT path here.
      console.log(
        'To leave the federation, send SIGINT (Ctrl+C) to the `aistack federation join` process.'
      );
    });

  // status
  command
    .command('status')
    .description('Show federation status (does not start the server)')
    .action(async () => {
      const cfg = readFederationConfig();
      const fed: FederationManager = createFederation(cfg);
      const status = fed.status();
      console.log('Federation status:');
      console.log(`  enabled:     ${status.enabled}`);
      console.log(`  nodeId:      ${status.nodeId}`);
      console.log(`  name:        ${status.name}`);
      console.log(`  address:     ${status.address}`);
      console.log(`  discovery:   ${status.discoveryMethod}`);
      console.log(`  knownPeers:  ${status.peers.length}`);
    });

  // peers
  command
    .command('peers')
    .description('List statically configured peers')
    .action(() => {
      const cfg = readFederationConfig();
      if (cfg.peers.length === 0) {
        console.log('No static peers configured.');
        return;
      }
      console.log('Static peers:');
      for (const p of cfg.peers) {
        console.log(`  - ${p}`);
      }
    });

  return command;
}
