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
import { createRequire } from 'node:module';
import type { NodeSDK as NodeSDKType } from '@opentelemetry/sdk-node';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { AgentStackConfig, TracingConfig } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('tracing');
const TRACER_NAME = 'aistack';
const require = createRequire(import.meta.url);

type OpenTelemetryModules = {
  OTLPTraceExporter: typeof import('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter;
  resourceFromAttributes: typeof import('@opentelemetry/resources').resourceFromAttributes;
  NodeSDK: typeof import('@opentelemetry/sdk-node').NodeSDK;
  ConsoleSpanExporter: typeof import('@opentelemetry/sdk-trace-base').ConsoleSpanExporter;
  ParentBasedSampler: typeof import('@opentelemetry/sdk-trace-base').ParentBasedSampler;
  TraceIdRatioBasedSampler: typeof import('@opentelemetry/sdk-trace-base').TraceIdRatioBasedSampler;
};

let sdk: NodeSDKType | null = null;
let otelModules: OpenTelemetryModules | null = null;
let sdkStarted = false;
let shutdownRegistered = false;
let tracingFailed = false;

export type SpanAttributeInput =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

export type SpanAttributeRecord = Record<string, SpanAttributeInput>;

export function isTracingEnabled(config?: AgentStackConfig): boolean {
  return config?.observability?.tracing?.enabled === true ||
    config?.observability?.otel?.enabled === true;
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
  const otel = config.observability?.otel;
  const tracing = {
    ...(otel ? { ...otel, otlpEndpoint: otel.otlpEndpoint ?? otel.endpoint } : {}),
    ...(config.observability?.tracing ?? {}),
  };

  return {
    enabled: tracing.enabled ?? false,
    serviceName: tracing.serviceName ?? 'aistack',
    serviceVersion: tracing.serviceVersion ?? config.version,
    exporter: tracing.exporter ?? 'otlp',
    otlpEndpoint: tracing.otlpEndpoint,
    headers: tracing.headers,
    samplingRatio: tracing.samplingRatio ?? 1,
  };
}

function loadOpenTelemetryModules(): OpenTelemetryModules {
  if (otelModules) {
    return otelModules;
  }

  const { OTLPTraceExporter } = require(
    '@opentelemetry/exporter-trace-otlp-http'
  ) as typeof import('@opentelemetry/exporter-trace-otlp-http');
  const { resourceFromAttributes } = require(
    '@opentelemetry/resources'
  ) as typeof import('@opentelemetry/resources');
  const { NodeSDK } = require(
    '@opentelemetry/sdk-node'
  ) as typeof import('@opentelemetry/sdk-node');
  const {
    ConsoleSpanExporter,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
  } = require('@opentelemetry/sdk-trace-base') as typeof import('@opentelemetry/sdk-trace-base');

  otelModules = {
    OTLPTraceExporter,
    resourceFromAttributes,
    NodeSDK,
    ConsoleSpanExporter,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
  };
  return otelModules;
}

function createSpanExporter(
  config: TracingConfig,
  modules: OpenTelemetryModules
): SpanExporter {
  if (config.exporter === 'console') {
    return new modules.ConsoleSpanExporter();
  }

  const exporterOptions: ConstructorParameters<OpenTelemetryModules['OTLPTraceExporter']>[0] = {};
  if (config.otlpEndpoint) {
    exporterOptions.url = config.otlpEndpoint;
  }
  if (config.headers) {
    exporterOptions.headers = config.headers;
  }

  return new modules.OTLPTraceExporter(exporterOptions);
}

export function initializeTracing(config: AgentStackConfig): boolean {
  if (!isTracingEnabled(config)) {
    return false;
  }
  if (tracingFailed) {
    return false;
  }
  if (sdkStarted) {
    return true;
  }

  let nextSdk: NodeSDKType | null = null;
  try {
    const modules = loadOpenTelemetryModules();
    const tracing = resolveTracingConfig(config);
    const serviceAttributes: Attributes = {
      'service.name': tracing.serviceName ?? 'aistack',
      'service.version': tracing.serviceVersion ?? config.version,
    };

    nextSdk = new modules.NodeSDK({
      serviceName: tracing.serviceName,
      resource: modules.resourceFromAttributes(serviceAttributes),
      traceExporter: createSpanExporter(tracing, modules),
      sampler: new modules.ParentBasedSampler({
        root: new modules.TraceIdRatioBasedSampler(tracing.samplingRatio ?? 1),
      }),
    });

    nextSdk.start();
    sdk = nextSdk;
    sdkStarted = true;
    log.info('OpenTelemetry tracing initialized', {
      serviceName: tracing.serviceName,
      exporter: tracing.exporter ?? 'otlp',
      otlpEndpoint: tracing.otlpEndpoint,
    });
  } catch (error) {
    sdk = null;
    sdkStarted = false;
    tracingFailed = true;
    log.error('Failed to initialize OpenTelemetry tracing', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (nextSdk) {
      void nextSdk.shutdown().catch((shutdownError: unknown) => {
        log.warn('Failed to shutdown partially initialized OpenTelemetry SDK', {
          error: shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
        });
      });
    }

    return false;
  }

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
