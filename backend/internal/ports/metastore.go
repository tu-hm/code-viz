package ports

import (
	"context"
	"encoding/json"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

// MetaStore keeps visualizations, their traces and the daily quotas (§7.5). Errors from a store it can't reach wrap domain.ErrInfra.
type MetaStore interface {
	// Create stores v in one transaction (§7.6): it counts v against the caller's daily quota, then attaches v to the trace with
	// v.CacheKey, creating or resetting that trace and queuing its job when needed (§7.12). A repeat of v.IdempotencyKey within
	// 24 h returns the visualization the first request created and counts nothing. Refusals are *domain.RetryError wrapping
	// domain.ErrQuotaExceeded or, when the job would overfill the queue, domain.ErrCapacity.
	Create(ctx context.Context, v NewVisualization, now time.Time) (Visualization, error)
	// Visualization returns the visualization with id, or domain.ErrNotFound.
	Visualization(ctx context.Context, id string) (Visualization, error)
	// Detach detaches the visualization with id and cancels its trace's queued job when no other visualization waits on it (§8.5).
	// Returns domain.ErrNotFound when there is no such visualization.
	Detach(ctx context.Context, id string, now time.Time) error
	// DeleteExpired deletes every visualization that expired before now, then up to 1,000 expired traces with their jobs, and
	// returns those traces. It is called until it returns none (§7.13.1).
	DeleteExpired(ctx context.Context, now time.Time) ([]ExpiredTrace, error)
}

// NewVisualization is a create request that passed validation.
type NewVisualization struct {
	ID             string // viz_
	TraceID        string // trc_, used only when no trace has CacheKey yet
	Subject        string // user ID or keyed hash of the IP
	SignedIn       bool
	IdempotencyKey string // "" without one
	Language       string
	CacheKey       [32]byte
	Source         string
	Stdin          string
	Options        trace.Options // normalized
}

// Visualization is one visualization with what the API shows of its trace (§8.3).
type Visualization struct {
	ID            string
	TraceID       string
	Detached      bool
	CreatedAt     time.Time
	ExpiresAt     time.Time
	Language      string
	Status        domain.TraceStatus
	Version       int64
	ProgressSteps int
	Build         json.RawMessage // api.Build; nil until the trace has one
	FailureStage  api.FailureStage
	FailureKind   api.FailureKind
	Header        json.RawMessage // set once completed
	Chunks        []Chunk
	StoragePrefix string
}

// ExpiredTrace is a trace the retention cleanup deleted.
type ExpiredTrace struct {
	ID        string
	ChunkKeys []string
}
