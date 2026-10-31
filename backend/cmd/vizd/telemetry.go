package main

import (
	"context"
	"fmt"
	"log/slog"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// spanHandler adds the OpenTelemetry trace and span IDs of a record's context, so a log line leads to its trace.
type spanHandler struct {
	slog.Handler
}

func (h spanHandler) Handle(ctx context.Context, r slog.Record) error {
	if sc := oteltrace.SpanContextFromContext(ctx); sc.IsValid() {
		r.AddAttrs(slog.String("otel_trace_id", sc.TraceID().String()), slog.String("otel_span_id", sc.SpanID().String()))
	}
	return h.Handler.Handle(ctx, r)
}

func (h spanHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return spanHandler{h.Handler.WithAttrs(attrs)}
}

func (h spanHandler) WithGroup(name string) slog.Handler {
	return spanHandler{h.Handler.WithGroup(name)}
}

// startTracing exports spans over OTLP/HTTP when endpoint is set, and does nothing otherwise. The exporter reads the
// other OTEL_EXPORTER_OTLP_* variables itself. The func it returns flushes the spans not yet sent.
func startTracing(ctx context.Context, role, endpoint string) (func(context.Context) error, error) {
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		attribute.String("service.name", "vizd"),
		attribute.String("vizd.role", role),
	))
	if err != nil {
		return nil, fmt.Errorf("tracing resource: %w", err)
	}
	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("otlp exporter: %w", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithResource(res), sdktrace.WithBatcher(exp))
	otel.SetTracerProvider(tp)
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		slog.WarnContext(ctx, "export spans", "err", err)
	}))
	return tp.Shutdown, nil
}
