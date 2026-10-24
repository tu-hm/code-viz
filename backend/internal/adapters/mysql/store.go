package mysql

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"time"

	gomysql "github.com/go-sql-driver/mysql"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/sqlc"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

// Store is the MetaStore on MySQL.
type Store struct {
	db        *sql.DB
	queue     *Queue
	maxQueued int
}

// NewStore returns a Store that refuses to queue a job while maxQueued jobs are queued already (§7.8: slots × 10).
func NewStore(db *sql.DB, maxQueued int) *Store {
	return &Store{db: db, queue: NewQueue(db), maxQueued: maxQueued}
}

var errRepeat = errors.New("repeated idempotency key")

func (s *Store) Create(ctx context.Context, nv ports.NewVisualization, now time.Time) (ports.Visualization, error) {
	options, err := json.Marshal(nv.Options)
	if err != nil {
		return ports.Visualization{}, fmt.Errorf("encode options: %w", err)
	}
	key := sql.NullString{String: nv.IdempotencyKey, Valid: nv.IdempotencyKey != ""}

	var v ports.Visualization
	err = InTx(ctx, s.db, func(tx *sql.Tx) error {
		qs := sqlc.New(tx)
		// lock order: usage_daily → traces → visualizations → jobs
		repeat, err := takeQuota(ctx, qs, nv, now)
		if err != nil {
			return err
		}
		if repeat != "" {
			if v, err = readVisualization(ctx, qs, repeat); err != nil {
				return err
			}
			return errRepeat
		}

		t, err := singleFlight(ctx, qs, nv, options, now)
		if err != nil {
			return err
		}
		if t.enqueue {
			queued, err := qs.CountQueuedJobs(ctx)
			if err != nil {
				return fmt.Errorf("count queued jobs: %w", err)
			}
			if queued >= int64(s.maxQueued) {
				return &domain.RetryError{Err: domain.ErrCapacity, After: domain.CapacityRetryAfter}
			}
		}
		var bumped *sqlc.ActiveVisualizationsRow
		if !t.status.Final() {
			if bumped, err = oldestQueued(ctx, qs, nv.Subject); err != nil {
				return err
			}
		}

		if key.Valid {
			err := qs.ReleaseIdempotencyKey(ctx, sqlc.ReleaseIdempotencyKeyParams{
				Subject:        nv.Subject,
				IdempotencyKey: key,
				Before:         now.Add(-domain.IdempotencyWindow),
			})
			if err != nil {
				return fmt.Errorf("release idempotency key: %w", err)
			}
		}
		err = qs.InsertVisualization(ctx, sqlc.InsertVisualizationParams{
			ID:             nv.ID,
			TraceID:        t.id,
			Subject:        nv.Subject,
			IdempotencyKey: key,
			Now:            now,
			ExpiresAt:      t.expiresAt,
		})
		if err != nil {
			return fmt.Errorf("insert visualization: %w", err)
		}
		if bumped != nil {
			if err := s.detach(ctx, tx, bumped.ID, bumped.TraceID, now); err != nil {
				return err
			}
		}
		if t.enqueue {
			if err := s.queue.Enqueue(ctx, tx, t.id, nv.SignedIn, now); err != nil {
				return err
			}
		}
		v, err = readVisualization(ctx, qs, nv.ID)
		return err
	})
	if errors.Is(err, errRepeat) {
		return v, nil
	}
	if err != nil {
		return ports.Visualization{}, fmt.Errorf("create visualization: %w", unreachable(err))
	}
	return v, nil
}

// takeQuota counts nv against its subject's quota for the day, and returns the visualization nv repeats instead when its
// idempotency key does. The caller rolls back a repeat, so it takes no quota.
func takeQuota(ctx context.Context, qs *sqlc.Queries, nv ports.NewVisualization, now time.Time) (string, error) {
	day := domain.QuotaDay(now)
	// usage_daily row lock serializes subject's creates => repeat lookup sees first request committed
	if err := qs.AddUsage(ctx, sqlc.AddUsageParams{Subject: nv.Subject, Day: day}); err != nil {
		return "", fmt.Errorf("add usage: %w", err)
	}
	if nv.IdempotencyKey != "" {
		id, err := qs.RepeatedVisualization(ctx, sqlc.RepeatedVisualizationParams{
			Subject:        nv.Subject,
			IdempotencyKey: sql.NullString{String: nv.IdempotencyKey, Valid: true},
			After:          now.Add(-domain.IdempotencyWindow),
		})
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("find repeated idempotency key: %w", err)
		}
	}
	used, err := qs.Usage(ctx, sqlc.UsageParams{Subject: nv.Subject, Day: day})
	if err != nil {
		return "", fmt.Errorf("read usage: %w", err)
	}
	if used > domain.DailyQuota(nv.SignedIn) {
		return "", &domain.RetryError{Err: domain.ErrQuotaExceeded, After: domain.QuotaRetryAfter(now)}
	}
	return "", nil
}

type lockedTrace struct {
	id        string
	status    domain.TraceStatus
	expiresAt time.Time
	enqueue   bool
}

// singleFlight locks the trace with nv.CacheKey, inserting it when there is none and resetting it when it can't serve nv (§7.12).
func singleFlight(ctx context.Context, qs *sqlc.Queries, nv ports.NewVisualization, options []byte, now time.Time) (lockedTrace, error) {
	expiresAt := now.Add(domain.Retention)
	inserted, err := qs.InsertTrace(ctx, sqlc.InsertTraceParams{
		ID:        nv.TraceID,
		CacheKey:  nv.CacheKey[:],
		Language:  nv.Language,
		Source:    nv.Source,
		Stdin:     nv.Stdin,
		Options:   options,
		Now:       now,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return lockedTrace{}, fmt.Errorf("insert trace: %w", err)
	}
	t, err := qs.LockTraceByCacheKey(ctx, nv.CacheKey[:])
	if err != nil {
		return lockedTrace{}, fmt.Errorf("lock trace by cache key: %w", err)
	}
	if inserted == 1 {
		return lockedTrace{id: t.ID, status: domain.TraceQueued, expiresAt: t.ExpiresAt, enqueue: true}, nil
	}

	status := domain.TraceStatus(t.Status)
	if !domain.Rerun(status, t.FailureKind, t.ExpiresAt, now) {
		return lockedTrace{id: t.ID, status: status, expiresAt: t.ExpiresAt}, nil
	}
	if err := qs.ResetTrace(ctx, sqlc.ResetTraceParams{Now: now, ExpiresAt: expiresAt, ID: t.ID}); err != nil {
		return lockedTrace{}, fmt.Errorf("reset trace %s: %w", t.ID, err)
	}
	return lockedTrace{id: t.ID, status: domain.TraceQueued, expiresAt: expiresAt, enqueue: true}, nil
}

// oldestQueued returns the subject's oldest queued visualization, with its trace locked, when the subject already has
// domain.MaxActive queued or running ones. It returns nil when the subject has fewer, or none of them is queued.
func oldestQueued(ctx context.Context, qs *sqlc.Queries, subject string) (*sqlc.ActiveVisualizationsRow, error) {
	active, err := qs.ActiveVisualizations(ctx, subject)
	if err != nil {
		return nil, fmt.Errorf("list active visualizations: %w", err)
	}
	if len(active) < domain.MaxActive {
		return nil, nil
	}
	for _, a := range active {
		if a.Status != sqlc.TracesStatusQueued {
			continue
		}
		if _, err := qs.LockTrace(ctx, a.TraceID); err != nil {
			return nil, fmt.Errorf("lock trace %s: %w", a.TraceID, err)
		}
		return &a, nil
	}
	return nil, nil
}

func (s *Store) Visualization(ctx context.Context, id string) (ports.Visualization, error) {
	v, err := readVisualization(ctx, sqlc.New(s.db), id)
	if err != nil {
		return ports.Visualization{}, unreachable(err)
	}
	return v, nil
}

func readVisualization(ctx context.Context, qs *sqlc.Queries, id string) (ports.Visualization, error) {
	r, err := qs.ReadVisualization(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return ports.Visualization{}, fmt.Errorf("visualization %s: %w", id, domain.ErrNotFound)
	}
	if err != nil {
		return ports.Visualization{}, fmt.Errorf("read visualization %s: %w", id, err)
	}
	var chunks []ports.Chunk
	if r.Chunks != nil {
		if err := json.Unmarshal(r.Chunks, &chunks); err != nil {
			return ports.Visualization{}, fmt.Errorf("decode chunks of trace %s: %w", r.TraceID, err)
		}
	}
	return ports.Visualization{
		ID:            r.ID,
		TraceID:       r.TraceID,
		Detached:      r.Detached,
		CreatedAt:     r.CreatedAt,
		ExpiresAt:     r.ExpiresAt,
		Language:      r.Language,
		Status:        domain.TraceStatus(r.Status),
		Version:       r.Version,
		ProgressSteps: r.ProgressSteps,
		Build:         r.Build,
		FailureStage:  api.FailureStage(r.FailureStage),
		FailureKind:   api.FailureKind(r.FailureKind),
		Header:        r.Header,
		Chunks:        chunks,
		StoragePrefix: r.StoragePrefix,
	}, nil
}

func (s *Store) Detach(ctx context.Context, id, subject string, now time.Time) error {
	err := InTx(ctx, s.db, func(tx *sql.Tx) error {
		qs := sqlc.New(tx)
		traceID, err := qs.OwnedVisualizationTrace(ctx, sqlc.OwnedVisualizationTraceParams{ID: id, Subject: subject})
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("visualization %s of %s: %w", id, subject, domain.ErrNotFound)
		}
		if err != nil {
			return fmt.Errorf("read visualization %s: %w", id, err)
		}
		// lock order: traces → visualizations → jobs
		if _, err := qs.LockTrace(ctx, traceID); err != nil {
			return fmt.Errorf("lock trace %s: %w", traceID, err)
		}
		return s.detach(ctx, tx, id, traceID, now)
	})
	if err != nil {
		return fmt.Errorf("detach: %w", unreachable(err))
	}
	return nil
}

// detach detaches visualization id and cancels the queued job of traceID when no other visualization waits on it (§8.5).
// The caller holds the lock of traceID: lock order traces → visualizations → jobs.
func (s *Store) detach(ctx context.Context, tx *sql.Tx, id, traceID string, now time.Time) error {
	qs := sqlc.New(tx)
	if err := qs.DetachVisualization(ctx, id); err != nil {
		return fmt.Errorf("detach visualization %s: %w", id, err)
	}
	waiting, err := qs.CountWaiting(ctx, traceID)
	if err != nil {
		return fmt.Errorf("count visualizations of trace %s: %w", traceID, err)
	}
	if waiting > 0 {
		return nil
	}
	return s.queue.Cancel(ctx, tx, traceID, now)
}

func (s *Store) DeleteExpired(ctx context.Context, now time.Time) ([]ports.ExpiredTrace, error) {
	for {
		n, err := sqlc.New(s.db).DeleteExpiredVisualizations(ctx, now)
		if err != nil {
			return nil, fmt.Errorf("delete expired visualizations: %w", unreachable(err))
		}
		if n == 0 {
			break
		}
	}

	var expired []ports.ExpiredTrace
	err := InTx(ctx, s.db, func(tx *sql.Tx) error {
		qs := sqlc.New(tx)
		// lock order: traces → jobs; expiry re-read under the lock => a trace a create just reset stays
		rows, err := qs.LockExpiredTraces(ctx, now)
		if err != nil {
			return fmt.Errorf("lock expired traces: %w", err)
		}
		ids := make([]string, len(rows))
		expired = make([]ports.ExpiredTrace, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
			keys := make([]string, r.ChunkCount)
			for c := range keys {
				keys[c] = domain.ChunkKey(r.StoragePrefix, r.ID, c)
			}
			expired[i] = ports.ExpiredTrace{ID: r.ID, ChunkKeys: keys}
		}
		if len(ids) == 0 {
			return nil
		}
		if err := qs.DeleteJobsOfTraces(ctx, ids); err != nil {
			return fmt.Errorf("delete jobs of expired traces: %w", err)
		}
		if err := qs.DeleteTraces(ctx, ids); err != nil {
			return fmt.Errorf("delete expired traces: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("delete expired traces: %w", unreachable(err))
	}
	return expired, nil
}

// unreachable marks err with domain.ErrInfra when MySQL couldn't be reached, so the API answers 503 (§7.8). Server errors stay as they are.
func unreachable(err error) error {
	var opErr *net.OpError
	if errors.As(err, &opErr) || errors.Is(err, driver.ErrBadConn) || errors.Is(err, gomysql.ErrInvalidConn) {
		return fmt.Errorf("%w: %w", domain.ErrInfra, err)
	}
	return err
}
