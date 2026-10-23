package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/sqlc"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

const (
	leaseTime    = 45 * time.Second // outlasts the 30 s job deadline (§7.13.2)
	maxAttempts  = 2                // infra errors retried once (§7.7)
	keepFinished = 24 * time.Hour
)

// Queue is the JobQueue on the jobs table.
type Queue struct {
	db *sql.DB
}

func NewQueue(db *sql.DB) *Queue {
	return &Queue{db: db}
}

func (q *Queue) Enqueue(ctx context.Context, tx *sql.Tx, traceID string, signedIn bool, now time.Time) error {
	var priority int8
	if signedIn {
		priority = 1
	}
	if err := sqlc.New(tx).InsertJob(ctx, sqlc.InsertJobParams{TraceID: traceID, Priority: priority, Now: now}); err != nil {
		return fmt.Errorf("insert job for trace %s: %w", traceID, err)
	}
	return nil
}

func (q *Queue) Cancel(ctx context.Context, tx *sql.Tx, traceID string, now time.Time) error {
	qs := sqlc.New(tx)
	// lock order: traces → jobs
	if _, err := qs.LockTrace(ctx, traceID); err != nil {
		return fmt.Errorf("lock trace %s: %w", traceID, err)
	}
	n, err := qs.CancelQueuedJob(ctx, sqlc.CancelQueuedJobParams{Now: now, TraceID: traceID})
	if err != nil {
		return fmt.Errorf("cancel job of trace %s: %w", traceID, err)
	}
	if n == 0 {
		return nil
	}
	if err := qs.SetTraceStatus(ctx, sqlc.SetTraceStatusParams{Status: sqlc.TracesStatusCanceled, Now: now, ID: traceID}); err != nil {
		return fmt.Errorf("cancel trace %s: %w", traceID, err)
	}
	return nil
}

func (q *Queue) Claim(ctx context.Context, worker string, now time.Time) (ports.Job, error) {
	var job ports.Job
	err := InTx(ctx, q.db, func(tx *sql.Tx) error {
		qs := sqlc.New(tx)
		next, err := qs.NextJob(ctx, now)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ErrNoJob
		}
		if err != nil {
			return fmt.Errorf("select next job: %w", err)
		}
		err = qs.LeaseJob(ctx, sqlc.LeaseJobParams{
			LeasedBy:    sql.NullString{String: worker, Valid: true},
			LeasedUntil: sql.NullTime{Time: now.Add(leaseTime), Valid: true},
			Now:         now,
			ID:          next.ID,
		})
		if err != nil {
			return fmt.Errorf("lease job %d: %w", next.ID, err)
		}
		in, err := qs.TraceInput(ctx, next.TraceID)
		if err != nil {
			return fmt.Errorf("read trace %s: %w", next.TraceID, err)
		}
		var opts trace.Options
		if err := json.Unmarshal(in.Options, &opts); err != nil {
			return fmt.Errorf("decode options of trace %s: %w", next.TraceID, err)
		}
		job = ports.Job{
			Lease:    ports.Lease{JobID: next.ID, TraceID: next.TraceID, Worker: worker},
			Attempt:  int(next.Attempt) + 1,
			Language: in.Language,
			Source:   in.Source,
			Stdin:    in.Stdin,
			Options:  opts,
		}
		return nil
	})
	return job, err
}

func (q *Queue) CheckLease(ctx context.Context, l ports.Lease) error {
	held, err := sqlc.New(q.db).LeaseHeld(ctx, sqlc.LeaseHeldParams{ID: l.JobID, LeasedBy: sql.NullString{String: l.Worker, Valid: true}})
	if err != nil {
		return fmt.Errorf("check lease of job %d: %w", l.JobID, err)
	}
	if !held {
		return domain.ErrLeaseLost
	}
	return nil
}

func (q *Queue) Building(ctx context.Context, l ports.Lease, now time.Time) error {
	return q.setStatus(ctx, l, sqlc.TracesStatusBuilding, now)
}

func (q *Queue) Tracing(ctx context.Context, l ports.Lease, now time.Time) error {
	return q.setStatus(ctx, l, sqlc.TracesStatusTracing, now)
}

func (q *Queue) setStatus(ctx context.Context, l ports.Lease, status sqlc.TracesStatus, now time.Time) error {
	return q.leased(ctx, l, func(qs *sqlc.Queries, _ lockedJob) error {
		if err := qs.SetTraceStatus(ctx, sqlc.SetTraceStatusParams{Status: status, Now: now, ID: l.TraceID}); err != nil {
			return fmt.Errorf("set trace %s %s: %w", l.TraceID, status, err)
		}
		return nil
	})
}

func (q *Queue) Progress(ctx context.Context, l ports.Lease, steps int, now time.Time) error {
	return q.leased(ctx, l, func(qs *sqlc.Queries, _ lockedJob) error {
		if err := qs.SetTraceProgress(ctx, sqlc.SetTraceProgressParams{ProgressSteps: steps, Now: now, ID: l.TraceID}); err != nil {
			return fmt.Errorf("set progress of trace %s: %w", l.TraceID, err)
		}
		return nil
	})
}

func (q *Queue) Complete(ctx context.Context, l ports.Lease, t ports.CompletedTrace, now time.Time) error {
	chunks := t.Chunks
	if chunks == nil {
		chunks = []ports.Chunk{}
	}
	chunksJSON, err := json.Marshal(chunks)
	if err != nil {
		return fmt.Errorf("encode chunks: %w", err)
	}
	return q.leased(ctx, l, func(qs *sqlc.Queries, _ lockedJob) error {
		err := qs.CompleteTrace(ctx, sqlc.CompleteTraceParams{
			Header:        t.Header,
			Chunks:        chunksJSON,
			ChunkCount:    len(chunks),
			ExitKind:      string(t.ExitKind),
			StoragePrefix: t.StoragePrefix,
			Build:         t.Build,
			Now:           now,
			ID:            l.TraceID,
		})
		if err != nil {
			return fmt.Errorf("complete trace %s: %w", l.TraceID, err)
		}
		return setJobStatus(ctx, qs, l.JobID, sqlc.JobsStatusDone, now)
	})
}

func (q *Queue) Fail(ctx context.Context, l ports.Lease, kind api.FailureKind, build json.RawMessage, now time.Time) error {
	return q.leased(ctx, l, func(qs *sqlc.Queries, j lockedJob) error {
		return fail(ctx, qs, j, kind, build, now)
	})
}

func (q *Queue) Requeue(ctx context.Context, l ports.Lease, now time.Time) error {
	return q.leased(ctx, l, func(qs *sqlc.Queries, j lockedJob) error {
		return release(ctx, qs, j, now)
	})
}

func (q *Queue) Rescue(ctx context.Context, now time.Time) (int, error) {
	expired, err := sqlc.New(q.db).ExpiredLeases(ctx, sql.NullTime{Time: now, Valid: true})
	if err != nil {
		return 0, fmt.Errorf("list expired leases: %w", err)
	}
	rescued := 0
	for _, e := range expired {
		ok, err := q.rescue(ctx, e.ID, e.TraceID, now)
		if err != nil {
			return rescued, err
		}
		if ok {
			rescued++
		}
	}
	return rescued, nil
}

func (q *Queue) rescue(ctx context.Context, jobID uint64, traceID string, now time.Time) (bool, error) {
	var rescued bool
	err := InTx(ctx, q.db, func(tx *sql.Tx) error {
		qs := sqlc.New(tx)
		// lock order: traces → jobs
		status, err := qs.LockTrace(ctx, traceID)
		if err != nil {
			return fmt.Errorf("lock trace %s: %w", traceID, err)
		}
		attempt, err := qs.LockExpiredJob(ctx, sqlc.LockExpiredJobParams{ID: jobID, Now: sql.NullTime{Time: now, Valid: true}})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock job %d: %w", jobID, err)
		}
		if err := release(ctx, qs, lockedJob{id: jobID, traceID: traceID, traceStatus: status, attempt: attempt}, now); err != nil {
			return err
		}
		rescued = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("rescue job %d: %w", jobID, err)
	}
	return rescued, nil
}

func (q *Queue) Cleanup(ctx context.Context, now time.Time) (int, error) {
	deleted := 0
	for {
		n, err := sqlc.New(q.db).DeleteFinishedJobs(ctx, now.Add(-keepFinished))
		if err != nil {
			return deleted, fmt.Errorf("delete finished jobs: %w", err)
		}
		if n == 0 {
			return deleted, nil
		}
		deleted += int(n)
	}
}

type lockedJob struct {
	id          uint64
	traceID     string
	traceStatus sqlc.TracesStatus
	attempt     int8
}

func (q *Queue) leased(ctx context.Context, l ports.Lease, write func(qs *sqlc.Queries, j lockedJob) error) error {
	return InTx(ctx, q.db, func(tx *sql.Tx) error {
		qs := sqlc.New(tx)
		// lock order: traces → jobs
		status, err := qs.LockTrace(ctx, l.TraceID)
		if err != nil {
			return fmt.Errorf("lock trace %s: %w", l.TraceID, err)
		}
		attempt, err := qs.LockLeasedJob(ctx, sqlc.LockLeasedJobParams{ID: l.JobID, LeasedBy: sql.NullString{String: l.Worker, Valid: true}})
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ErrLeaseLost
		}
		if err != nil {
			return fmt.Errorf("lock job %d: %w", l.JobID, err)
		}
		return write(qs, lockedJob{id: l.JobID, traceID: l.TraceID, traceStatus: status, attempt: attempt})
	})
}

func release(ctx context.Context, qs *sqlc.Queries, j lockedJob, now time.Time) error {
	if j.attempt >= maxAttempts {
		return fail(ctx, qs, j, api.FailureKindInternalError, nil, now)
	}
	if err := qs.RequeueTrace(ctx, sqlc.RequeueTraceParams{Now: now, ID: j.traceID}); err != nil {
		return fmt.Errorf("requeue trace %s: %w", j.traceID, err)
	}
	if err := qs.RequeueJob(ctx, sqlc.RequeueJobParams{Now: now, ID: j.id}); err != nil {
		return fmt.Errorf("requeue job %d: %w", j.id, err)
	}
	return nil
}

func fail(ctx context.Context, qs *sqlc.Queries, j lockedJob, kind api.FailureKind, build json.RawMessage, now time.Time) error {
	stage := api.FailureStageBuild
	if j.traceStatus == sqlc.TracesStatusTracing {
		stage = api.FailureStageTrace
	}
	err := qs.FailTrace(ctx, sqlc.FailTraceParams{FailureStage: string(stage), FailureKind: string(kind), Build: build, Now: now, ID: j.traceID})
	if err != nil {
		return fmt.Errorf("fail trace %s: %w", j.traceID, err)
	}
	return setJobStatus(ctx, qs, j.id, sqlc.JobsStatusFailed, now)
}

func setJobStatus(ctx context.Context, qs *sqlc.Queries, jobID uint64, status sqlc.JobsStatus, now time.Time) error {
	if err := qs.SetJobStatus(ctx, sqlc.SetJobStatusParams{Status: status, Now: now, ID: jobID}); err != nil {
		return fmt.Errorf("set job %d %s: %w", jobID, status, err)
	}
	return nil
}
