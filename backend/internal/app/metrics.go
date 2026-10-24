package app

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.opentelemetry.io/otel"
)

var tracer = otel.Tracer("github.com/tu-hm/code-viz/backend/internal/app")

// WorkerMetrics are the worker's Prometheus metrics.
type WorkerMetrics struct {
	claim prometheus.Histogram
	stage *prometheus.HistogramVec
	jobs  *prometheus.CounterVec
}

// NewWorkerMetrics registers the worker's metrics with reg.
func NewWorkerMetrics(reg prometheus.Registerer) *WorkerMetrics {
	f := promauto.With(reg)
	return &WorkerMetrics{
		claim: f.NewHistogram(prometheus.HistogramOpts{
			Name:    "vizd_job_claim_duration_seconds",
			Help:    "Time one claim of the next queued job takes, whether it finds one or not.",
			Buckets: []float64{.001, .0025, .005, .01, .025, .05, .1, .2, .5, 1}, // D5 trigger: claim p95 above 200 ms
		}),
		stage: f.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "vizd_job_stage_duration_seconds",
			Help:    "Time a job spends in each stage: sandbox (start), build, trace and store (upload and complete).",
			Buckets: []float64{.01, .025, .05, .1, .25, .5, 1, 2, 4, 8, 15, 30},
		}, []string{"language", "stage"}),
		jobs: f.NewCounterVec(prometheus.CounterOpts{
			Name: "vizd_jobs_total",
			Help: "Jobs a worker ran, by how they ended: completed with the trace's exit kind, failed with the failure kind, " +
				"infra_error (the queue runs it once more, then fails it) or lease_lost.",
		}, []string{"language", "status", "kind"}),
	}
}
