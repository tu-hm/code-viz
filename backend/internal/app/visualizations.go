package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

const (
	maxWait     = 20 * time.Second // §8.3
	chunkURLTTL = 15 * time.Minute // §8.4
)

// Visualizations runs the visualization API (§8). Every field is required.
type Visualizations struct {
	Store    ports.MetaStore
	Adapters ports.Adapters
	Blobs    ports.BlobStore
	Events   ports.Events
	Now      func() time.Time
	Random   io.Reader // source of the IDs; crypto/rand.Reader in production
}

// Caller is who sends a request.
type Caller struct {
	Subject  string // user ID, or a keyed hash of the IP
	SignedIn bool
}

// Create starts a visualization of req, or attaches it to an identical trace (§8.2). idempotencyKey is "" without one.
// It returns domain.ErrUnsupportedLanguage, ErrPayloadTooLarge or ErrInvalidRequest with text fit for the caller,
// a *domain.RetryError wrapping ErrQuotaExceeded or ErrCapacity, or domain.ErrInfra when MySQL is unreachable.
func (s *Visualizations) Create(ctx context.Context, c Caller, idempotencyKey string, req api.CreateVisualizationRequest) (api.Visualization, error) {
	m, ok := s.Adapters.Manifest(req.Language)
	if !ok || !m.Enabled {
		return api.Visualization{}, fmt.Errorf("language %q: %w", req.Language, domain.ErrUnsupportedLanguage)
	}
	if err := domain.CheckRequest(m, req.Source, req.Stdin, req.Options); err != nil {
		return api.Visualization{}, err
	}
	key, err := domain.CacheKey(m, req.Source, req.Stdin, req.Options)
	if err != nil {
		return api.Visualization{}, err
	}
	id, err := domain.NewVisualizationID(s.Random)
	if err != nil {
		return api.Visualization{}, err
	}
	traceID, err := domain.NewTraceID(s.Random)
	if err != nil {
		return api.Visualization{}, err
	}

	now := s.Now()
	v, err := s.Store.Create(ctx, ports.NewVisualization{
		ID:             id,
		TraceID:        traceID,
		Subject:        c.Subject,
		SignedIn:       c.SignedIn,
		IdempotencyKey: idempotencyKey,
		Language:       m.ID,
		CacheKey:       key,
		Source:         req.Source,
		Stdin:          req.Stdin,
		Options:        domain.NormalizeOptions(req.Options),
	}, now)
	if err != nil {
		return api.Visualization{}, err
	}
	return s.render(ctx, v, now)
}

// Get returns the visualization with id (§8.3). With p.Since set, it first waits up to p.Wait seconds while the
// status isn't final and the version is at most p.Since; running out of time is not an error.
// It returns domain.ErrNotFound, ErrExpired, ErrInvalidRequest for a wait outside 0..20 or a negative since,
// ErrCapacity when the pod already parks its most requests, or ErrInfra when MySQL is unreachable.
func (s *Visualizations) Get(ctx context.Context, id string, p api.GetVisualizationParams) (api.Visualization, error) {
	var wait time.Duration
	if p.Wait != nil {
		wait = time.Duration(*p.Wait) * time.Second
	}
	if wait < 0 || wait > maxWait {
		return api.Visualization{}, fmt.Errorf("wait must be from 0 to %d seconds: %w", int(maxWait.Seconds()), domain.ErrInvalidRequest)
	}
	if p.Since != nil && *p.Since < 0 {
		return api.Visualization{}, fmt.Errorf("since must be 0 or more: %w", domain.ErrInvalidRequest)
	}

	v, err := s.read(ctx, id)
	if err != nil {
		return api.Visualization{}, err
	}
	if wait > 0 && p.Since != nil && !v.Detached && !v.Status.Final() && v.Version <= int64(*p.Since) {
		waitCtx, cancel := context.WithTimeout(ctx, wait)
		err := s.Events.Wait(waitCtx, v.TraceID, int64(*p.Since))
		cancel()
		if err != nil && !errors.Is(err, context.DeadlineExceeded) {
			return api.Visualization{}, fmt.Errorf("wait for trace %s: %w", v.TraceID, err)
		}
		if v, err = s.read(ctx, id); err != nil {
			return api.Visualization{}, err
		}
	}
	return s.render(ctx, v, s.Now())
}

// read returns the visualization with id, or domain.ErrExpired once it is past its retention.
func (s *Visualizations) read(ctx context.Context, id string) (ports.Visualization, error) {
	v, err := s.Store.Visualization(ctx, id)
	if err != nil {
		return ports.Visualization{}, err
	}
	if s.Now().After(v.ExpiresAt) {
		return ports.Visualization{}, fmt.Errorf("visualization %s: %w", id, domain.ErrExpired)
	}
	return v, nil
}

// render shows v as §8.3 does: a detached visualization is canceled, progress comes while tracing, the failure once failed,
// and a completed one has its expiry and the trace with chunk URLs signed for 15 minutes.
func (s *Visualizations) render(ctx context.Context, v ports.Visualization, now time.Time) (api.Visualization, error) {
	out := api.Visualization{
		ID:        v.ID,
		Status:    api.VisualizationStatus(v.Status),
		Version:   int(v.Version),
		Language:  v.Language,
		CreatedAt: v.CreatedAt,
	}
	if v.Detached {
		out.Status = api.VisualizationStatusCanceled
		return out, nil
	}
	if v.Build != nil {
		out.Build = &api.Build{}
		if err := json.Unmarshal(v.Build, out.Build); err != nil {
			return api.Visualization{}, fmt.Errorf("decode build of trace %s: %w", v.TraceID, err)
		}
	}

	switch v.Status {
	case domain.TraceTracing:
		out.Progress = &api.Progress{Steps: v.ProgressSteps}
	case domain.TraceFailed:
		out.Failure = &api.Failure{Stage: v.FailureStage, Kind: v.FailureKind}
	case domain.TraceCompleted:
		chunks := make([]api.Chunk, len(v.Chunks))
		for i, c := range v.Chunks {
			url, err := s.Blobs.Sign(ctx, domain.ChunkKey(v.StoragePrefix, v.TraceID, c.Index), chunkURLTTL)
			if err != nil {
				return api.Visualization{}, fmt.Errorf("sign chunk %d of trace %s: %w", c.Index, v.TraceID, err)
			}
			chunks[i] = api.Chunk{Index: c.Index, FromStep: c.FromStep, ToStep: c.ToStep, SizeBytes: c.SizeBytes, Sha256: c.SHA256, URL: url}
		}
		out.ExpiresAt = &v.ExpiresAt
		out.Trace = &api.TraceManifest{Header: v.Header, Chunks: chunks, UrlsExpireAt: now.Add(chunkURLTTL)}
	}
	return out, nil
}

// Delete detaches the visualization with id when c created it (§8.5). Another caller gets domain.ErrNotFound, as for an
// unknown id; it returns ErrInfra when MySQL is unreachable.
func (s *Visualizations) Delete(ctx context.Context, c Caller, id string) error {
	return s.Store.Detach(ctx, id, c.Subject, s.Now())
}

// Cleanup deletes the visualizations and traces that expired before now, then the chunks of those traces (§7.5).
// Chunks it fails to delete stay behind as orphans, logged by trace ID (§7.8).
func (s *Visualizations) Cleanup(ctx context.Context, now time.Time) error {
	for {
		expired, err := s.Store.DeleteExpired(ctx, now)
		if err != nil {
			return err
		}
		if len(expired) == 0 {
			return nil
		}
		ids := make([]string, len(expired))
		var keys []string
		for i, t := range expired {
			ids[i] = t.ID
			keys = append(keys, t.ChunkKeys...)
		}
		if err := s.Blobs.Delete(ctx, keys); err != nil {
			slog.ErrorContext(ctx, "chunks of expired traces left behind", "trace_ids", ids, "err", err)
		}
	}
}

// Languages lists the enabled languages (§8.1).
func Languages(a ports.Adapters) api.Languages {
	out := api.Languages{Languages: []api.Language{}}
	for _, m := range a.Manifests() {
		if !m.Enabled {
			continue
		}
		out.Languages = append(out.Languages, api.Language{
			ID:          m.ID,
			DisplayName: m.DisplayName,
			EditorMode:  m.EditorMode,
			Visualize: api.VisualizeSupport{
				Enabled: true,
				Capabilities: api.Capabilities{
					ReturnValues:  m.Capabilities.ReturnValues,
					Pointers:      m.Capabilities.Pointers,
					Exceptions:    m.Capabilities.Exceptions,
					StartAtLines:  m.Capabilities.StartAtLines,
					CaptureRanges: m.Capabilities.CaptureRanges,
				},
				Limits: api.StepLimits{MaxSteps: domain.DefaultMaxSteps, MaxStepsCeiling: domain.MaxStepsCeiling},
			},
		})
	}
	return out
}
