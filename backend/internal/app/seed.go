package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
)

const seedSubject = "seed"

// Fixture is a recorded trace with the program it came from: a golden trace under fixtures/.
type Fixture struct {
	Name   string // python/fib; with seedSubject, it is the idempotency key
	Source string
	Stdin  string
	Trace  trace.Trace
}

// Seeder loads fixtures as completed visualizations for local development. Every field is required.
type Seeder struct {
	Store    ports.MetaStore
	Queue    ports.JobQueue
	Adapters ports.Adapters
	Blobs    ports.BlobStore
	Now      func() time.Time
	Random   io.Reader
}

// Seed stores f as a completed visualization without running it: it queues f's trace as the API would, for f's
// language even when it is disabled, then claims the job and completes it with f.Trace. A fixture seeded within 24 h,
// or one whose trace is cached, comes back as it is. It returns the visualization's ID.
// A worker running against the same queue may claim the job first; Seed then fails and the job runs for real.
func (s *Seeder) Seed(ctx context.Context, f Fixture) (string, error) {
	m, ok := s.Adapters.Manifest(f.Trace.Language.ID)
	if !ok {
		return "", fmt.Errorf("seed %s: no manifest for language %q", f.Name, f.Trace.Language.ID)
	}
	key, err := domain.CacheKey(m, f.Source, f.Stdin, f.Trace.Options)
	if err != nil {
		return "", fmt.Errorf("seed %s: %w", f.Name, err)
	}
	id, err := domain.NewVisualizationID(s.Random)
	if err != nil {
		return "", err
	}
	traceID, err := domain.NewTraceID(s.Random)
	if err != nil {
		return "", err
	}

	now := s.Now()
	v, err := s.Store.Create(ctx, ports.NewVisualization{
		ID:             id,
		TraceID:        traceID,
		Subject:        seedSubject,
		SignedIn:       true, // claimed before every anonymous job someone else left queued
		IdempotencyKey: f.Name,
		Language:       m.ID,
		CacheKey:       key,
		Source:         f.Source,
		Stdin:          f.Stdin,
		Options:        domain.NormalizeOptions(f.Trace.Options),
	}, now)
	if err != nil {
		return "", fmt.Errorf("seed %s: %w", f.Name, err)
	}
	if v.Status != domain.TraceQueued {
		return v.ID, nil
	}

	job, err := s.Queue.Claim(ctx, seedSubject, now)
	if err != nil {
		return "", fmt.Errorf("seed %s: claim: %w", f.Name, err)
	}
	if job.Lease.TraceID != v.TraceID {
		return "", fmt.Errorf("seed %s: claimed trace %s instead of %s; stop vizd and seed again once its lease ends (45 s)",
			f.Name, job.Lease.TraceID, v.TraceID)
	}

	t := f.Trace
	res := tracecore.Result{
		Header: tracecore.Header{
			Version:  t.Version,
			ID:       v.TraceID,
			Language: t.Language,
			Source:   t.Source,
			Options:  t.Options,
			Summary:  t.Summary,
			Encoding: t.Encoding,
		},
		Steps: t.Steps,
	}
	chunks, err := res.Chunks()
	if err != nil {
		return "", fmt.Errorf("seed %s: chunk trace: %w", f.Name, err)
	}
	stored := make([]ports.Chunk, len(chunks))
	for i, c := range chunks {
		if err := s.Blobs.Put(ctx, domain.ChunkKey(domain.NewPrefix, v.TraceID, c.Index), "application/json", c.Gzip); err != nil {
			return "", fmt.Errorf("seed %s: upload chunk %d: %w", f.Name, c.Index, err)
		}
		stored[i] = ports.Chunk{Index: c.Index, FromStep: c.FromStep, ToStep: c.ToStep, SizeBytes: len(c.Gzip), SHA256: c.SHA256}
	}
	header, err := json.Marshal(res.Header)
	if err != nil {
		return "", fmt.Errorf("seed %s: encode header: %w", f.Name, err)
	}
	var build json.RawMessage
	if m.Build != nil {
		if build, err = json.Marshal(api.Build{Ok: true, Diagnostics: []api.Diagnostic{}}); err != nil {
			return "", fmt.Errorf("seed %s: encode build: %w", f.Name, err)
		}
	}
	err = s.Queue.Complete(ctx, job.Lease, ports.CompletedTrace{
		Header:        header,
		Chunks:        stored,
		ExitKind:      t.Summary.Exit.Kind,
		StoragePrefix: domain.NewPrefix,
		Build:         build,
	}, s.Now())
	if err != nil {
		return "", fmt.Errorf("seed %s: complete: %w", f.Name, err)
	}
	return v.ID, nil
}
