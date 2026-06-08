/**
 * Optional OTel SpanProcessor adapter (AIG-867) — secondary attribution path.
 *
 * Today aistack does NOT wire an in-process SpanProcessor: spans produced by
 * `traceAsync` go straight to the OTLP exporter (see src/observability/tracing.ts).
 * The PRIMARY spend-attribution path is therefore in-code at the spawner call
 * site (governanceService.recordSpend after the `aistack.llm.chat` span), which
 * is the single point where `llm.usage.*` is known.
 *
 * This adapter is provided for completeness: if a deployment ever registers an
 * in-process SpanProcessor, it can convert `aistack.llm.chat` spans into spend
 * records too. To avoid DOUBLE COUNTING it must be MUTUALLY EXCLUSIVE with the
 * in-code path — register at most one of them. It is NOT wired by default.
 *
 * The adapter is typed structurally so it has no hard dependency on the OTel SDK
 * surface; it is compatible with `@opentelemetry/sdk-trace-base`'s SpanProcessor.
 */

import type { AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { getGovernanceService } from './index.js';

const log = logger.child('governance:span');

/** Minimal structural view of a finished OTel span. */
interface ReadableSpanLike {
  name: string;
  attributes: Record<string, unknown>;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * SpanProcessor that converts `aistack.llm.chat` spans into spend records.
 * Implements the OTel SpanProcessor contract structurally (onStart/onEnd/
 * shutdown/forceFlush).
 */
export class GovernanceSpanProcessor {
  constructor(private readonly config: AgentStackConfig) {}

  onStart(): void {
    // no-op
  }

  onEnd(span: ReadableSpanLike): void {
    if (span.name !== 'aistack.llm.chat') return;
    const service = getGovernanceService(this.config);
    if (!service?.isEnabled()) return;

    const attrs = span.attributes;
    const inputTokens = num(attrs['llm.usage.input_tokens']);
    const outputTokens = num(attrs['llm.usage.output_tokens']);
    if (!inputTokens && !outputTokens) return;

    try {
      service.recordSpend({
        inputTokens,
        outputTokens,
        provider: str(attrs['llm.provider']) ?? 'unknown',
        model:
          str(attrs['llm.response.model']) ??
          str(attrs['llm.request.model']) ??
          'unknown',
        agentType: str(attrs['agent.type']),
        tenantId: str(attrs['tenant.id']),
        workspaceId: str(attrs['workspace.id']),
      });
    } catch (err) {
      log.warn('Span->spend conversion failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async forceFlush(): Promise<void> {
    // spend is written synchronously on onEnd; nothing to flush.
  }

  async shutdown(): Promise<void> {
    // no resources to release.
  }
}
