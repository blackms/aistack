/**
 * Pluggable notifier for HITL interrupts.
 *
 * Each registered sink receives a serialized InterruptRecord when a new
 * interrupt is created. Built-in sinks: `console`, `slack` (best-effort,
 * no-op when slack integration is not configured), `webhook` (HTTP POST to
 * a configured URL).
 *
 * Designed as a thin publisher so additional sinks (PagerDuty, Discord,
 * email) can be added without touching the core interrupt store.
 */

import type { InterruptNotifyChannel, InterruptRecord } from './interrupt-types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('interrupt-notifier');

export interface NotifierSink {
  readonly channel: InterruptNotifyChannel | string;
  /** Returns a Promise that resolves when the notification has been delivered. Failures are logged but never propagated. */
  send(record: InterruptRecord): Promise<void>;
}

export interface WebhookSinkOptions {
  url: string;
  headers?: Record<string, string>;
}

export class ConsoleSink implements NotifierSink {
  readonly channel = 'console' as const;
  async send(record: InterruptRecord): Promise<void> {
    // Use a structured single-line log so it parses well in JSON sinks.
    log.info('[HITL] interrupt pending', {
      id: record.id,
      sessionId: record.sessionId,
      workflowId: record.workflowId,
      prompt: record.prompt,
    });
    // Also print to stderr for human operators tailing the CLI.
    process.stderr.write(
      `\n[HITL] interrupt ${record.id} on session ${record.sessionId}\n  prompt: ${record.prompt}\n  resume with: aistack workflow resume ${record.sessionId} --input='<value>'\n`
    );
  }
}

export class WebhookSink implements NotifierSink {
  readonly channel = 'webhook' as const;
  constructor(private readonly options: WebhookSinkOptions) {}

  async send(record: InterruptRecord): Promise<void> {
    try {
      // Node 20+ has global fetch.
      const res = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.headers ?? {}),
        },
        body: JSON.stringify({ event: 'interrupt.pending', record }),
      });
      if (!res.ok) {
        log.warn('Webhook notifier received non-2xx', {
          url: this.options.url,
          status: res.status,
        });
      }
    } catch (err) {
      log.error('Webhook notifier failed', { err, url: this.options.url });
    }
  }
}

/**
 * Slack sink that lazily resolves the integration to avoid a hard import
 * cycle. When slack is not configured, send() is a no-op.
 */
export class SlackSink implements NotifierSink {
  readonly channel = 'slack' as const;
  constructor(private readonly send_?: (record: InterruptRecord) => Promise<void>) {}

  async send(record: InterruptRecord): Promise<void> {
    if (!this.send_) {
      log.debug('Slack sink configured but no sender bound; skipping', { id: record.id });
      return;
    }
    try {
      await this.send_(record);
    } catch (err) {
      log.error('Slack notifier failed', { err, id: record.id });
    }
  }
}

export class InterruptNotifier {
  private sinks = new Map<string, NotifierSink>();

  register(sink: NotifierSink): void {
    this.sinks.set(sink.channel, sink);
  }

  unregister(channel: string): void {
    this.sinks.delete(channel);
  }

  has(channel: string): boolean {
    return this.sinks.has(channel);
  }

  /**
   * Fan-out a notification to the channels requested by the interrupt
   * record. Unknown channels are silently skipped (logged at debug).
   * Failures in individual sinks are logged but never throw.
   */
  async notify(record: InterruptRecord): Promise<void> {
    const channels = record.notify.length > 0 ? record.notify : ['console'];
    await Promise.all(
      channels.map(async (channel) => {
        const sink = this.sinks.get(channel);
        if (!sink) {
          log.debug('No sink registered for channel', { channel, id: record.id });
          return;
        }
        await sink.send(record);
      })
    );
  }
}

let defaultNotifier: InterruptNotifier | null = null;

export function getInterruptNotifier(): InterruptNotifier {
  if (!defaultNotifier) {
    defaultNotifier = new InterruptNotifier();
    defaultNotifier.register(new ConsoleSink());
  }
  return defaultNotifier;
}

/** Test helper: reset the singleton so tests can register their own sinks. */
export function resetInterruptNotifier(): void {
  defaultNotifier = null;
}
