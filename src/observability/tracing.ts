/**
 * OpenTelemetry tracing helpers.
 *
 * Tracing is opt-in via `observability.tracing.enabled`. When disabled these
 * helpers execute callbacks directly, so call sites can stay instrumentation
 * ready without changing runtime behaviour.
 */

import {
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ConsoleSpanExporter,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import type { AgentStackConfig, TracingConfig } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('tracing');
const TRACER_NAME = 'aistack';

let sdk: NodeSDK | null = null;
let sdkStarted = false;
let shutdownRegistered = false;

export type SpanAttributeInput =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

export type SpanAttributeRecord = Record<string, SpanAttributeInput>;

export function isTracingEnabled(config?: AgentStackConfig): boolean {
  return config?.observability?.tracing?.enabled === true;
}

export function sanitizeSpanAttributes(attributes?: SpanAttributeRecord): Attributes {
  const sanitized: Attributes = {};

  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === undefined || value === null) continue;
    sanitized[key] = value instanceof Date ? value.toISOString() : value;
  }

  return sanitized;
}

function resolveTracingConfig(config: AgentStackConfig): TracingConfig {
  return {
    enabled: config.observability?.tracing?.enabled ?? false,
    serviceName: config.observability?.tracing?.serviceName ?? 'aistack',
    serviceVersion: config.observability?.tracing?.serviceVersion ?? config.version,
    exporter: config.observability?.tracing?.exporter ?? 'otlp',
    otlpEndpoint: config.observability?.tracing?.otlpEndpoint,
    headers: config.observability?.tracing?.headers,
    samplingRatio: config.observability?.tracing?.samplingRatio ?? 1,
  };
}

function createSpanExporter(config: TracingConfig): SpanExporter {
  if (config.exporter === 'console') {
    return new ConsoleSpanExporter();
  }

  const exporterOptions: ConstructorParameters<typeof OTLPTraceExporter>[0] = {};
  if (config.otlpEndpoint) {
    exporterOptions.url = config.otlpEndpoint;
  }
  if (config.headers) {
    exporterOptions.headers = config.headers;
  }

  return new OTLPTraceExporter(exporterOptions);
}

export function initializeTracing(config: AgentStackConfig): boolean {
  if (!isTracingEnabled(config)) {
    return false;
  }
  if (sdkStarted) {
    return true;
  }

  const tracing = resolveTracingConfig(config);
  const serviceAttributes: Attributes = {
    'service.name': tracing.serviceName ?? 'aistack',
    'service.version': tracing.serviceVersion ?? config.version,
  };

  sdk = new NodeSDK({
    serviceName: tracing.serviceName,
    resource: resourceFromAttributes(serviceAttributes),
    traceExporter: createSpanExporter(tracing),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(tracing.samplingRatio ?? 1),
    }),
  });

  sdk.start();
  sdkStarted = true;
  log.info('OpenTelemetry tracing initialized', {
    serviceName: tracing.serviceName,
    exporter: tracing.exporter ?? 'otlp',
    otlpEndpoint: tracing.otlpEndpoint,
  });

  if (!shutdownRegistered) {
    shutdownRegistered = true;
    process.once('beforeExit', () => {
      void shutdownTracing();
    });
  }

  return true;
}

export async function shutdownTracing(): Promise<void> {
  if (!sdkStarted || !sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (error) {
    log.warn('Failed to shutdown OpenTelemetry SDK cleanly', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    sdk = null;
    sdkStarted = false;
  }
}

function recordSpanError(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }

  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
}

export async function traceAsync<T>(
  config: AgentStackConfig | undefined,
  name: string,
  attributes: SpanAttributeRecord | undefined,
  fn: (span: Span | undefined) => Promise<T>
): Promise<T> {
  if (!config || !initializeTracing(config)) {
    return fn(undefined);
  }

  const tracer = trace.getTracer(TRACER_NAME, config.version);
  const span = tracer.startSpan(name, { attributes: sanitizeSpanAttributes(attributes) });
  const spanContext = trace.setSpan(context.active(), span);

  return context.with(spanContext, async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function traceSync<T>(
  config: AgentStackConfig | undefined,
  name: string,
  attributes: SpanAttributeRecord | undefined,
  fn: (span: Span | undefined) => T
): T {
  if (!config || !initializeTracing(config)) {
    return fn(undefined);
  }

  const tracer = trace.getTracer(TRACER_NAME, config.version);
  const span = tracer.startSpan(name, { attributes: sanitizeSpanAttributes(attributes) });
  const spanContext = trace.setSpan(context.active(), span);

  return context.with(spanContext, () => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}
