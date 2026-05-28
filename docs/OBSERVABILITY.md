# Observability

aistack supports OpenTelemetry tracing for the core orchestration path. Tracing
is disabled by default and must be explicitly enabled in `aistack.config.json`.

## What Is Traced

When enabled, aistack emits spans for:

- Agent lifecycle: `aistack.agent.spawn`, `aistack.agent.execute`
- Agent handoff/task assignment: `aistack.agent.handoff`
- LLM calls: `aistack.llm.chat`
- MCP tool calls: `aistack.mcp.tool`
- Review loop phases: `aistack.review_loop.start`,
  `aistack.review_loop.generate_code`, `aistack.review_loop.review`,
  `aistack.review_loop.fix_code`
- Memory operations: `aistack.memory.store`, `aistack.memory.search`
- Consensus gates: `aistack.consensus.check`,
  `aistack.consensus.checkpoint`, `aistack.consensus.decision`

Span attributes include IDs and operational metadata such as `agent.id`,
`agent.type`, `session.id`, `llm.provider`, token counts when available, MCP
tool name, review verdict, issue count, memory namespace, memory result counts,
consensus status, and duration. Prompts, generated code, task input, memory
content, search queries, tool payloads, secrets, and full error stack traces are
not added as span attributes.

## Enable OTLP Export

```json
{
  "observability": {
    "otel": {
      "enabled": true,
      "serviceName": "aistack",
      "serviceVersion": "1.6.1",
      "exporter": "otlp",
      "endpoint": "http://localhost:4318/v1/traces",
      "samplingRatio": 1
    }
  }
}
```

`endpoint` is optional. If omitted, the OpenTelemetry exporter uses its
standard environment defaults, including `OTEL_EXPORTER_OTLP_ENDPOINT`.
`observability.tracing.otlpEndpoint` is also accepted for callers that prefer a
backend-agnostic tracing block.

Static OTLP headers can be configured for self-hosted collectors:

```json
{
  "observability": {
    "otel": {
      "enabled": true,
      "headers": {
        "authorization": "${OTEL_AUTH_HEADER}"
      }
    }
  }
}
```

Environment interpolation is handled by the existing config loader, so missing
variables fail fast.

## Local Debugging

Use the console exporter when validating spans locally without a collector:

```json
{
  "observability": {
    "otel": {
      "enabled": true,
      "exporter": "console"
    }
  }
}
```

## Local Jaeger

Run Jaeger with OTLP/HTTP enabled:

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:1.57
    ports:
      - "16686:16686"
      - "4318:4318"
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
```

Then configure:

```json
{
  "observability": {
    "otel": {
      "enabled": true,
      "endpoint": "http://localhost:4318/v1/traces"
    }
  }
}
```

Open `http://localhost:16686` and select the `aistack` service.

## Backend Examples

Honeycomb OTLP/HTTP:

```json
{
  "observability": {
    "otel": {
      "enabled": true,
      "endpoint": "https://api.honeycomb.io/v1/traces",
      "headers": {
        "x-honeycomb-team": "${HONEYCOMB_API_KEY}",
        "x-honeycomb-dataset": "aistack"
      }
    }
  }
}
```

Datadog Agent OTLP/HTTP:

```json
{
  "observability": {
    "otel": {
      "enabled": true,
      "endpoint": "http://localhost:4318/v1/traces",
      "serviceName": "aistack"
    }
  }
}
```

Phoenix local collector:

```bash
docker run --rm -p 6006:6006 -p 4318:4318 arizephoenix/phoenix:latest
```

```json
{
  "observability": {
    "otel": {
      "enabled": true,
      "endpoint": "http://localhost:4318/v1/traces",
      "serviceName": "aistack"
    }
  }
}
```

For Jaeger-compatible local setups, run an OpenTelemetry Collector or Jaeger
with OTLP/HTTP enabled on port `4318`, then set:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Privacy Notes

Tracing is operational telemetry, not product analytics. It stays within the
collector configured by the operator. aistack intentionally records structured
metadata only: no source code, task input, LLM output, API keys, or credentials
are attached to spans by the built-in instrumentation.
