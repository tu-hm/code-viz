package app_test

import (
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/app"
)

func TestSeedStoresAGoldenAsACompletedVisualizationOnce(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	adapters, err := manifest.Load("../../adapters")
	if err != nil {
		t.Fatal(err)
	}
	s := &app.Seeder{
		Store:    mysql.NewStore(db, 100),
		Queue:    mysql.NewQueue(db),
		Adapters: adapters,
		Blobs:    b,
		Now:      time.Now,
		Random:   rand.Reader,
	}

	tests := []struct {
		name    string
		fixture string
		source  string
	}{
		{name: "a python golden", fixture: "python/fib", source: "main.py"},
		{name: "a c++ golden", fixture: "cpp/fib", source: "main.cpp"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir := filepath.Join("../../fixtures", tc.fixture)
			raw, err := os.ReadFile(filepath.Join(dir, "expected.trace.json"))
			if err != nil {
				t.Fatal(err)
			}
			src, err := os.ReadFile(filepath.Join(dir, tc.source))
			if err != nil {
				t.Fatal(err)
			}
			f := app.Fixture{Name: tc.fixture, Source: string(src)}
			if err := json.Unmarshal(raw, &f.Trace); err != nil {
				t.Fatal(err)
			}

			id, err := s.Seed(t.Context(), f)
			if err != nil {
				t.Fatal(err)
			}
			again, err := s.Seed(t.Context(), f)
			if err != nil {
				t.Fatal(err)
			}
			if again != id {
				t.Errorf("second seed returned %s, want the first one's %s", again, id)
			}

			traceID := traceOf(t, db, id)
			if n := countRows(t, db, "SELECT COUNT(*) FROM visualizations WHERE trace_id = ?", traceID); n != 1 {
				t.Errorf("%d visualizations of the trace, want 1", n)
			}
			if got := readTrace(t, db, traceID); got.Status != "completed" || got.ExitKind != string(f.Trace.Summary.Exit.Kind) {
				t.Errorf("trace is %s with exit %q, want completed with %q", got.Status, got.ExitKind, f.Trace.Summary.Exit.Kind)
			}
			docs := readDocs(t, db, traceID)
			if docs.Header.ID != traceID {
				t.Errorf("header id %s, want %s", docs.Header.ID, traceID)
			}
			if docs.Build == nil || !docs.Build.Ok {
				t.Errorf("build %+v, want an ok one", docs.Build)
			}
			if diff := cmp.Diff(f.Trace.Steps, chunkSteps(t, b, traceID, docs.Chunks)); diff != "" {
				t.Errorf("steps in the chunks (-golden +got):\n%s", diff)
			}
		})
	}
}
