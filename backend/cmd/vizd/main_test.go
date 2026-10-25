package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/google/go-cmp/cmp"
	oteltrace "go.opentelemetry.io/otel/trace"
)

func TestPickSandbox(t *testing.T) {
	tests := []struct {
		name    string
		vizEnv  string
		sandbox string
		want    string
	}{
		{"dev defaults to docker", "dev", "", "docker"},
		{"dev allows docker", "dev", "docker", "docker"},
		{"test allows docker", "test", "docker", "docker"},
		{"staging refuses docker", "staging", "docker", ""},
		{"prod refuses docker", "prod", "docker", ""},
		{"prod allows nsjail", "prod", "nsjail", "nsjail"},
		{"runsc is refused", "prod", "runsc", ""},
		{"staging allows nsjail", "staging", "nsjail", "nsjail"},
		{"test requires a sandbox", "test", "", ""},
		{"prod requires a sandbox", "prod", "", ""},
		{"unknown sandbox is refused", "dev", "firecracker", ""},
		{"unknown env is refused", "production", "nsjail", ""},
		{"missing env is refused", "", "docker", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := pickSandbox(tc.vizEnv, tc.sandbox)
			if got != tc.want || (err == nil) != (tc.want != "") {
				t.Errorf("pickSandbox(%q, %q) = %q, %v; want %q", tc.vizEnv, tc.sandbox, got, err, tc.want)
			}
		})
	}
}

func TestLogsCarryTheSpanOfTheirContext(t *testing.T) {
	sc := oteltrace.NewSpanContext(oteltrace.SpanContextConfig{
		TraceID:    oteltrace.TraceID{1},
		SpanID:     oteltrace.SpanID{2},
		TraceFlags: oteltrace.FlagsSampled,
	})
	inSpan := oteltrace.ContextWithSpanContext(t.Context(), sc)
	tests := []struct {
		name string
		ctx  context.Context
		want map[string]string
	}{
		{"a record in a span gets its ids", inSpan, map[string]string{
			"msg": "hi", "job": "7", "otel_trace_id": sc.TraceID().String(), "otel_span_id": sc.SpanID().String(),
		}},
		{"a record outside a span gets none", t.Context(), map[string]string{"msg": "hi", "job": "7"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			log := slog.New(spanHandler{slog.NewJSONHandler(&out, &slog.HandlerOptions{
				ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
					if a.Key == slog.TimeKey || a.Key == slog.LevelKey {
						return slog.Attr{}
					}
					return a
				},
			})}).With("job", "7")
			log.InfoContext(tc.ctx, "hi")

			var got map[string]string
			if err := json.Unmarshal(out.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Errorf("record (-want +got):\n%s", diff)
			}
		})
	}
}
