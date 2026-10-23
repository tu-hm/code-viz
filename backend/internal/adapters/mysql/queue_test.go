package mysql_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/sqlc"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

var _ ports.JobQueue = (*mysql.Queue)(nil)

var (
	t0         = time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC)
	traceCount atomic.Int64
)

func TestEnqueueCommitsAndRollsBackWithTheCallersTransaction(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db, q := newQueue(t)

	errAbort := errors.New("abort")
	err := mysql.InTx(ctx, db, func(tx *sql.Tx) error {
		if err := insertTrace(ctx, tx, "trc_aborted", t0); err != nil {
			return err
		}
		if err := q.Enqueue(ctx, tx, "trc_aborted", false, t0); err != nil {
			return err
		}
		return errAbort
	})
	if !errors.Is(err, errAbort) {
		t.Fatalf("err = %v, want %v", err, errAbort)
	}
	if _, err := q.Claim(ctx, "w1", t0); !errors.Is(err, domain.ErrNoJob) {
		t.Fatalf("claim after rollback: err = %v, want ErrNoJob", err)
	}

	id := addJob(t, db, q, false, t0)
	got := claim(t, q, "w1", t0)
	want := ports.Job{
		Lease:    ports.Lease{TraceID: id, Worker: "w1"},
		Attempt:  1,
		Language: "python3",
		Source:   "print(input())",
		Stdin:    "hi",
		Options:  trace.Options{MaxSteps: 1000, StartAtLines: []int{}},
	}
	if diff := cmp.Diff(want, got, cmpopts.IgnoreFields(ports.Lease{}, "JobID")); diff != "" {
		t.Errorf("claimed job (-want +got):\n%s", diff)
	}
}

func TestClaimTakesSignedInFirstThenOldestRunAfter(t *testing.T) {
	t.Parallel()
	db, q := newQueue(t)
	anonEarly := addJob(t, db, q, false, t0)
	signedInLate := addJob(t, db, q, true, t0.Add(2*time.Second))
	signedInEarly := addJob(t, db, q, true, t0.Add(time.Second))
	anonLate := addJob(t, db, q, false, t0.Add(3*time.Second))
	signedInLateAgain := addJob(t, db, q, true, t0.Add(2*time.Second))

	var got []string
	for {
		job, err := q.Claim(t.Context(), "w1", t0.Add(time.Minute))
		if errors.Is(err, domain.ErrNoJob) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, job.Lease.TraceID)
	}

	want := []string{signedInEarly, signedInLate, signedInLateAgain, anonEarly, anonLate}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("claim order (-want +got):\n%s", diff)
	}
}

func TestClaimWaitsForRunAfter(t *testing.T) {
	t.Parallel()
	db, q := newQueue(t)
	id := addJob(t, db, q, false, t0)

	if _, err := q.Claim(t.Context(), "w1", t0.Add(-time.Microsecond)); !errors.Is(err, domain.ErrNoJob) {
		t.Fatalf("claim before run_after: err = %v, want ErrNoJob", err)
	}
	if job := claim(t, q, "w1", t0); job.Lease.TraceID != id {
		t.Errorf("claimed trace %s, want %s", job.Lease.TraceID, id)
	}
}

func TestClaimSkipsTheJobAnotherClaimHolds(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	db, q := newQueue(t)
	first := addJob(t, db, q, false, t0)
	second := addJob(t, db, q, false, t0.Add(time.Second))
	now := t0.Add(time.Minute)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	held, err := sqlc.New(tx).NextJob(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if held.TraceID != first {
		t.Fatalf("held trace %s, want %s", held.TraceID, first)
	}

	job, err := q.Claim(ctx, "w1", now)
	if err != nil {
		t.Fatal(err)
	}
	if job.Lease.TraceID != second {
		t.Errorf("claimed trace %s while %s is held, want %s", job.Lease.TraceID, first, second)
	}

	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if job := claim(t, q, "w2", now); job.Lease.TraceID != first {
		t.Errorf("claimed trace %s after release, want %s", job.Lease.TraceID, first)
	}
}

func TestConcurrentClaimersNeverShareAJob(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db, q := newQueue(t)
	const jobs, workers = 40, 8
	for range jobs {
		addJob(t, db, q, false, t0)
	}

	claimed := make(chan uint64, jobs)
	errs := make(chan error, workers)
	for w := range workers {
		go func() {
			for {
				job, err := q.Claim(ctx, fmt.Sprintf("w%d", w), t0)
				if errors.Is(err, domain.ErrNoJob) {
					errs <- nil
					return
				}
				if err != nil {
					errs <- err
					return
				}
				claimed <- job.Lease.JobID
			}
		}()
	}
	for range workers {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	close(claimed)

	claims := map[uint64]int{}
	for id := range claimed {
		claims[id]++
	}
	if len(claims) != jobs {
		t.Errorf("%d jobs claimed, want %d", len(claims), jobs)
	}
	for id, n := range claims {
		if n != 1 {
			t.Errorf("job %d claimed %d times", id, n)
		}
	}
}

func TestWritesUnderALostLeaseReturnErrLeaseLostAndChangeNothing(t *testing.T) {
	t.Parallel()
	losses := []struct {
		name string
		lose func(t *testing.T, q *mysql.Queue, l ports.Lease)
	}{
		{"rescued after expiry", func(t *testing.T, q *mysql.Queue, _ ports.Lease) {
			if _, err := q.Rescue(t.Context(), t0.Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
		}},
		{"claimed by another worker", func(t *testing.T, q *mysql.Queue, _ ports.Lease) {
			if _, err := q.Rescue(t.Context(), t0.Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			claim(t, q, "w2", t0.Add(time.Minute))
		}},
		{"already completed", func(t *testing.T, q *mysql.Queue, l ports.Lease) {
			if err := q.Complete(t.Context(), l, completedTrace(), t0.Add(time.Second)); err != nil {
				t.Fatal(err)
			}
		}},
	}
	writes := []struct {
		name  string
		write leasedWrite
	}{
		{"check lease", func(q *mysql.Queue, ctx context.Context, l ports.Lease, _ time.Time) error {
			return q.CheckLease(ctx, l)
		}},
		{"building", (*mysql.Queue).Building},
		{"tracing", (*mysql.Queue).Tracing},
		{"progress", func(q *mysql.Queue, ctx context.Context, l ports.Lease, now time.Time) error {
			return q.Progress(ctx, l, 7, now)
		}},
		{"complete", func(q *mysql.Queue, ctx context.Context, l ports.Lease, now time.Time) error {
			return q.Complete(ctx, l, completedTrace(), now)
		}},
		{"fail", func(q *mysql.Queue, ctx context.Context, l ports.Lease, now time.Time) error {
			return q.Fail(ctx, l, api.FailureKindCompileError, nil, now)
		}},
		{"requeue", (*mysql.Queue).Requeue},
	}
	for _, loss := range losses {
		for _, w := range writes {
			t.Run(loss.name+"/"+w.name, func(t *testing.T) {
				t.Parallel()
				db, q := newQueue(t)
				id := addJob(t, db, q, false, t0)
				job := claim(t, q, "w1", t0)
				loss.lose(t, q, job.Lease)
				traceBefore, jobBefore := readTrace(t, db, id), readJob(t, db, id)

				err := w.write(q, t.Context(), job.Lease, t0.Add(2*time.Minute))
				if !errors.Is(err, domain.ErrLeaseLost) {
					t.Errorf("err = %v, want ErrLeaseLost", err)
				}
				if diff := cmp.Diff(traceBefore, readTrace(t, db, id)); diff != "" {
					t.Errorf("trace changed (-before +after):\n%s", diff)
				}
				if diff := cmp.Diff(jobBefore, readJob(t, db, id)); diff != "" {
					t.Errorf("job changed (-before +after):\n%s", diff)
				}
			})
		}
	}
}

func TestBuildTraceAndCompleteBumpVersionEachTime(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db, q := newQueue(t)
	id := addJob(t, db, q, false, t0)
	l := claim(t, q, "w1", t0).Lease
	steps := []struct {
		name string
		do   func(now time.Time) error
		want traceRow
	}{
		{"building", func(now time.Time) error { return q.Building(ctx, l, now) },
			traceRow{Status: "building", Version: 1}},
		{"tracing", func(now time.Time) error { return q.Tracing(ctx, l, now) },
			traceRow{Status: "tracing", Version: 2}},
		{"progress", func(now time.Time) error { return q.Progress(ctx, l, 412, now) },
			traceRow{Status: "tracing", Version: 3, ProgressSteps: 412}},
		{"completed", func(now time.Time) error { return q.Complete(ctx, l, completedTrace(), now) },
			traceRow{Status: "completed", Version: 4, ProgressSteps: 412}},
	}
	for i, s := range steps {
		now := t0.Add(time.Duration(i+1) * time.Second)
		if err := s.do(now); err != nil {
			t.Fatalf("%s: %v", s.name, err)
		}
		s.want.UpdatedAt = now
		if diff := cmp.Diff(s.want, readTrace(t, db, id)); diff != "" {
			t.Errorf("%s: trace (-want +got):\n%s", s.name, diff)
		}
	}

	want := completedRow{
		Header:        jsonValue(t, completedTrace().Header),
		Chunks:        jsonValue(t, []byte(`[{"index":0,"fromStep":0,"toStep":249,"sizeBytes":1800,"sha256":"`+strings.Repeat("a", 64)+`"},{"index":1,"fromStep":250,"toStep":299,"sizeBytes":300,"sha256":"`+strings.Repeat("b", 64)+`"}]`)),
		ChunkCount:    2,
		ExitKind:      "normal",
		StoragePrefix: "t7",
		Build:         jsonValue(t, completedTrace().Build),
	}
	if diff := cmp.Diff(want, readCompleted(t, db, id)); diff != "" {
		t.Errorf("completed trace (-want +got):\n%s", diff)
	}
	if got := readJob(t, db, id).Status; got != "done" {
		t.Errorf("job status = %s, want done", got)
	}
}

func TestCompleteWithoutStepsStoresNoChunks(t *testing.T) {
	t.Parallel()
	db, q := newQueue(t)
	id := addJob(t, db, q, false, t0)
	l := claim(t, q, "w1", t0).Lease
	done := completedTrace()
	done.Chunks = nil
	done.Build = nil

	if err := q.Complete(t.Context(), l, done, t0); err != nil {
		t.Fatal(err)
	}

	want := completedRow{Header: jsonValue(t, done.Header), Chunks: []any{}, ExitKind: "normal", StoragePrefix: "t7"}
	if diff := cmp.Diff(want, readCompleted(t, db, id)); diff != "" {
		t.Errorf("completed trace (-want +got):\n%s", diff)
	}
}

func TestFailRecordsTheStageTheTraceWasIn(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		reach []leasedWrite
		kind  api.FailureKind
		build json.RawMessage
		want  failedRow
	}{
		{
			name:  "compile error while building",
			reach: []leasedWrite{(*mysql.Queue).Building},
			kind:  api.FailureKindCompileError,
			build: json.RawMessage(`{"ok":false,"durationMs":920,"diagnostics":[{"line":6,"column":14,"severity":"error","message":"expected ';'"}],"raw":"main.cpp:6:14: error: expected ';'"}`),
			want:  failedRow{Stage: "build", Kind: "compile_error", JobStatus: "failed"},
		},
		{
			name:  "internal error while tracing",
			reach: []leasedWrite{(*mysql.Queue).Building, (*mysql.Queue).Tracing},
			kind:  api.FailureKindInternalError,
			want:  failedRow{Stage: "trace", Kind: "internal_error", JobStatus: "failed"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx := t.Context()
			db, q := newQueue(t)
			id := addJob(t, db, q, false, t0)
			l := claim(t, q, "w1", t0).Lease
			for _, reach := range tt.reach {
				if err := reach(q, ctx, l, t0); err != nil {
					t.Fatal(err)
				}
			}

			if err := q.Fail(ctx, l, tt.kind, tt.build, t0.Add(time.Second)); err != nil {
				t.Fatal(err)
			}

			tt.want.Build = jsonValue(t, tt.build)
			if diff := cmp.Diff(tt.want, readFailed(t, db, id)); diff != "" {
				t.Errorf("failed trace (-want +got):\n%s", diff)
			}
		})
	}
}

func TestRequeueRetriesOnceThenFailsWithInternalError(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db, q := newQueue(t)
	id := addJob(t, db, q, false, t0)

	first := claim(t, q, "w1", t0)
	for _, err := range []error{
		q.Building(ctx, first.Lease, t0),
		q.Tracing(ctx, first.Lease, t0),
		q.Progress(ctx, first.Lease, 9, t0),
		q.Requeue(ctx, first.Lease, t0.Add(time.Second)),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if diff := cmp.Diff(traceRow{Status: "queued", Version: 4, UpdatedAt: t0.Add(time.Second)}, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace after first requeue (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "queued", Attempt: 1, RunAfter: t0.Add(time.Second)}, readJob(t, db, id)); diff != "" {
		t.Errorf("job after first requeue (-want +got):\n%s", diff)
	}

	second := claim(t, q, "w2", t0.Add(time.Second))
	if second.Lease.TraceID != id || second.Attempt != 2 {
		t.Fatalf("second claim got trace %s attempt %d, want %s attempt 2", second.Lease.TraceID, second.Attempt, id)
	}
	if err := q.Requeue(ctx, second.Lease, t0.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	want := traceRow{Status: "failed", Version: 5, FailureStage: "build", FailureKind: "internal_error", UpdatedAt: t0.Add(2 * time.Second)}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace after second requeue (-want +got):\n%s", diff)
	}
	if got := readJob(t, db, id).Status; got != "failed" {
		t.Errorf("job status = %s, want failed", got)
	}
	if _, err := q.Claim(ctx, "w3", t0.Add(time.Hour)); !errors.Is(err, domain.ErrNoJob) {
		t.Errorf("claim after failure: err = %v, want ErrNoJob", err)
	}
}

func TestRescueRequeuesAnExpiredLeaseThenFailsTheSecond(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db, q := newQueue(t)
	id := addJob(t, db, q, false, t0)
	first := claim(t, q, "w1", t0)
	if err := q.Building(ctx, first.Lease, t0); err != nil {
		t.Fatal(err)
	}

	expiry := t0.Add(45 * time.Second)
	rescue(t, q, expiry, 0)
	if got := readJob(t, db, id).Status; got != "running" {
		t.Fatalf("job status at lease expiry = %s, want running", got)
	}
	afterExpiry := expiry.Add(time.Microsecond)
	rescue(t, q, afterExpiry, 1)
	if diff := cmp.Diff(traceRow{Status: "queued", Version: 2, UpdatedAt: afterExpiry}, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace after first rescue (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "queued", Attempt: 1, RunAfter: afterExpiry}, readJob(t, db, id)); diff != "" {
		t.Errorf("job after first rescue (-want +got):\n%s", diff)
	}

	second := claim(t, q, "w2", afterExpiry)
	if err := q.Building(ctx, second.Lease, afterExpiry); err != nil {
		t.Fatal(err)
	}
	if err := q.Tracing(ctx, second.Lease, afterExpiry); err != nil {
		t.Fatal(err)
	}
	late := afterExpiry.Add(time.Minute)
	rescue(t, q, late, 1)
	want := traceRow{Status: "failed", Version: 5, FailureStage: "trace", FailureKind: "internal_error", UpdatedAt: late}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace after second rescue (-want +got):\n%s", diff)
	}
	if got := readJob(t, db, id).Status; got != "failed" {
		t.Errorf("job status = %s, want failed", got)
	}
}

func TestRescueTakesBackEveryExpiredLease(t *testing.T) {
	t.Parallel()
	db, q := newQueue(t)
	for range 3 {
		addJob(t, db, q, false, t0)
		claim(t, q, "w1", t0)
	}
	addJob(t, db, q, false, t0)

	rescue(t, q, t0.Add(time.Minute), 3)
}

func TestCancelOnlyCancelsAQueuedJob(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		claim     bool
		wantTrace traceRow
		wantJob   string
	}{
		{"queued job is canceled with its trace", false, traceRow{Status: "canceled", Version: 1, UpdatedAt: t0.Add(time.Second)}, "canceled"},
		{"running job is left to finish", true, traceRow{Status: "building", Version: 1, UpdatedAt: t0}, "running"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx := t.Context()
			db, q := newQueue(t)
			id := addJob(t, db, q, false, t0)
			if tt.claim {
				if err := q.Building(ctx, claim(t, q, "w1", t0).Lease, t0); err != nil {
					t.Fatal(err)
				}
			}

			err := mysql.InTx(ctx, db, func(tx *sql.Tx) error {
				return q.Cancel(ctx, tx, id, t0.Add(time.Second))
			})
			if err != nil {
				t.Fatal(err)
			}

			if diff := cmp.Diff(tt.wantTrace, readTrace(t, db, id)); diff != "" {
				t.Errorf("trace (-want +got):\n%s", diff)
			}
			if got := readJob(t, db, id).Status; got != tt.wantJob {
				t.Errorf("job status = %s, want %s", got, tt.wantJob)
			}
			if _, err := q.Claim(ctx, "w2", t0.Add(time.Hour)); !errors.Is(err, domain.ErrNoJob) {
				t.Errorf("claim after cancel: err = %v, want ErrNoJob", err)
			}
		})
	}
}

func TestCleanupDeletesJobsFinishedMoreThan24HoursAgo(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db, q := newQueue(t)
	now := t0.Add(48 * time.Hour)
	id := addJob(t, db, q, false, t0)
	cutoff := now.Add(-24 * time.Hour)
	jobs := []struct {
		status    string
		updatedAt time.Time
		count     int
	}{
		{"done", cutoff.Add(-time.Hour), 1000},
		{"failed", cutoff.Add(-time.Microsecond), 1},
		{"canceled", cutoff.Add(-time.Microsecond), 1},
		{"done", cutoff, 1},
		{"running", t0, 1},
	}
	for _, j := range jobs {
		_, err := db.ExecContext(ctx, `INSERT INTO jobs (trace_id, status, run_after, created_at, updated_at)
			WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
			SELECT ?, ?, ?, ?, ? FROM n`, j.count, id, j.status, t0, t0, j.updatedAt)
		if err != nil {
			t.Fatal(err)
		}
	}

	deleted, err := q.Cleanup(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1002 {
		t.Errorf("deleted %d jobs, want 1002", deleted)
	}
	want := []jobRow{
		{Status: "queued", RunAfter: t0},
		{Status: "done", RunAfter: t0},
		{Status: "running", RunAfter: t0},
	}
	if diff := cmp.Diff(want, readJobs(t, db, id)); diff != "" {
		t.Errorf("jobs left (-want +got):\n%s", diff)
	}
}

type leasedWrite func(q *mysql.Queue, ctx context.Context, l ports.Lease, now time.Time) error

func newQueue(t *testing.T) (*sql.DB, *mysql.Queue) {
	t.Helper()
	db := migratedDB(t)
	return db, mysql.NewQueue(db)
}

func addJob(t *testing.T, db *sql.DB, q *mysql.Queue, signedIn bool, now time.Time) string {
	t.Helper()
	ctx := t.Context()
	id := fmt.Sprintf("trc_%032x", traceCount.Add(1))
	err := mysql.InTx(ctx, db, func(tx *sql.Tx) error {
		if err := insertTrace(ctx, tx, id, now); err != nil {
			return err
		}
		return q.Enqueue(ctx, tx, id, signedIn, now)
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func claim(t *testing.T, q *mysql.Queue, worker string, now time.Time) ports.Job {
	t.Helper()
	job, err := q.Claim(t.Context(), worker, now)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	return job
}

func rescue(t *testing.T, q *mysql.Queue, now time.Time, want int) {
	t.Helper()
	n, err := q.Rescue(t.Context(), now)
	if err != nil {
		t.Fatal(err)
	}
	if n != want {
		t.Errorf("rescued %d jobs at %s, want %d", n, now.Format(time.RFC3339Nano), want)
	}
}

func completedTrace() ports.CompletedTrace {
	return ports.CompletedTrace{
		Header: json.RawMessage(`{"version":"1.1","id":"trc_x","summary":{"stepCount":300}}`),
		Chunks: []ports.Chunk{
			{Index: 0, FromStep: 0, ToStep: 249, SizeBytes: 1800, SHA256: strings.Repeat("a", 64)},
			{Index: 1, FromStep: 250, ToStep: 299, SizeBytes: 300, SHA256: strings.Repeat("b", 64)},
		},
		ExitKind:      trace.ExitKindNormal,
		StoragePrefix: "t7",
		Build:         json.RawMessage(`{"ok":true,"durationMs":640,"diagnostics":[]}`),
	}
}

type traceRow struct {
	Status        string
	Version       int64
	ProgressSteps int
	FailureStage  string
	FailureKind   string
	UpdatedAt     time.Time
}

func readTrace(t *testing.T, db *sql.DB, id string) traceRow {
	t.Helper()
	var r traceRow
	err := db.QueryRowContext(t.Context(),
		"SELECT status, version, progress_steps, failure_stage, failure_kind, updated_at FROM traces WHERE id = ?", id,
	).Scan(&r.Status, &r.Version, &r.ProgressSteps, &r.FailureStage, &r.FailureKind, &r.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

type completedRow struct {
	Header        any
	Chunks        any
	ChunkCount    int
	ExitKind      string
	StoragePrefix string
	Build         any
}

func readCompleted(t *testing.T, db *sql.DB, id string) completedRow {
	t.Helper()
	var r completedRow
	var header, chunks, build []byte
	err := db.QueryRowContext(t.Context(),
		"SELECT header, chunks, chunk_count, exit_kind, storage_prefix, build FROM traces WHERE id = ?", id,
	).Scan(&header, &chunks, &r.ChunkCount, &r.ExitKind, &r.StoragePrefix, &build)
	if err != nil {
		t.Fatal(err)
	}
	r.Header, r.Chunks, r.Build = jsonValue(t, header), jsonValue(t, chunks), jsonValue(t, build)
	return r
}

type failedRow struct {
	Stage     string
	Kind      string
	Build     any
	JobStatus string
}

func readFailed(t *testing.T, db *sql.DB, id string) failedRow {
	t.Helper()
	var r failedRow
	var build []byte
	err := db.QueryRowContext(t.Context(),
		"SELECT failure_stage, failure_kind, build FROM traces WHERE id = ? AND status = 'failed'", id,
	).Scan(&r.Stage, &r.Kind, &build)
	if err != nil {
		t.Fatal(err)
	}
	r.Build = jsonValue(t, build)
	r.JobStatus = readJob(t, db, id).Status
	return r
}

func jsonValue(t *testing.T, b []byte) any {
	t.Helper()
	if b == nil {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

type jobRow struct {
	Status   string
	Attempt  int
	RunAfter time.Time
}

func readJob(t *testing.T, db *sql.DB, traceID string) jobRow {
	t.Helper()
	jobs := readJobs(t, db, traceID)
	if len(jobs) != 1 {
		t.Fatalf("trace %s has %d jobs, want 1", traceID, len(jobs))
	}
	return jobs[0]
}

func readJobs(t *testing.T, db *sql.DB, traceID string) []jobRow {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), "SELECT status, attempt, run_after FROM jobs WHERE trace_id = ? ORDER BY id", traceID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var jobs []jobRow
	for rows.Next() {
		var j jobRow
		if err := rows.Scan(&j.Status, &j.Attempt, &j.RunAfter); err != nil {
			t.Fatal(err)
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return jobs
}
