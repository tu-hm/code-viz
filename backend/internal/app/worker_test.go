package app_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/dockersandbox"
	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/schema"
)

func TestRunTracesPythonProgramsEndToEnd(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	adapters, err := manifest.Load("../../adapters")
	if err != nil {
		t.Fatal(err)
	}
	sb, err := dockersandbox.New(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sb.Close(); err != nil {
			t.Error(err)
		}
	})
	okBuild := &api.Build{Ok: true, Diagnostics: []api.Diagnostic{}}

	tests := []struct {
		name   string
		source string
		trace  traceRow
		job    jobRow
		build  *api.Build
	}{
		{
			name:   "a program that runs to the end completes",
			source: "name = input()\nprint('hi', name)\n",
			trace:  traceRow{Status: "completed", Version: 3, ExitKind: "normal", ChunkCount: 1, StoragePrefix: "t7"},
			job:    jobRow{Status: "done", Attempt: 1},
			build:  okBuild,
		},
		{
			name:   "an uncaught exception completes and is not retried",
			source: "xs = [1]\nprint(xs[3])\n",
			trace:  traceRow{Status: "completed", Version: 3, ExitKind: "exception", ChunkCount: 1, StoragePrefix: "t7"},
			job:    jobRow{Status: "done", Attempt: 1},
			build:  okBuild,
		},
		{
			name:   "a syntax error fails the build with compile_error",
			source: "def f(:\n    pass\n",
			trace:  traceRow{Status: "failed", Version: 2, FailureStage: "build", FailureKind: "compile_error"},
			job:    jobRow{Status: "failed", Attempt: 1},
			build: &api.Build{
				Diagnostics: []api.Diagnostic{{Line: 1, Column: 7, Severity: api.DiagnosticSeverityError, Message: "invalid syntax"}},
				Raw:         ptr("main.py:1:7: error: invalid syntax\n"),
			},
		},
		{
			name:   "a blocked import fails the build with unsupported_module",
			source: "import math\nimport numpy\n",
			trace:  traceRow{Status: "failed", Version: 2, FailureStage: "build", FailureKind: "unsupported_module"},
			job:    jobRow{Status: "failed", Attempt: 1},
			build: &api.Build{
				Diagnostics: []api.Diagnostic{{Line: 2, Column: 1, Severity: api.DiagnosticSeverityError, Message: "numpy isn't supported in the visualizer"}},
				Raw:         ptr("main.py:2:1: error: numpy isn't supported in the visualizer\n"),
			},
		},
	}
	ids := make([]string, len(tests))
	for i, tc := range tests {
		ids[i] = addJob(t, db, "python3", tc.source, "Ada\n")
	}
	start(t, newWorker(t, db, adapters, sb, b)).idle(t)

	for i, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			id := ids[i]
			if diff := cmp.Diff(tc.trace, readTrace(t, db, id)); diff != "" {
				t.Errorf("trace (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(tc.job, readJob(t, db, id)); diff != "" {
				t.Errorf("job (-want +got):\n%s", diff)
			}
			docs := readDocs(t, db, id)
			if docs.Build != nil {
				docs.Build.DurationMs = 0
			}
			if diff := cmp.Diff(tc.build, docs.Build); diff != "" {
				t.Errorf("build (-want +got):\n%s", diff)
			}
			if tc.trace.Status != "completed" {
				assertNoChunks(t, b, id)
				return
			}
			if docs.Header.ID != id || string(docs.Header.Summary.Exit.Kind) != tc.trace.ExitKind {
				t.Errorf("header id %s, exit %s; want %s, %s", docs.Header.ID, docs.Header.Summary.Exit.Kind, id, tc.trace.ExitKind)
			}
			if got := len(chunkSteps(t, b, id, docs.Chunks)); got == 0 || got != docs.Header.Summary.StepCount {
				t.Errorf("chunks hold %d steps, want the header's %d", got, docs.Header.Summary.StepCount)
			}
		})
	}
}

func TestRunMarksBuildingOnlyWhenTheLanguageHasABuild(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		language string
		version  int64
		build    *api.Build
	}{
		{"a language with a build goes through building", "fake", 3, &api.Build{Ok: true, Diagnostics: []api.Diagnostic{}}},
		{"a language without a build goes straight to tracing", "nobuild", 2, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			db, b := newDB(t), newBucket(t)
			id := addJob(t, db, tc.language, "x", "")
			start(t, newWorker(t, db, fakeAdapters(t), newFakeSandbox(traceSteps(3)), b)).idle(t)

			want := traceRow{Status: "completed", Version: tc.version, ExitKind: "normal", ChunkCount: 1, StoragePrefix: "t7"}
			if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
				t.Errorf("trace (-want +got):\n%s", diff)
			}
			docs := readDocs(t, db, id)
			if docs.Build != nil {
				docs.Build.DurationMs = 0
			}
			if diff := cmp.Diff(tc.build, docs.Build); diff != "" {
				t.Errorf("build (-want +got):\n%s", diff)
			}
			if got := len(chunkSteps(t, b, id, docs.Chunks)); got != 3 {
				t.Errorf("chunks hold %d steps, want 3", got)
			}
		})
	}
}

func TestRunRequeuesAJobWhoseSandboxFailsToStart(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	sb := newFakeSandbox(traceSteps(1))
	sb.failStarts.Store(1)
	id := addJob(t, db, "nobuild", "x", "")
	start(t, newWorker(t, db, fakeAdapters(t), sb, b)).idle(t)

	want := traceRow{Status: "completed", Version: 3, ExitKind: "normal", ChunkCount: 1, StoragePrefix: "t7"}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "done", Attempt: 2}, readJob(t, db, id)); diff != "" {
		t.Errorf("job (-want +got):\n%s", diff)
	}
}

func TestRunRequeuesThenFailsAJobForALanguageThisWorkerCannotRun(t *testing.T) {
	t.Parallel()
	for _, language := range []string{"off", "cobol"} {
		t.Run(language, func(t *testing.T) {
			t.Parallel()
			db, b := newDB(t), newBucket(t)
			id := addJob(t, db, language, "x", "")
			start(t, newWorker(t, db, fakeAdapters(t), newFakeSandbox(traceSteps(1)), b)).idle(t)

			want := traceRow{Status: "failed", Version: 2, FailureStage: "build", FailureKind: "internal_error"}
			if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
				t.Errorf("trace (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(jobRow{Status: "failed", Attempt: 2}, readJob(t, db, id)); diff != "" {
				t.Errorf("job (-want +got):\n%s", diff)
			}
		})
	}
}

func TestRunFailsOnMalformedTracerOutputAndLogsNoUserData(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	db, b := newDB(t), newBucket(t)
	sb := newFakeSandbox(func(_ context.Context, cmd ports.Command) (ports.Exit, error) {
		return ports.Exit{}, play(cmd, fakeHello, `{"type":"step","event":"line","line":"s3cr3t-user-data"}`)
	})
	id := addJob(t, db, "nobuild", "print('s3cr3t-user-data')", "s3cr3t-user-data")
	r := start(t, newWorker(t, db, fakeAdapters(t), sb, b))
	r.idle(t)
	r.stop()
	await(t, r.stopped)

	want := traceRow{Status: "failed", Version: 2, FailureStage: "trace", FailureKind: "internal_error"}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "failed", Attempt: 1}, readJob(t, db, id)); diff != "" {
		t.Errorf("job (-want +got):\n%s", diff)
	}
	assertNoChunks(t, b, id)
	if strings.Contains(logs.String(), "s3cr3t") {
		t.Errorf("logs quote user data:\n%s", logs.String())
	}
	var logged []string
	for line := range strings.Lines(logs.String()) {
		var rec struct {
			Level   string `json:"level"`
			Msg     string `json:"msg"`
			TraceID string `json:"trace_id"`
		}
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatal(err)
		}
		if rec.TraceID == id {
			logged = append(logged, rec.Level+" "+rec.Msg)
		}
	}
	if diff := cmp.Diff([]string{"ERROR tracer output is malformed"}, logged); diff != "" {
		t.Errorf("log records for the trace (-want +got):\n%s", diff)
	}
}

func TestRunKeepsTheStepsOfAProgramThatRunsPastTheWallTime(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	sb := newFakeSandbox(func(ctx context.Context, cmd ports.Command) (ports.Exit, error) {
		if err := play(cmd, fakeHello, fakeStep(1), fakeStep(2)); err != nil {
			return ports.Exit{}, err
		}
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 15*time.Second {
			return ports.Exit{}, errors.New("trace runs without a deadline 15 s away")
		}
		return ports.Exit{Limit: ports.LimitTime}, nil
	})
	id := addJob(t, db, "nobuild", "x", "")
	start(t, newWorker(t, db, fakeAdapters(t), sb, b)).idle(t)

	want := traceRow{Status: "completed", Version: 2, ExitKind: "timeout", ChunkCount: 1, StoragePrefix: "t7"}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "done", Attempt: 1}, readJob(t, db, id)); diff != "" {
		t.Errorf("job (-want +got):\n%s", diff)
	}
	docs := readDocs(t, db, id)
	line2 := 2
	wantTruncation := &trace.SummaryTruncation{Reason: trace.SummaryTruncationReasonTimeLimit, AtLine: &line2}
	if diff := cmp.Diff(wantTruncation, docs.Header.Summary.Truncation); diff != "" {
		t.Errorf("truncation (-want +got):\n%s", diff)
	}
	if got := len(chunkSteps(t, b, id, docs.Chunks)); got != 2 {
		t.Errorf("chunks hold %d steps, want 2", got)
	}
}

func TestRunStopsAndWritesNothingOnceTheLeaseIsLost(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	traced := make(chan struct{})
	sb := newFakeSandbox(func(ctx context.Context, cmd ports.Command) (ports.Exit, error) {
		if err := play(cmd, fakeHello, fakeStep(1), fakeStep(2)); err != nil {
			return ports.Exit{}, err
		}
		close(traced)
		<-ctx.Done()
		return ports.Exit{}, ctx.Err()
	})
	id := addJob(t, db, "nobuild", "x", "")
	r := start(t, newWorker(t, db, fakeAdapters(t), sb, b))
	check := r.next(t)
	if check.d != time.Second {
		t.Fatalf("first wait %v, want the 1 s lease check", check.d)
	}
	await(t, traced)

	q := mysql.NewQueue(db)
	expired := time.Now().Add(46 * time.Second)
	if n, err := q.Rescue(t.Context(), expired); err != nil || n != 1 {
		t.Fatalf("rescue = %d, %v; want 1 job", n, err)
	}
	if _, err := q.Claim(t.Context(), "other", expired); err != nil {
		t.Fatal(err)
	}
	traceBefore, jobBefore := readTrace(t, db, id), readJob(t, db, id)
	check.fire()
	r.idle(t)

	if diff := cmp.Diff(traceBefore, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace changed after the lease was lost (-before +after):\n%s", diff)
	}
	if diff := cmp.Diff(jobBefore, readJob(t, db, id)); diff != "" {
		t.Errorf("job changed after the lease was lost (-before +after):\n%s", diff)
	}
	assertNoChunks(t, b, id)
}

func TestRunRequeuesOnceThenFailsWhileStorageIsDown(t *testing.T) {
	t.Parallel()
	db := newDB(t)
	down := blobStore(t, closedEndpoint(t), "down")
	id := addJob(t, db, "nobuild", "x", "")
	start(t, newWorker(t, db, fakeAdapters(t), newFakeSandbox(traceSteps(1)), down)).idle(t)

	want := traceRow{Status: "failed", Version: 4, FailureStage: "trace", FailureKind: "internal_error"}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "failed", Attempt: 2}, readJob(t, db, id)); diff != "" {
		t.Errorf("job (-want +got):\n%s", diff)
	}
}

func TestRescueRunsEvery10SecondsAndHandsACrashedWorkersJobToAnother(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	id := addJob(t, db, "nobuild", "x", "")
	crashedAt := time.Now()
	if _, err := mysql.NewQueue(db).Claim(t.Context(), "crashed", crashedAt); err != nil {
		t.Fatal(err)
	}
	var now atomic.Int64
	now.Store(crashedAt.Add(40 * time.Second).UnixNano())
	w := newWorker(t, db, fakeAdapters(t), newFakeSandbox(traceSteps(1)), b)
	w.Now = func() time.Time { return time.Unix(0, now.Load()) }
	r := start(t, w)

	r.next(t).fire()
	now.Store(crashedAt.Add(49 * time.Second).UnixNano())
	r.next(t).fire()
	if got := readJob(t, db, id); got != (jobRow{Status: "running", Attempt: 1}) {
		t.Fatalf("job 9 s after the last rescue = %+v, want still running under the crashed worker", got)
	}
	now.Store(crashedAt.Add(50 * time.Second).UnixNano())
	r.next(t).fire()
	r.idle(t)

	want := traceRow{Status: "completed", Version: 3, ExitKind: "normal", ChunkCount: 1, StoragePrefix: "t7"}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "done", Attempt: 2}, readJob(t, db, id)); diff != "" {
		t.Errorf("job (-want +got):\n%s", diff)
	}
}

func TestDrainRequeuesAJobStillRunningAfter25Seconds(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	traced := make(chan struct{})
	sb := newFakeSandbox(func(ctx context.Context, cmd ports.Command) (ports.Exit, error) {
		if err := play(cmd, fakeHello, fakeStep(1)); err != nil {
			return ports.Exit{}, err
		}
		close(traced)
		<-ctx.Done()
		return ports.Exit{}, ctx.Err()
	})
	running := addJob(t, db, "nobuild", "x", "")
	queued := addJob(t, db, "nobuild", "y", "")
	r := start(t, newWorker(t, db, fakeAdapters(t), sb, b))
	await(t, traced)
	r.stop()
	r.drain(t).fire()
	await(t, r.stopped)

	if diff := cmp.Diff(traceRow{Status: "queued", Version: 2}, readTrace(t, db, running)); diff != "" {
		t.Errorf("running trace (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "queued", Attempt: 1}, readJob(t, db, running)); diff != "" {
		t.Errorf("running job (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "queued", Attempt: 0}, readJob(t, db, queued)); diff != "" {
		t.Errorf("queued job (-want +got):\n%s", diff)
	}
	assertNoChunks(t, b, running)
}

func TestDrainLetsARunningJobFinishWithin25Seconds(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	traced, release := make(chan struct{}), make(chan struct{})
	sb := newFakeSandbox(func(_ context.Context, cmd ports.Command) (ports.Exit, error) {
		if err := play(cmd, fakeHello, fakeStep(1)); err != nil {
			return ports.Exit{}, err
		}
		close(traced)
		<-release
		return ports.Exit{}, play(cmd, fakeExit)
	})
	running := addJob(t, db, "nobuild", "x", "")
	queued := addJob(t, db, "nobuild", "y", "")
	r := start(t, newWorker(t, db, fakeAdapters(t), sb, b))
	await(t, traced)
	r.stop()
	r.drain(t)
	close(release)
	await(t, r.stopped)

	want := traceRow{Status: "completed", Version: 2, ExitKind: "normal", ChunkCount: 1, StoragePrefix: "t7"}
	if diff := cmp.Diff(want, readTrace(t, db, running)); diff != "" {
		t.Errorf("running trace (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(jobRow{Status: "queued", Attempt: 0}, readJob(t, db, queued)); diff != "" {
		t.Errorf("queued job (-want +got):\n%s", diff)
	}
}

func TestProgressIsWrittenOnTheLeaseCheckOnlyWhenStepsMoved(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	wrote, next := make(chan struct{}), make(chan struct{})
	closeWrote := sync.OnceFunc(func() { close(wrote) })
	sb := newFakeSandbox(func(_ context.Context, cmd ports.Command) (ports.Exit, error) {
		if err := play(cmd, fakeHello, fakeStep(1), fakeStep(2), fakeStep(3)); err != nil {
			return ports.Exit{}, err
		}
		closeWrote()
		<-next
		return ports.Exit{}, play(cmd, fakeStep(4), fakeStep(5), fakeExit)
	})
	id := addJob(t, db, "nobuild", "x", "")
	r := start(t, newWorker(t, db, fakeAdapters(t), sb, b))
	check := r.next(t)
	await(t, wrote)

	check.fire()
	check = r.next(t)
	if diff := cmp.Diff(traceRow{Status: "tracing", Version: 2, ProgressSteps: 3}, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace after a check with new steps (-want +got):\n%s", diff)
	}
	check.fire()
	r.next(t)
	if diff := cmp.Diff(traceRow{Status: "tracing", Version: 2, ProgressSteps: 3}, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace after a check without new steps (-want +got):\n%s", diff)
	}
	close(next)
	r.idle(t)

	want := traceRow{Status: "completed", Version: 3, ProgressSteps: 3, ExitKind: "normal", ChunkCount: 1, StoragePrefix: "t7"}
	if diff := cmp.Diff(want, readTrace(t, db, id)); diff != "" {
		t.Errorf("trace (-want +got):\n%s", diff)
	}
}

func TestIdlePollingBacksOffAfter10EmptyClaimsAndResetsAfterAJob(t *testing.T) {
	t.Parallel()
	db, b := newDB(t), newBucket(t)
	r := start(t, newWorker(t, db, fakeAdapters(t), newFakeSandbox(traceSteps(1)), b))

	var last timer
	for i := range 12 {
		last = r.next(t)
		lo, hi := 160*time.Millisecond, 240*time.Millisecond
		if i >= 9 {
			lo, hi = 800*time.Millisecond, 1200*time.Millisecond
		}
		if last.d < lo || last.d >= hi {
			t.Errorf("wait after empty claim %d = %v, want [%v, %v)", i+1, last.d, lo, hi)
		}
		if i < 11 {
			last.fire()
		}
	}
	first := addJob(t, db, "nobuild", "x", "")
	second := addJob(t, db, "nobuild", "y", "")
	last.fire()

	got := []time.Duration{r.next(t).d, r.next(t).d}
	if diff := cmp.Diff([]time.Duration{time.Second, time.Second}, got); diff != "" {
		t.Errorf("waits while running two jobs, want only their lease checks (-want +got):\n%s", diff)
	}
	if idle := r.next(t); idle.d < 160*time.Millisecond || idle.d >= 240*time.Millisecond {
		t.Errorf("wait after the jobs = %v, want 200 ms again", idle.d)
	}
	for _, id := range []string{first, second} {
		if got := readTrace(t, db, id).Status; got != "completed" {
			t.Errorf("trace %s is %s, want completed", id, got)
		}
	}
}

const (
	fakeHello = `{"type":"hello","protocol":1,"language":"fake","runtime":"fake 1","adapter":"fake/1"}`
	fakeExit  = `{"type":"exit","kind":"normal","code":0,"signal":null,"message":null}`
)

func fakeStep(line int) string {
	return fmt.Sprintf(`{"type":"step","event":"line","line":%d,"prevLine":null,`+
		`"stack":[{"id":"0","name":"<module>","kind":"global","line":%d,"locals":[],"returnValue":null}],"heap":{},"error":null}`, line, line)
}

var fakeManifests = map[string]string{
	"fake": `id: fake
displayName: Fake
editorMode: text
image: fake
sourceFile: main.fake
build: {cmd: [build], timeoutMs: 10000, unsupportedModuleExit: 3}
trace: {cmd: [trace]}
enabled: true
`,
	"nobuild": `id: nobuild
displayName: No build
editorMode: text
image: fake
sourceFile: main.fake
trace: {cmd: [trace]}
enabled: true
`,
	"off": `id: off
displayName: Off
editorMode: text
image: fake
sourceFile: main.fake
trace: {cmd: [trace]}
enabled: false
`,
}

func fakeAdapters(t *testing.T) ports.Adapters {
	t.Helper()
	dir := t.TempDir()
	for name, m := range fakeManifests {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name, "manifest.yaml"), []byte(m), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	set, err := manifest.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	return set
}

type script func(ctx context.Context, cmd ports.Command) (ports.Exit, error)

type fakeSandbox struct {
	failStarts atomic.Int32
	trace      script
}

func newFakeSandbox(trace script) *fakeSandbox {
	return &fakeSandbox{trace: trace}
}

func (s *fakeSandbox) Start(context.Context, ports.SandboxSpec) (ports.Box, error) {
	if s.failStarts.Add(-1) >= 0 {
		return nil, fmt.Errorf("start box: %w", domain.ErrInfra)
	}
	return fakeBox{s}, nil
}

func (s *fakeSandbox) Sweep(context.Context, time.Time) error { return nil }

type fakeBox struct{ s *fakeSandbox }

func (b fakeBox) Run(ctx context.Context, cmd ports.Command) (ports.Exit, error) {
	if cmd.Args[0] == "build" {
		return ports.Exit{}, nil
	}
	return b.s.trace(ctx, cmd)
}

func (b fakeBox) Close(context.Context) error { return nil }

func play(cmd ports.Command, lines ...string) error {
	for _, l := range lines {
		if _, err := io.WriteString(cmd.Wire, l+"\n"); err != nil {
			return fmt.Errorf("write fd 3: %w", err)
		}
	}
	return nil
}

func traceSteps(n int) script {
	return func(_ context.Context, cmd ports.Command) (ports.Exit, error) {
		lines := []string{fakeHello}
		for i := range n {
			lines = append(lines, fakeStep(i+1))
		}
		return ports.Exit{}, play(cmd, append(lines, fakeExit)...)
	}
}

func newWorker(t *testing.T, db *sql.DB, adapters ports.Adapters, sb ports.Sandbox, blobs ports.BlobStore) *app.Worker {
	t.Helper()
	val, err := schema.New()
	if err != nil {
		t.Fatal(err)
	}
	return &app.Worker{
		Name:     fmt.Sprintf("worker%d", resource.Add(1)),
		Queue:    mysql.NewQueue(db),
		Adapters: adapters,
		Sandbox:  sb,
		Blobs:    blobs,
		Validate: val.Wire,
		Now:      time.Now,
	}
}

type timer struct {
	d time.Duration
	c chan time.Time
}

func (tm timer) fire() { tm.c <- time.Time{} }

type clock struct {
	timers chan timer
	done   chan struct{}
}

func (c *clock) after(d time.Duration) <-chan time.Time {
	tm := timer{d: d, c: make(chan time.Time, 1)}
	select {
	case c.timers <- tm:
	case <-c.done:
		tm.fire()
	}
	return tm.c
}

type running struct {
	timers  <-chan timer
	stop    context.CancelFunc
	stopped <-chan struct{}
}

func start(t *testing.T, w *app.Worker) running {
	t.Helper()
	c := &clock{timers: make(chan timer), done: make(chan struct{})}
	w.After = c.after
	ctx, cancel := context.WithCancel(t.Context())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		w.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		close(c.done)
		<-stopped
	})
	return running{timers: c.timers, stop: cancel, stopped: stopped}
}

func (r running) next(t *testing.T) timer {
	t.Helper()
	select {
	case tm := <-r.timers:
		return tm
	case <-time.After(time.Minute):
		t.Fatal("worker waited on no timer for a minute")
	}
	return timer{}
}

func (r running) idle(t *testing.T) {
	t.Helper()
	for {
		if r.next(t).d < time.Second {
			return
		}
	}
}

func (r running) drain(t *testing.T) timer {
	t.Helper()
	for {
		if tm := r.next(t); tm.d == 25*time.Second {
			return tm
		}
	}
}

func await(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(time.Minute):
		t.Fatal("waited a minute")
	}
}

func addJob(t *testing.T, db *sql.DB, language, source, stdin string) string {
	t.Helper()
	ctx := t.Context()
	id := fmt.Sprintf("trc_%032x", resource.Add(1))
	key := sha256.Sum256([]byte(id))
	now := time.Now()
	err := mysql.InTx(ctx, db, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx,
			`INSERT INTO traces (id, cache_key, language, source, stdin, options, updated_at, expires_at)
			VALUES (?, ?, ?, ?, ?, '{"maxSteps":1000,"startAtLines":[]}', ?, ?)`,
			id, key[:], language, source, stdin, now, now.Add(7*24*time.Hour))
		if err != nil {
			return err
		}
		return mysql.NewQueue(db).Enqueue(ctx, tx, id, false, now)
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

type traceRow struct {
	Status        string
	Version       int64
	ProgressSteps int
	ExitKind      string
	ChunkCount    int
	StoragePrefix string
	FailureStage  string
	FailureKind   string
}

func readTrace(t *testing.T, db *sql.DB, id string) traceRow {
	t.Helper()
	var r traceRow
	err := db.QueryRowContext(t.Context(),
		`SELECT status, version, progress_steps, exit_kind, chunk_count, storage_prefix, failure_stage, failure_kind
		FROM traces WHERE id = ?`, id,
	).Scan(&r.Status, &r.Version, &r.ProgressSteps, &r.ExitKind, &r.ChunkCount, &r.StoragePrefix, &r.FailureStage, &r.FailureKind)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

type jobRow struct {
	Status  string
	Attempt int
}

func readJob(t *testing.T, db *sql.DB, traceID string) jobRow {
	t.Helper()
	var r jobRow
	if err := db.QueryRowContext(t.Context(), "SELECT status, attempt FROM jobs WHERE trace_id = ?", traceID).Scan(&r.Status, &r.Attempt); err != nil {
		t.Fatal(err)
	}
	return r
}

type docs struct {
	Header trace.Trace
	Chunks []ports.Chunk
	Build  *api.Build
}

func readDocs(t *testing.T, db *sql.DB, id string) docs {
	t.Helper()
	var header, chunks, build []byte
	if err := db.QueryRowContext(t.Context(), "SELECT header, chunks, build FROM traces WHERE id = ?", id).Scan(&header, &chunks, &build); err != nil {
		t.Fatal(err)
	}
	var d docs
	for _, f := range []struct {
		raw []byte
		v   any
	}{{header, &d.Header}, {chunks, &d.Chunks}, {build, &d.Build}} {
		if f.raw == nil {
			continue
		}
		if err := json.Unmarshal(f.raw, f.v); err != nil {
			t.Fatal(err)
		}
	}
	return d
}

func chunkSteps(t *testing.T, b bucket, id string, chunks []ports.Chunk) []trace.Step {
	t.Helper()
	var steps []trace.Step
	for _, c := range chunks {
		resp := get(t, http.MethodGet, b.url+"/"+domain.ChunkKey("t7", id, c.Index))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("get chunk %d: HTTP %d", c.Index, resp.StatusCode)
		}
		sum := sha256.Sum256(resp.body)
		if hex.EncodeToString(sum[:]) != c.SHA256 || len(resp.body) != c.SizeBytes {
			t.Errorf("chunk %d is %d bytes with sha256 %x, the trace lists %d bytes and %s", c.Index, len(resp.body), sum, c.SizeBytes, c.SHA256)
		}
		zr, err := gzip.NewReader(bytes.NewReader(resp.body))
		if err != nil {
			t.Fatal(err)
		}
		var part []trace.Step
		if err := json.NewDecoder(zr).Decode(&part); err != nil {
			t.Fatal(err)
		}
		steps = append(steps, part...)
	}
	return steps
}

func assertNoChunks(t *testing.T, b bucket, id string) {
	t.Helper()
	if resp := get(t, http.MethodGet, b.url+"/"+domain.ChunkKey("t7", id, 0)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("get chunk 0: HTTP %d, want 404", resp.StatusCode)
	}
}

type response struct {
	*http.Response
	body []byte
}

func get(t *testing.T, method, url string) response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response{resp, body}
}

func closedEndpoint(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	return "http://" + ln.Addr().String()
}

func ptr[T any](v T) *T { return &v }
