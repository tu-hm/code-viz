package domain_test

import (
	"os"
	"testing"
	"time"

	"github.com/goccy/go-yaml"

	"github.com/tu-hm/code-viz/backend/internal/domain"
)

func TestRerunResetsOnlyTracesThatCannotServeACreate(t *testing.T) {
	expiry := time.Date(2026, 10, 31, 8, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		status      domain.TraceStatus
		failureKind string
		expired     bool
		want        bool
	}{
		{"queued is attached to", domain.TraceQueued, "", false, false},
		{"queued past its expiry keeps its live job", domain.TraceQueued, "", true, false},
		{"building is attached to", domain.TraceBuilding, "", false, false},
		{"tracing past its expiry keeps its live job", domain.TraceTracing, "", true, false},
		{"completed is a cache hit up to its expiry", domain.TraceCompleted, "", false, false},
		{"completed past its expiry runs again", domain.TraceCompleted, "", true, true},
		{"compile_error is a result to keep", domain.TraceFailed, "compile_error", false, false},
		{"unsupported_module is a result to keep", domain.TraceFailed, "unsupported_module", false, false},
		{"compile_error past its expiry runs again", domain.TraceFailed, "compile_error", true, true},
		{"internal_error runs again", domain.TraceFailed, "internal_error", false, true},
		{"sandbox_error runs again", domain.TraceFailed, "sandbox_error", false, true},
		{"canceled runs again", domain.TraceCanceled, "", false, true},
	}
	statuses, kinds := map[string]bool{}, map[string]bool{}
	for _, tt := range tests {
		statuses[string(tt.status)] = true
		kinds[tt.failureKind] = true
		t.Run(tt.name, func(t *testing.T) {
			now := expiry
			if tt.expired {
				now = expiry.Add(time.Microsecond)
			}
			if got := domain.Rerun(tt.status, tt.failureKind, expiry, now); got != tt.want {
				t.Errorf("Rerun = %t, want %t", got, tt.want)
			}
		})
	}

	for _, s := range openAPIEnum(t, "Visualization", "status") {
		if !statuses[s] {
			t.Errorf("no case for status %q", s)
		}
	}
	for _, k := range openAPIEnum(t, "Failure", "kind") {
		if !kinds[k] {
			t.Errorf("no case for failure kind %q", k)
		}
	}
}

func TestQuotaRetryAfterEndsAtTheNextUTCMidnight(t *testing.T) {
	tests := []struct {
		name string
		now  time.Time
		want time.Duration
	}{
		{"a second before midnight", time.Date(2026, 10, 24, 23, 59, 59, 0, time.UTC), time.Second},
		{"at midnight a whole day", time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC), 24 * time.Hour},
		{"in the morning", time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC), 16 * time.Hour},
		{"a clock in another zone counts in UTC", time.Date(2026, 10, 25, 3, 0, 0, 0, time.FixedZone("ICT", 7*3600)), 4 * time.Hour},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := domain.QuotaRetryAfter(tt.now); got != tt.want {
				t.Errorf("QuotaRetryAfter = %v, want %v", got, tt.want)
			}
		})
	}
}

func openAPIEnum(t *testing.T, schema, property string) []string {
	t.Helper()
	raw, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Components struct {
			Schemas map[string]struct {
				Properties map[string]struct {
					Enum []string `yaml:"enum"`
				} `yaml:"properties"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	enum := spec.Components.Schemas[schema].Properties[property].Enum
	if len(enum) == 0 {
		t.Fatalf("openapi.yaml has no enum at %s.%s", schema, property)
	}
	return enum
}
