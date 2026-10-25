package http

import (
	"context"
	"log/slog"
	"net/http"
)

// HandleProbes registers GET /healthz and GET /readyz on mux. /readyz fails
// once stopping is closed or while ready returns an error.
func HandleProbes(mux *http.ServeMux, stopping <-chan struct{}, ready func(context.Context) error) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-stopping:
			http.Error(w, "stopping", http.StatusServiceUnavailable)
			return
		default:
		}

		if err := ready(r.Context()); err != nil {
			slog.WarnContext(r.Context(), "not ready", "err", err)
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
}
