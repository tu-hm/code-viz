package http

import (
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("github.com/tu-hm/code-viz/backend/internal/transport/http")

func newRequestDurations(reg prometheus.Registerer) *prometheus.HistogramVec {
	h := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "vizd_http_request_duration_seconds",
		Help:    "Time to answer an API request, by route pattern and status code. A long-poll GET waits up to 20 s.",
		Buckets: slices.Concat(prometheus.DefBuckets, []float64{20, 30}),
	}, []string{"route", "status"})
	reg.MustRegister(h)
	return h
}

// observe traces each request through mux as a server span named after its route, and times it in durations.
// It must wrap mux itself: ServeMux sets r.Pattern on the request it is handed.
func observe(durations *prometheus.HistogramVec, mux http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ctx, span := tracer.Start(r.Context(), r.Method, oteltrace.WithSpanKind(oteltrace.SpanKindServer),
			oteltrace.WithAttributes(attribute.String("request_id", info(r.Context()).id)))
		defer span.End()
		r = r.WithContext(ctx)
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		mux.ServeHTTP(sw, r)

		span.SetName(r.Pattern)
		span.SetAttributes(attribute.String("http.route", r.Pattern), attribute.Int("http.response.status_code", sw.status))
		if sw.status >= http.StatusInternalServerError {
			span.SetStatus(codes.Error, http.StatusText(sw.status))
		}
		durations.WithLabelValues(r.Pattern, strconv.Itoa(sw.status)).Observe(time.Since(start).Seconds())
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
