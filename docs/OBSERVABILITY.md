# Observability

aistack supports OpenTelemetry tracing for the core orchestration path. Tracing
is disabled by default and must be explicitly enabled in `aistack.config.json`.

## What Is Traced

When enabled, aistack emits spans for:

- Agent lifecycle: `aistack.agent.spawn`, `aistack.agent.execute`
- LLM calls: `aistack.llm.chat`
- MCP tool calls: `aistack.mcp.tool`
- Review loop phases: `aistack.review_loop.start`,
  `aistack.review_loop.generate_code`, `aistack.review_loop.review`,
  `aistack.review_loop.fix_code`

Span attributes include IDs and operational metadata such as `agent.id`,
`agent.type`, `session.id`, `llm.provider`, token counts when available, MCP
tool name, review verdict, issue count, and duration. Prompts, generated code,
tool payloads, secrets, and full error stack traces are not added as span
attributes.

## Enable OTLP Export

```json
{
  "observability": {
    "tracing": {
      "enabled": true,
      "serviceName": "aistack",
      "serviceVersion": "1.6.1",
      "exporter": "otlp",
      "otlpEndpoint": "http://localhost:4318/v1/traces",
      "samplingRatio": 1
    }
  }
}
```

`otlpEndpoint` is optional. If omitted, the OpenTelemetry exporter uses its
standard environment defaults, including `OTEL_EXPORTER_OTLP_ENDPOINT`.

Static OTLP headers can be configured for self-hosted collectors:

```json
{
  "observability": {
    "tracing": {
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
    "tracing": {
      "enabled": true,
      "exporter": "console"
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
