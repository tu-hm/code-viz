package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
)

const (
	idlePoll       = 200 * time.Millisecond // §7.13.2
	idleBackoff    = time.Second
	backoffAfter   = 10 // empty claims in a row
	leaseCheck     = time.Second
	drainTimeout   = 25 * time.Second // §13
	jobDeadline    = 30 * time.Second // §7.7: sandbox start, build and trace
	wallTime       = 15 * time.Second // §11: build and trace
	leaseTime      = 45 * time.Second // upload and Complete finish inside the lease (§7.13.2)
	cleanupTimeout = 10 * time.Second // box Close and the last write, after the job's ctx is done
	memory         = 256 << 20        // §11
	storagePrefix  = "t7"             // §7.5: new traces live 7 days
)

// Worker claims trace jobs and runs them one at a time (§7.7, §7.9). Every field is required.
type Worker struct {
	Name     string // leased_by; unique per process, or a stalled worker writes under its successor's lease
	Queue    ports.JobQueue
	Adapters ports.Adapters
	Sandbox  ports.Sandbox
	Blobs    ports.BlobStore
	Validate func(line []byte) error
	Now      func() time.Time
	After    func(time.Duration) <-chan time.Time
}

type chore struct {
	name  string
	every time.Duration
	do    func(ctx context.Context, now time.Time) error
	last  time.Time
}

// Run claims and runs jobs until ctx is done. Then it stops claiming, gives the running job 25 s to finish, and requeues it after that (§7.8).
func (w *Worker) Run(ctx context.Context) {
	jobs, cancelJobs := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelJobs()
	stopDrain := context.AfterFunc(ctx, func() {
		select {
		case <-w.After(drainTimeout):
			cancelJobs()
		case <-jobs.Done():
		}
	})
	defer stopDrain()

	chores := []chore{
		{name: "rescue expired leases", every: 10 * time.Second, do: func(ctx context.Context, now time.Time) error {
			_, err := w.Queue.Rescue(ctx, now)
			return err
		}},
		{name: "sweep sandboxes", every: time.Minute, do: w.Sandbox.Sweep},
		{name: "clean up finished jobs", every: time.Hour, do: func(ctx context.Context, now time.Time) error {
			_, err := w.Queue.Cleanup(ctx, now)
			return err
		}},
	}
	empty := 0
	for ctx.Err() == nil {
		now := w.Now()
		for i := range chores {
			c := &chores[i]
			if now.Sub(c.last) < c.every {
				continue
			}
			c.last = now
			if err := c.do(ctx, now); err != nil && ctx.Err() == nil {
				slog.ErrorContext(ctx, "chore failed", "chore", c.name, "err", err)
			}
		}

		job, err := w.Queue.Claim(jobs, w.Name, now)
		if err == nil {
			empty = 0
			w.run(jobs, job, now)
			continue
		}
		if !errors.Is(err, domain.ErrNoJob) && jobs.Err() == nil {
			slog.ErrorContext(ctx, "claim job", "err", err)
		}
		empty++
		select {
		case <-ctx.Done():
		case <-w.After(idleDelay(empty)):
		}
	}
}

// idleDelay spreads idle workers' claims with ±20% jitter (§7.13.2).
func idleDelay(empty int) time.Duration {
	d := idlePoll
	if empty >= backoffAfter {
		d = idleBackoff
	}
	return d*4/5 + rand.N(d*2/5) //nolint:gosec // poll jitter, not a secret
}

// run runs one job and records how it ended. ctx is canceled when a drain runs out of time.
func (w *Worker) run(ctx context.Context, job ports.Job, claimed time.Time) {
	err := w.attempt(ctx, job, claimed)
	l := job.Lease
	switch {
	case err == nil:
	case errors.Is(err, domain.ErrLeaseLost):
		slog.WarnContext(ctx, "job stopped, lease lost", "trace_id", l.TraceID, "err", err)
	case errors.Is(err, tracecore.ErrMalformed):
		slog.ErrorContext(ctx, "tracer output is malformed", "trace_id", l.TraceID, "language", job.Language, "err", err)
		w.fail(ctx, l)
	case errors.Is(err, domain.ErrInfra) || ctx.Err() != nil:
		slog.WarnContext(ctx, "job requeued", "trace_id", l.TraceID, "attempt", job.Attempt, "err", err)
		w.requeue(ctx, l)
	default:
		slog.ErrorContext(ctx, "job failed", "trace_id", l.TraceID, "err", err)
		w.fail(ctx, l)
	}
}

// attempt runs the job with a watcher on its lease. A lost lease cancels the job and comes back as ErrLeaseLost.
func (w *Worker) attempt(ctx context.Context, job ports.Job, claimed time.Time) error {
	m, ok := w.Adapters.Manifest(job.Language)
	if !ok || !m.Enabled {
		return fmt.Errorf("language %q is not enabled on this worker: %w", job.Language, domain.ErrInfra)
	}
	rec := tracecore.NewRecorder(tracecore.Config{
		ID:       job.Lease.TraceID,
		Source:   trace.Source{File: m.SourceFile, LineCount: lineCount(job.Source)},
		Options:  job.Options,
		Limits:   tracecore.DefaultLimits,
		Validate: w.Validate,
	})

	ctx, cancel := context.WithCancelCause(ctx)
	watched := make(chan struct{})
	go func() {
		defer close(watched)
		w.watch(ctx, cancel, job.Lease, rec)
	}()
	err := w.trace(ctx, job, m, rec, claimed)
	if cause := context.Cause(ctx); err != nil && errors.Is(cause, domain.ErrLeaseLost) {
		err = fmt.Errorf("%w: %w", cause, err)
	}
	cancel(nil)
	<-watched
	return err
}

// watch checks the lease every second until ctx is done, writing progress instead when the step count moved (§7.13.3).
// A lost lease cancels ctx, which kills the sandbox.
func (w *Worker) watch(ctx context.Context, cancel context.CancelCauseFunc, l ports.Lease, rec *tracecore.Recorder) {
	written := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-w.After(leaseCheck):
		}
		var err error
		if n := rec.StepCount(); n != written {
			err = w.Queue.Progress(ctx, l, n, w.Now())
			if err == nil {
				written = n
			}
		} else {
			err = w.Queue.CheckLease(ctx, l)
		}
		if errors.Is(err, domain.ErrLeaseLost) {
			cancel(err)
			return
		}
		if err != nil && ctx.Err() == nil {
			slog.WarnContext(ctx, "check lease", "trace_id", l.TraceID, "err", err)
		}
	}
}

// trace takes the job from claimed to completed, or to failed when the build fails (§7.7).
func (w *Worker) trace(ctx context.Context, job ports.Job, m domain.Manifest, rec *tracecore.Recorder, claimed time.Time) error {
	l := job.Lease
	ctx, cancelLease := context.WithDeadline(ctx, claimed.Add(leaseTime))
	defer cancelLease()
	boxCtx, cancelBox := context.WithDeadline(ctx, claimed.Add(jobDeadline))
	defer cancelBox()

	box, err := w.Sandbox.Start(boxCtx, ports.SandboxSpec{
		JobID:  l.TraceID,
		Image:  m.Image,
		Files:  map[string][]byte{m.SourceFile: []byte(job.Source), "stdin": []byte(job.Stdin)},
		Memory: memory,
	})
	if err != nil {
		return fmt.Errorf("start sandbox: %w", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		defer cancel()
		if err := box.Close(ctx); err != nil {
			slog.ErrorContext(ctx, "close sandbox", "trace_id", l.TraceID, "err", err)
		}
	}()
	runCtx, cancelRun := context.WithTimeout(boxCtx, wallTime)
	defer cancelRun()

	var build json.RawMessage
	if m.Build != nil {
		if err := w.Queue.Building(ctx, l, w.Now()); err != nil {
			return fmt.Errorf("mark building: %w: %w", domain.ErrInfra, err)
		}
		b, kind, err := Build(runCtx, box, m, job.Options)
		if err != nil {
			return err
		}
		if build, err = json.Marshal(b); err != nil {
			return fmt.Errorf("encode build: %w", err)
		}
		if !b.Ok {
			if err := w.Queue.Fail(ctx, l, kind, build, w.Now()); err != nil {
				return fmt.Errorf("fail build: %w: %w", domain.ErrInfra, err)
			}
			slog.InfoContext(ctx, "job failed its build", "trace_id", l.TraceID, "failure_kind", kind)
			return nil
		}
	}

	if err := w.Queue.Tracing(ctx, l, w.Now()); err != nil {
		return fmt.Errorf("mark tracing: %w: %w", domain.ErrInfra, err)
	}
	exit, err := box.Run(runCtx, ports.Command{
		Args:   m.TraceCmd,
		Env:    append([]string{"VIZ_MAX_STEPS=" + strconv.Itoa(job.Options.MaxSteps)}, m.TraceEnv...),
		Stdout: rec.Stdout(),
		Stderr: rec.Stderr(),
		Wire:   rec.Wire(),
	})
	res, err := rec.Finish(tracecore.Outcome{
		Code:        exit.Code,
		Signal:      exit.Signal,
		TimedOut:    exit.Limit == ports.LimitTime,
		OutOfMemory: exit.Limit == ports.LimitMemory,
	}, err)
	if err != nil {
		return fmt.Errorf("run trace: %w", err)
	}

	chunks, err := res.Chunks()
	if err != nil {
		return fmt.Errorf("chunk trace: %w", err)
	}
	stored := make([]ports.Chunk, len(chunks))
	for i, c := range chunks {
		if err := w.Blobs.Put(ctx, domain.ChunkKey(storagePrefix, l.TraceID, c.Index), c.Gzip); err != nil {
			return fmt.Errorf("upload chunk %d: %w", c.Index, err)
		}
		stored[i] = ports.Chunk{Index: c.Index, FromStep: c.FromStep, ToStep: c.ToStep, SizeBytes: len(c.Gzip), SHA256: c.SHA256}
	}
	header, err := json.Marshal(res.Header)
	if err != nil {
		return fmt.Errorf("encode header: %w", err)
	}
	exitKind := res.Header.Summary.Exit.Kind
	err = w.Queue.Complete(ctx, l, ports.CompletedTrace{
		Header:        header,
		Chunks:        stored,
		ExitKind:      exitKind,
		StoragePrefix: storagePrefix,
		Build:         build,
	}, w.Now())
	if err != nil {
		return fmt.Errorf("complete: %w: %w", domain.ErrInfra, err)
	}
	slog.InfoContext(ctx, "job completed", "trace_id", l.TraceID, "exit_kind", exitKind, "steps", len(res.Steps))
	return nil
}

func (w *Worker) requeue(ctx context.Context, l ports.Lease) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	defer cancel()
	if err := w.Queue.Requeue(ctx, l, w.Now()); err != nil {
		slog.ErrorContext(ctx, "requeue job", "trace_id", l.TraceID, "err", err)
	}
}

func (w *Worker) fail(ctx context.Context, l ports.Lease) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	defer cancel()
	if err := w.Queue.Fail(ctx, l, api.FailureKindInternalError, nil, w.Now()); err != nil {
		slog.ErrorContext(ctx, "fail job", "trace_id", l.TraceID, "err", err)
	}
}

func lineCount(src string) int {
	n := strings.Count(src, "\n")
	if src != "" && !strings.HasSuffix(src, "\n") {
		n++
	}
	return n
}
