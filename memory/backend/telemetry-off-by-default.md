# Metrics and span export are off by default

Decided 2026-10-24.

**Decision:** vizd serves `GET /metrics` only with `VIZ_METRICS=true`, and installs a tracer provider only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Jaeger in `backend/compose.yaml` is behind the `tracing` profile, so `make dev` doesn't start it.

**Why:** the owner asked for both to be optional. Without an endpoint the global tracer stays OpenTelemetry's no-op one: no spans, no IDs in logs, no cost. Metrics are still recorded in-process; only the route is off, and `vizd_jobs_queued` queries MySQL only when scraped.

**How to apply:** don't turn either on by default or add Jaeger to the default services. `traceparent` is written by `propagation.TraceContext{}` directly, not the global propagator, so it works whenever a provider is installed.
