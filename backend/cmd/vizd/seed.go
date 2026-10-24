package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"time"

	"github.com/caarlos0/env/v11"

	"github.com/tu-hm/code-viz/backend/internal/adapters/blobstore"
	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/app"
)

// seed loads every dir/<language>/<case>/expected.trace.json as a completed visualization (BE-13 §1).
func seed(ctx context.Context, db *sql.DB, vizEnv, dir string) error {
	if vizEnv != "dev" {
		return fmt.Errorf("seed loads test fixtures, refused with VIZ_ENV=%s", vizEnv)
	}
	if dir == "" {
		return errors.New("usage: vizd seed <fixtures dir>")
	}
	var cfg workerConfig
	if err := env.Parse(&cfg); err != nil {
		return fmt.Errorf("load seed config: %w", err)
	}
	adapters, err := manifest.Load(cfg.AdaptersDir)
	if err != nil {
		return fmt.Errorf("load manifests: %w", err)
	}
	blobs, err := blobstore.New(ctx, blobstore.Config{Endpoint: cfg.S3Endpoint, Bucket: cfg.S3Bucket, PathStyle: cfg.S3PathStyle})
	if err != nil {
		return fmt.Errorf("open blob store: %w", err)
	}
	s := &app.Seeder{
		Store:    mysql.NewStore(db, math.MaxInt32), // no worker drains the queue while seeding => no cap
		Queue:    mysql.NewQueue(db),
		Adapters: adapters,
		Blobs:    blobs,
		Now:      func() time.Time { return time.Now().UTC() },
		Random:   rand.Reader,
	}

	goldens, err := filepath.Glob(filepath.Join(dir, "*", "*", "expected.trace.json"))
	if err != nil {
		return err
	}
	if len(goldens) == 0 {
		return fmt.Errorf("no fixtures under %s", dir)
	}
	for _, golden := range goldens {
		f, err := readFixture(golden)
		if err != nil {
			return err
		}
		id, err := s.Seed(ctx, f)
		if err != nil {
			return err
		}
		slog.InfoContext(ctx, "fixture seeded", "fixture", f.Name, "visualization_id", id)
	}
	return nil
}

func readFixture(golden string) (app.Fixture, error) {
	caseDir := filepath.Dir(golden)
	raw, err := os.ReadFile(golden) //nolint:gosec // paths come from the fixtures dir the developer names
	if err != nil {
		return app.Fixture{}, err
	}
	f := app.Fixture{Name: filepath.Base(filepath.Dir(caseDir)) + "/" + filepath.Base(caseDir)}
	if err := json.Unmarshal(raw, &f.Trace); err != nil {
		return app.Fixture{}, fmt.Errorf("decode %s: %w", golden, err)
	}
	src, err := os.ReadFile(filepath.Join(caseDir, f.Trace.Source.File)) //nolint:gosec // as above
	if err != nil {
		return app.Fixture{}, err
	}
	f.Source = string(src)
	stdin, err := os.ReadFile(filepath.Join(caseDir, "stdin")) //nolint:gosec // as above
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return app.Fixture{}, err
	}
	f.Stdin = string(stdin)
	return f, nil
}
