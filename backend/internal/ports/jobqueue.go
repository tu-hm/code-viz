package ports

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

// JobQueue runs one job per trace (§7.13.2). A job status change and its trace's status change commit together.
// Every method that takes a Lease returns domain.ErrLeaseLost, and changes nothing, once the job no longer runs under that lease.
type JobQueue interface {
	// Enqueue queues a job for traceID in tx, the transaction that created or reset the trace (§7.6).
	Enqueue(ctx context.Context, tx *sql.Tx, traceID string, signedIn bool, now time.Time) error
	// Cancel cancels traceID's job and the trace in tx when the job is still queued. A running job is left to finish.
	Cancel(ctx context.Context, tx *sql.Tx, traceID string, now time.Time) error

	// Claim leases the next queued job to worker for 45 s, signed-in callers first. Returns domain.ErrNoJob when none is ready.
	Claim(ctx context.Context, worker string, now time.Time) (Job, error)
	CheckLease(ctx context.Context, l Lease) error
	Building(ctx context.Context, l Lease, now time.Time) error
	Tracing(ctx context.Context, l Lease, now time.Time) error
	Progress(ctx context.Context, l Lease, steps int, now time.Time) error
	Complete(ctx context.Context, l Lease, t CompletedTrace, now time.Time) error
	// Fail ends the job with kind. The failure stage is build unless the trace was already tracing.
	Fail(ctx context.Context, l Lease, kind api.FailureKind, build json.RawMessage, now time.Time) error
	// Requeue returns the job to the queue after an infrastructure error, or fails it with internal_error after its second attempt (§7.7).
	Requeue(ctx context.Context, l Lease, now time.Time) error

	// Rescue does what Requeue does for every job whose lease expired before now. Returns how many jobs it rescued.
	Rescue(ctx context.Context, now time.Time) (int, error)
	// Cleanup deletes jobs that finished more than 24 h before now. Returns how many it deleted.
	Cleanup(ctx context.Context, now time.Time) (int, error)
}

// Lease is one claim of one job.
type Lease struct {
	JobID   uint64
	TraceID string
	Worker  string
}

// Job is a claimed job with the input of its trace.
type Job struct {
	Lease    Lease
	Attempt  int // 1 on the first claim
	Language string
	Source   string
	Stdin    string
	Options  trace.Options
}

// CompletedTrace is what the API serves for a completed trace (§8.3).
type CompletedTrace struct {
	Header        json.RawMessage // the trace without steps
	Chunks        []Chunk
	Tail          *Tail // nil unless the trace stopped at the step limit
	ExitKind      trace.ExitKind
	StoragePrefix string          // t7 or t90
	Build         json.RawMessage // api.Build; nil when the language has no build
}

// Tail describes tail.txt.gz, the output after the last recorded step (§19.9.5).
type Tail struct {
	SizeBytes int    `json:"sizeBytes"`
	SHA256    string `json:"sha256"`
}

type Chunk struct {
	Index     int    `json:"index"`
	FromStep  int    `json:"fromStep"`
	ToStep    int    `json:"toStep"`
	SizeBytes int    `json:"sizeBytes"`
	SHA256    string `json:"sha256"`
}
