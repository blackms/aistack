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

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InterruptNotifyChannel, InterruptRecord } from './interrupt-types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('interrupt-notifier');

/** Default request timeout for outbound webhooks, in milliseconds. */
const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Header name used to transport the HMAC-SHA256 signature of the request
 * body. Receivers verify with the same shared secret. Format: `sha256=<hex>`,
 * matching the convention popularised by GitHub webhooks.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'X-AIStack-Signature';

/**
 * Compute the canonical signature for a webhook body. Exported so tests and
 * receivers (in-tree integration adapters) can verify without duplicating
 * the format.
 */
export function signWebhookBody(secret: string, body: string): string {
  const mac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${mac}`;
}

/**
 * Constant-time signature comparison helper. Receivers should call this
 * rather than `===` to avoid timing leaks.
 */
export function verifyWebhookSignature(secret: string, body: string, header: string): boolean {
  const expected = signWebhookBody(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface NotifierSink {
  readonly channel: InterruptNotifyChannel | string;
  /** Returns a Promise that resolves when the notification has been delivered. Failures are logged but never propagated. */
  send(record: InterruptRecord): Promise<void>;
}

export interface WebhookSinkOptions {
  url: string;
  headers?: Record<string, string>;
  /**
   * Shared HMAC secret used to sign outgoing webhook bodies. When omitted,
   * the constructor falls back to the `AISTACK_WEBHOOK_SECRET` env var. If
   * neither is set, the sink refuses to send (logged + no-op) — unsigned
   * webhooks are not allowed because they can be spoofed by anyone able to
   * reach the receiver URL.
   */
  secret?: string;
  /** Per-request timeout in milliseconds. Defaults to 10s. */
  timeoutMs?: number;
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
      `\n[HITL] interrupt ${record.id} on session ${record.sessionId}\n  prompt: ${record.prompt}\n  resume with: aistack workflow resume-interrupt ${record.sessionId} --interrupt-id ${record.id} --input='<value>'\n`
    );
  }
}

export class WebhookSink implements NotifierSink {
  readonly channel = 'webhook' as const;
  private readonly secret: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: WebhookSinkOptions) {
    this.secret = options.secret ?? process.env.AISTACK_WEBHOOK_SECRET;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  }

  async send(record: InterruptRecord): Promise<void> {
    if (!this.secret) {
      // Refuse to send unsigned webhooks — they can be forged by anyone able
      // to POST to the receiver URL. Operator must configure a shared secret.
      log.warn('Webhook notifier disabled: no signing secret configured', {
        url: this.options.url,
        id: record.id,
        hint: 'set AISTACK_WEBHOOK_SECRET or pass options.secret',
      });
      return;
    }

    const body = JSON.stringify({ event: 'interrupt.pending', record });
    const signature = signWebhookBody(this.secret, body);

    // Bound the request so a slow/unreachable receiver cannot stall the
    // notifier (and, transitively, anything awaiting it) indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }

    try {
      // Node 20+ has global fetch.
      const res = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signature,
          ...(this.options.headers ?? {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        log.warn('Webhook notifier received non-2xx', {
          url: this.options.url,
          status: res.status,
        });
      }
    } catch (err) {
      const aborted = (err as { name?: string }).name === 'AbortError';
      log.error(aborted ? 'Webhook notifier timed out' : 'Webhook notifier failed', {
        err,
        url: this.options.url,
        timeoutMs: aborted ? this.timeoutMs : undefined,
      });
    } finally {
      clearTimeout(timer);
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
