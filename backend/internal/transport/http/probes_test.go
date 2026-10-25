package http_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	tcmysql "github.com/testcontainers/testcontainers-go/modules/mysql"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	httptransport "github.com/tu-hm/code-viz/backend/internal/transport/http"
)

func TestReadyzFailsOnceStopping(t *testing.T) {
	stopping := make(chan struct{})
	mux := http.NewServeMux()
	httptransport.HandleProbes(mux, stopping, func(context.Context) error { return nil })

	assertStatus(t, mux, "/readyz", http.StatusOK)
	close(stopping)
	assertStatus(t, mux, "/readyz", http.StatusServiceUnavailable)
	assertStatus(t, mux, "/healthz", http.StatusOK)
}

func TestReadyzFailsWhenMySQLDown(t *testing.T) {
	ctx := t.Context()
	c, err := tcmysql.Run(ctx, "mysql:8.4.13")
	testcontainers.CleanupContainer(t, c)
	if err != nil {
		t.Fatal(err)
	}
	dsn, err := c.ConnectionString(ctx)
	if err != nil {
		t.Fatal(err)
	}
	db, err := mysql.Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	mux := http.NewServeMux()
	httptransport.HandleProbes(mux, make(chan struct{}), db.PingContext)

	assertStatus(t, mux, "/readyz", http.StatusOK)
	if err := c.Stop(ctx, nil); err != nil {
		t.Fatal(err)
	}
	assertStatus(t, mux, "/readyz", http.StatusServiceUnavailable)
	assertStatus(t, mux, "/healthz", http.StatusOK)
}

func assertStatus(t *testing.T, h http.Handler, path string, want int) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
	if rec.Code != want {
		t.Errorf("GET %s = %d, want %d", path, rec.Code, want)
	}
}
