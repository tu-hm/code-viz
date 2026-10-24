package app_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/goccy/go-yaml"
	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

var day0 = time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC)

func TestCreateRunsConcurrentIdenticalRequestsAsOneTraceAndOneJob(t *testing.T) {
	t.Parallel()
	h := newHarness(t, 100)
	const callers = 8

	type result struct {
		v   api.Visualization
		err error
	}
	results := make(chan result, callers)
	for i := range callers {
		go func() {
			v, err := h.Create(t.Context(), app.Caller{Subject: fmt.Sprintf("ip:%d", i)}, "", request("print(1)"))
			results <- result{v, err}
		}()
	}
	ids := map[string]bool{}
	for range callers {
		r := <-results
		if r.err != nil {
			t.Fatal(r.err)
		}
		if r.v.Status != api.VisualizationStatusQueued {
			t.Errorf("visualization %s is %s, want queued", r.v.ID, r.v.Status)
		}
		ids[r.v.ID] = true
	}

	if len(ids) != callers {
		t.Errorf("%d distinct visualizations, want %d", len(ids), callers)
	}
	if n := countRows(t, h.db, "SELECT COUNT(*) FROM traces"); n != 1 {
		t.Fatalf("%d traces, want 1", n)
	}
	if n := countRows(t, h.db, "SELECT COUNT(*) FROM visualizations v JOIN traces t ON t.id = v.trace_id"); n != callers {
		t.Errorf("%d visualizations on the trace, want %d", n, callers)
	}
	if n := countRows(t, h.db, "SELECT COUNT(*) FROM jobs"); n != 1 {
		t.Errorf("%d jobs, want 1", n)
	}
}

func TestCreateRefusesABadRequestBeforeTakingQuota(t *testing.T) {
	t.Parallel()
	with := func(change func(r *api.CreateVisualizationRequest)) api.CreateVisualizationRequest {
		r := request("print(1)")
		change(&r)
		return r
	}
	tests := []struct {
		name string
		req  api.CreateVisualizationRequest
		want error
	}{
		{"unknown language", with(func(r *api.CreateVisualizationRequest) { r.Language = "cobol" }), domain.ErrUnsupportedLanguage},
		{"language with visualize disabled", with(func(r *api.CreateVisualizationRequest) { r.Language = "off" }), domain.ErrUnsupportedLanguage},
		{"source over its limit", with(func(r *api.CreateVisualizationRequest) { r.Source = strings.Repeat("x", 64<<10+1) }), domain.ErrPayloadTooLarge},
		{"options the language lacks", with(func(r *api.CreateVisualizationRequest) { r.Options.StartAtLines = []int{2} }), domain.ErrInvalidRequest},
	}
	h := newHarness(t, 100)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := h.Create(t.Context(), app.Caller{Subject: "ip:1"}, "", tt.req); !errors.Is(err, tt.want) {
				t.Errorf("err = %v, want %v", err, tt.want)
			}
		})
	}
	if got := usage(t, h.db, "ip:1", day0); got != 0 {
		t.Errorf("usage after refused requests = %d, want 0", got)
	}
}

func TestCreateRefusesPastTheDailyQuotaUntilTheNextUTCDay(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		signedIn bool
		quota    int
	}{
		{"anonymous callers get 100 a day", false, 100},
		{"signed-in callers get 1,000 a day", true, 1000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx := t.Context()
			h := newHarness(t, 100)
			c := app.Caller{Subject: "ip:quota", SignedIn: tt.signedIn}
			setUsage(t, h.db, c.Subject, day0, tt.quota-1)

			if _, err := h.Create(ctx, c, "", request("a")); err != nil {
				t.Fatalf("request %d: %v", tt.quota, err)
			}
			_, err := h.Create(ctx, c, "", request("b"))
			var retry *domain.RetryError
			if !errors.Is(err, domain.ErrQuotaExceeded) || !errors.As(err, &retry) {
				t.Fatalf("request %d: err = %v, want a RetryError with ErrQuotaExceeded", tt.quota+1, err)
			}
			if retry.After != 16*time.Hour {
				t.Errorf("retry after %v, want 16h to the next UTC midnight", retry.After)
			}
			if got := usage(t, h.db, c.Subject, day0); got != tt.quota {
				t.Errorf("usage after the refusal = %d, want %d", got, tt.quota)
			}
			if n := countRows(t, h.db, "SELECT COUNT(*) FROM traces"); n != 1 {
				t.Errorf("%d traces after the refusal, want 1", n)
			}

			midnight := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
			h.now = midnight.Add(-time.Microsecond)
			if _, err := h.Create(ctx, c, "", request("b")); !errors.Is(err, domain.ErrQuotaExceeded) {
				t.Fatalf("just before midnight: err = %v, want ErrQuotaExceeded", err)
			}
			h.now = midnight
			if _, err := h.Create(ctx, c, "", request("b")); err != nil {
				t.Fatalf("at midnight: %v", err)
			}
		})
	}
}

func TestCreateReturnsTheFirstVisualizationForAKeyRepeatedWithin24Hours(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	h := newHarness(t, 100)
	c := app.Caller{Subject: "ip:retry"}
	first, err := h.Create(ctx, c, "key-1", request("a"))
	if err != nil {
		t.Fatal(err)
	}
	if err := h.q.Building(ctx, h.claim(t, traceOf(t, h.db, first.ID)), h.now); err != nil {
		t.Fatal(err)
	}
	setUsage(t, h.db, c.Subject, day0, 100)

	again, err := h.Create(ctx, c, "key-1", request("another program"))
	if err != nil {
		t.Fatal(err)
	}
	want := api.Visualization{ID: first.ID, Status: api.VisualizationStatusBuilding, Version: 1, Language: "nobuild", CreatedAt: day0}
	if diff := cmp.Diff(want, again); diff != "" {
		t.Errorf("repeat (-want +got):\n%s", diff)
	}
	if got := usage(t, h.db, c.Subject, day0); got != 100 {
		t.Errorf("usage after the repeat = %d, want 100", got)
	}

	h.now = day0.Add(24*time.Hour - time.Microsecond)
	if v := h.createWithKey(t, c, "key-1"); v.ID != first.ID {
		t.Errorf("repeat just before 24 h made %s, want %s", v.ID, first.ID)
	}
	if v := h.createWithKey(t, app.Caller{Subject: "ip:other"}, "key-1"); v.ID == first.ID {
		t.Errorf("another caller's key returned %s, the first caller's visualization", v.ID)
	}
	h.now = day0.Add(24 * time.Hour)
	if v := h.createWithKey(t, c, "key-1"); v.ID == first.ID {
		t.Errorf("key used again after 24 h returned the old visualization %s", v.ID)
	}
}

func TestAThirdActiveVisualizationDetachesTheOldestQueuedOne(t *testing.T) {
	t.Parallel()
	h := newHarness(t, 100)
	a, b := h.create(t, "ip:1", "a"), h.create(t, "ip:1", "b")
	c := h.create(t, "ip:1", "c")

	want := map[string]api.VisualizationStatus{a.ID: "canceled", b.ID: "queued", c.ID: "queued"}
	if diff := cmp.Diff(want, h.statuses(t, a, b, c)); diff != "" {
		t.Errorf("statuses (-want +got):\n%s", diff)
	}
	if got := readJob(t, h.db, traceOf(t, h.db, a.ID)).Status; got != "canceled" {
		t.Errorf("job of the detached visualization is %s, want canceled", got)
	}
}

func TestDetachingTheOldestQueuedVisualizationKeepsTheJobAnotherCallerWaitsOn(t *testing.T) {
	t.Parallel()
	h := newHarness(t, 100)
	other := h.create(t, "ip:other", "a")
	a, b := h.create(t, "ip:1", "a"), h.create(t, "ip:1", "b")
	c := h.create(t, "ip:1", "c")

	want := map[string]api.VisualizationStatus{other.ID: "queued", a.ID: "canceled", b.ID: "queued", c.ID: "queued"}
	if diff := cmp.Diff(want, h.statuses(t, other, a, b, c)); diff != "" {
		t.Errorf("statuses (-want +got):\n%s", diff)
	}
	if got := readJob(t, h.db, traceOf(t, h.db, a.ID)).Status; got != "queued" {
		t.Errorf("job another caller waits on is %s, want queued", got)
	}
}

func TestAThirdActiveVisualizationSkipsRunningOnesForTheOldestQueued(t *testing.T) {
	t.Parallel()
	h := newHarness(t, 100)
	a, b := h.create(t, "ip:1", "a"), h.create(t, "ip:1", "b")
	if err := h.q.Building(t.Context(), h.claim(t, traceOf(t, h.db, a.ID)), h.now); err != nil {
		t.Fatal(err)
	}
	c := h.create(t, "ip:1", "c")

	want := map[string]api.VisualizationStatus{a.ID: "building", b.ID: "canceled", c.ID: "queued"}
	if diff := cmp.Diff(want, h.statuses(t, a, b, c)); diff != "" {
		t.Errorf("statuses (-want +got):\n%s", diff)
	}
}

func TestAThirdActiveVisualizationDetachesNothingWhenNoneIsQueued(t *testing.T) {
	t.Parallel()
	h := newHarness(t, 100)
	a, b := h.create(t, "ip:1", "a"), h.create(t, "ip:1", "b")
	for _, v := range []api.Visualization{a, b} {
		if err := h.q.Building(t.Context(), h.claim(t, traceOf(t, h.db, v.ID)), h.now); err != nil {
			t.Fatal(err)
		}
	}
	c := h.create(t, "ip:1", "c")

	want := map[string]api.VisualizationStatus{a.ID: "building", b.ID: "building", c.ID: "queued"}
	if diff := cmp.Diff(want, h.statuses(t, a, b, c)); diff != "" {
		t.Errorf("statuses (-want +got):\n%s", diff)
	}
}

func TestOnlyQueuedOrRunningVisualizationsCountAsActive(t *testing.T) {
	t.Parallel()
	h := newHarness(t, 100)
	done := h.create(t, "ip:other", "done")
	h.complete(t, traceOf(t, h.db, done.ID))
	finished := h.create(t, "ip:1", "finished")
	h.complete(t, traceOf(t, h.db, finished.ID))
	a, b := h.create(t, "ip:1", "a"), h.create(t, "ip:1", "b")
	hit := h.create(t, "ip:1", "done")

	want := map[string]api.VisualizationStatus{finished.ID: "completed", a.ID: "queued", b.ID: "queued", hit.ID: "completed"}
	if diff := cmp.Diff(want, h.statuses(t, finished, a, b, hit)); diff != "" {
		t.Errorf("statuses (-want +got):\n%s", diff)
	}
}

func TestCreateRefusesANewJobOnceTheQueueHoldsItsCap(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	h := newHarness(t, 2)
	done := h.create(t, "ip:0", "done")
	h.complete(t, traceOf(t, h.db, done.ID))
	h.create(t, "ip:1", "q1")
	h.create(t, "ip:2", "q2")

	_, err := h.Create(ctx, app.Caller{Subject: "ip:3"}, "", request("q3"))
	var retry *domain.RetryError
	if !errors.Is(err, domain.ErrCapacity) || !errors.As(err, &retry) || retry.After != 5*time.Second {
		t.Fatalf("third queued job: err = %v, want a RetryError with ErrCapacity after 5s", err)
	}
	if got := usage(t, h.db, "ip:3", day0); got != 0 {
		t.Errorf("usage after the refusal = %d, want 0", got)
	}
	if n := countRows(t, h.db, "SELECT COUNT(*) FROM traces"); n != 3 {
		t.Errorf("%d traces after the refusal, want 3", n)
	}

	if v := h.create(t, "ip:3", "done"); v.Status != api.VisualizationStatusCompleted {
		t.Errorf("cache hit on a full queue is %s, want completed", v.Status)
	}
	if v := h.create(t, "ip:4", "q1"); v.Status != api.VisualizationStatusQueued {
		t.Errorf("attach to a queued trace on a full queue is %s, want queued", v.Status)
	}
}

func TestCreateResetsOnlyATraceThatCannotServeIt(t *testing.T) {
	t.Parallel()
	week := 7 * 24 * time.Hour
	fail := func(kind api.FailureKind) func(t *testing.T, h *harness, v api.Visualization) {
		return func(t *testing.T, h *harness, v api.Visualization) {
			l := h.claim(t, traceOf(t, h.db, v.ID))
			if err := h.q.Fail(t.Context(), l, kind, json.RawMessage(`{"ok":false,"durationMs":5,"diagnostics":[]}`), h.now); err != nil {
				t.Fatal(err)
			}
		}
	}
	complete := func(t *testing.T, h *harness, v api.Visualization) { h.complete(t, traceOf(t, h.db, v.ID)) }
	tests := []struct {
		name       string
		end        func(t *testing.T, h *harness, v api.Visualization)
		later      time.Duration
		reset      bool
		status     api.VisualizationStatus
		queuedJobs int
	}{
		{"queued is attached to", func(*testing.T, *harness, api.Visualization) {}, 0, false, "queued", 1},
		{"compile_error is attached to", fail(api.FailureKindCompileError), 0, false, "failed", 0},
		{"unsupported_module is attached to", fail(api.FailureKindUnsupportedModule), 0, false, "failed", 0},
		{"internal_error runs again", fail(api.FailureKindInternalError), 0, true, "queued", 1},
		{"sandbox_error runs again", fail(api.FailureKindSandboxError), 0, true, "queued", 1},
		{"completed is attached to up to its expiry", complete, week, false, "completed", 0},
		{"completed runs again past its expiry", complete, week + time.Microsecond, true, "queued", 1},
		{"canceled runs again", func(t *testing.T, h *harness, v api.Visualization) {
			if err := h.Delete(t.Context(), v.ID); err != nil {
				t.Fatal(err)
			}
		}, 0, true, "queued", 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t, 100)
			first := h.create(t, "ip:1", "x")
			id := traceOf(t, h.db, first.ID)
			tt.end(t, h, first)
			want := readTrace(t, h.db, id)
			h.now = h.now.Add(tt.later)

			second := h.create(t, "ip:2", "x")

			if got := traceOf(t, h.db, second.ID); got != id {
				t.Fatalf("second visualization is on trace %s, want %s", got, id)
			}
			if second.Status != tt.status {
				t.Errorf("status = %s, want %s", second.Status, tt.status)
			}
			wantExpiry := day0.Add(week)
			if tt.reset {
				want = traceRow{Status: "queued", Version: want.Version + 1}
				wantExpiry = h.now.Add(week)
			}
			if diff := cmp.Diff(want, readTrace(t, h.db, id)); diff != "" {
				t.Errorf("trace (-want +got):\n%s", diff)
			}
			if got := expiresAt(t, h.db, second.ID); !got.Equal(wantExpiry) {
				t.Errorf("visualization expires at %s, want %s", got, wantExpiry)
			}
			if n := countRows(t, h.db, "SELECT COUNT(*) FROM jobs WHERE trace_id = ? AND status = 'queued'", id); n != tt.queuedJobs {
				t.Errorf("%d queued jobs for the trace, want %d", n, tt.queuedJobs)
			}
		})
	}
}

func TestGetShowsWhatEachStateHas(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	h := newHarness(t, 100)
	week := 7 * 24 * time.Hour
	tests := []struct {
		name    string
		prepare func(t *testing.T, v api.Visualization, traceID string)
		want    api.Visualization
	}{
		{
			name: "tracing shows progress",
			prepare: func(t *testing.T, _ api.Visualization, traceID string) {
				l := h.claim(t, traceID)
				if err := h.q.Tracing(ctx, l, h.now); err != nil {
					t.Fatal(err)
				}
				if err := h.q.Progress(ctx, l, 412, h.now); err != nil {
					t.Fatal(err)
				}
			},
			want: api.Visualization{Status: "tracing", Version: 2, Progress: &api.Progress{Steps: 412}},
		},
		{
			name:    "completed shows its expiry, build and trace",
			prepare: func(t *testing.T, _ api.Visualization, traceID string) { h.complete(t, traceID) },
			want: api.Visualization{
				Status:    "completed",
				Version:   2,
				ExpiresAt: ptr(day0.Add(week)),
				Build:     &api.Build{Ok: true, DurationMs: 640, Diagnostics: []api.Diagnostic{}},
				Trace: &api.TraceManifest{
					Chunks:       []api.Chunk{{Index: 0, FromStep: 0, ToStep: 2}},
					UrlsExpireAt: day0.Add(15 * time.Minute),
				},
			},
		},
		{
			name: "a failed build shows the failure and the build",
			prepare: func(t *testing.T, _ api.Visualization, traceID string) {
				l := h.claim(t, traceID)
				if err := h.q.Building(ctx, l, h.now); err != nil {
					t.Fatal(err)
				}
				build := json.RawMessage(`{"ok":false,"durationMs":920,"diagnostics":[{"line":6,"column":14,"severity":"error","message":"expected ';'"}],"raw":"main.cpp:6:14: error: expected ';'"}`)
				if err := h.q.Fail(ctx, l, api.FailureKindCompileError, build, h.now); err != nil {
					t.Fatal(err)
				}
			},
			want: api.Visualization{
				Status:  "failed",
				Version: 2,
				Failure: &api.Failure{Stage: "build", Kind: "compile_error"},
				Build: &api.Build{
					DurationMs:  920,
					Diagnostics: []api.Diagnostic{{Line: 6, Column: 14, Severity: "error", Message: "expected ';'"}},
					Raw:         ptr("main.cpp:6:14: error: expected ';'"),
				},
			},
		},
		{
			name: "detached reads canceled while another caller waits on its trace",
			prepare: func(t *testing.T, v api.Visualization, _ string) {
				h.create(t, "ip:other", "detached reads canceled while another caller waits on its trace")
				if err := h.Delete(ctx, v.ID); err != nil {
					t.Fatal(err)
				}
			},
			want: api.Visualization{Status: "canceled"},
		},
		{
			name:    "queued shows no more",
			prepare: func(*testing.T, api.Visualization, string) {},
			want:    api.Visualization{Status: "queued"},
		},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := h.create(t, fmt.Sprintf("ip:%d", i), tt.name)
			traceID := traceOf(t, h.db, v.ID)
			tt.prepare(t, v, traceID)

			got, err := h.Get(ctx, v.ID, api.GetVisualizationParams{})
			if err != nil {
				t.Fatal(err)
			}
			want := tt.want
			want.ID, want.Language, want.CreatedAt = v.ID, "nobuild", day0
			if want.Trace != nil {
				want.Trace.Header = completedHeader(traceID)
				want.Trace.Chunks[0].Sha256, want.Trace.Chunks[0].SizeBytes = chunkSum(t)
			}
			ignoreURL := cmpopts.IgnoreFields(api.Chunk{}, "URL")
			if diff := cmp.Diff(want, got, ignoreURL, cmp.Transformer("json", func(m json.RawMessage) any { return jsonValue(t, m) })); diff != "" {
				t.Errorf("visualization (-want +got):\n%s", diff)
			}
			checkContract(t, got)
			if got.Trace == nil {
				return
			}
			resp := get(t, http.MethodGet, got.Trace.Chunks[0].URL)
			if resp.StatusCode != http.StatusOK || !bytes.Equal(resp.body, chunkBody(t)) {
				t.Errorf("signed chunk URL: HTTP %d with %d bytes, want 200 with the chunk", resp.StatusCode, len(resp.body))
			}
		})
	}
}

func TestGetFailsOnceTheVisualizationExpiresOrForAnUnknownID(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	h := newHarness(t, 100)
	v := h.create(t, "ip:1", "x")

	h.now = day0.Add(7 * 24 * time.Hour)
	if _, err := h.Get(ctx, v.ID, api.GetVisualizationParams{}); err != nil {
		t.Errorf("at its expiry: %v", err)
	}
	h.now = h.now.Add(time.Microsecond)
	if _, err := h.Get(ctx, v.ID, api.GetVisualizationParams{}); !errors.Is(err, domain.ErrExpired) {
		t.Errorf("past its expiry: err = %v, want ErrExpired", err)
	}
	if _, err := h.Get(ctx, "viz_0123", api.GetVisualizationParams{}); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown id: err = %v, want ErrNotFound", err)
	}
}

func TestGetWaitsOnlyWhileNothingNewerThanSinceIsFinal(t *testing.T) {
	t.Parallel()
	moveOn := func(h *harness) waitFunc {
		return func(ctx context.Context, traceID string, _ int64) error {
			_, err := h.db.ExecContext(ctx, "UPDATE traces SET status = 'building', version = version + 1 WHERE id = ?", traceID)
			return err
		}
	}
	tests := []struct {
		name    string
		prepare func(t *testing.T, h *harness, v api.Visualization)
		p       api.GetVisualizationParams
		events  func(h *harness) waitFunc
		status  api.VisualizationStatus
		version int
		err     error
	}{
		{
			name:    "a wait wakes on a version past since",
			p:       api.GetVisualizationParams{Wait: ptr(20), Since: ptr(0)},
			events:  moveOn,
			status:  "building",
			version: 1,
		},
		{
			name: "a wait that runs out re-reads the visualization",
			p:    api.GetVisualizationParams{Wait: ptr(20), Since: ptr(0)},
			events: func(h *harness) waitFunc {
				return func(ctx context.Context, traceID string, since int64) error {
					if err := moveOn(h)(ctx, traceID, since); err != nil {
						return err
					}
					return context.DeadlineExceeded
				}
			},
			status:  "building",
			version: 1,
		},
		{
			name:    "without since it returns at once",
			p:       api.GetVisualizationParams{Wait: ptr(20)},
			events:  moveOn,
			status:  "queued",
			version: 0,
		},
		{
			name:    "without wait it returns at once",
			p:       api.GetVisualizationParams{Since: ptr(0)},
			events:  moveOn,
			status:  "queued",
			version: 0,
		},
		{
			name: "a version past since returns at once",
			prepare: func(t *testing.T, h *harness, v api.Visualization) {
				if err := moveOn(h)(t.Context(), traceOf(t, h.db, v.ID), 0); err != nil {
					t.Fatal(err)
				}
			},
			p:       api.GetVisualizationParams{Wait: ptr(20), Since: ptr(0)},
			events:  moveOn,
			status:  "building",
			version: 1,
		},
		{
			name: "a final status returns at once",
			prepare: func(t *testing.T, h *harness, v api.Visualization) {
				l := h.claim(t, traceOf(t, h.db, v.ID))
				if err := h.q.Fail(t.Context(), l, api.FailureKindInternalError, nil, h.now); err != nil {
					t.Fatal(err)
				}
			},
			p:       api.GetVisualizationParams{Wait: ptr(20), Since: ptr(1)},
			events:  moveOn,
			status:  "failed",
			version: 1,
		},
		{
			name: "a detached visualization returns at once",
			prepare: func(t *testing.T, h *harness, v api.Visualization) {
				h.create(t, "ip:other", "x")
				if err := h.Delete(t.Context(), v.ID); err != nil {
					t.Fatal(err)
				}
			},
			p:       api.GetVisualizationParams{Wait: ptr(20), Since: ptr(0)},
			events:  moveOn,
			status:  "canceled",
			version: 0,
		},
		{
			name: "a pod that parks its most requests refuses to wait",
			p:    api.GetVisualizationParams{Wait: ptr(20), Since: ptr(0)},
			events: func(*harness) waitFunc {
				return func(context.Context, string, int64) error { return domain.ErrCapacity }
			},
			err: domain.ErrCapacity,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t, 100)
			v := h.create(t, "ip:1", "x")
			if tt.prepare != nil {
				tt.prepare(t, h, v)
			}
			h.Events = tt.events(h)

			got, err := h.Get(t.Context(), v.ID, tt.p)
			if !errors.Is(err, tt.err) {
				t.Fatalf("err = %v, want %v", err, tt.err)
			}
			if got.Status != tt.status || got.Version != tt.version {
				t.Errorf("got %s at version %d, want %s at version %d", got.Status, got.Version, tt.status, tt.version)
			}
		})
	}
}

func TestDeleteCancelsTheJobOnlyOnceNoOtherVisualizationWaits(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	h := newHarness(t, 100)
	a, b := h.create(t, "ip:1", "x"), h.create(t, "ip:2", "x")
	id := traceOf(t, h.db, a.ID)

	if err := h.Delete(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	want := map[string]api.VisualizationStatus{a.ID: "canceled", b.ID: "queued"}
	if diff := cmp.Diff(want, h.statuses(t, a, b)); diff != "" {
		t.Errorf("statuses after the first delete (-want +got):\n%s", diff)
	}
	if got := readJob(t, h.db, id).Status; got != "queued" {
		t.Errorf("job after the first delete is %s, want queued", got)
	}

	if err := h.Delete(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if got := readJob(t, h.db, id).Status; got != "canceled" {
		t.Errorf("job after the last delete is %s, want canceled", got)
	}
	if got := readTrace(t, h.db, id).Status; got != "canceled" {
		t.Errorf("trace after the last delete is %s, want canceled", got)
	}
	if err := h.Delete(ctx, b.ID); err != nil {
		t.Errorf("deleting again: %v", err)
	}
	if err := h.Delete(ctx, "viz_0123"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown id: err = %v, want ErrNotFound", err)
	}
}

func TestCleanupDeletesExpiredRowsAndChunksButNotATraceJustReset(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	h := newHarness(t, 100)
	gone, reset := h.create(t, "ip:1", "gone"), h.create(t, "ip:2", "reset")
	goneTrace, resetTrace := traceOf(t, h.db, gone.ID), traceOf(t, h.db, reset.ID)
	h.complete(t, goneTrace)
	h.complete(t, resetTrace)
	h.now = day0.Add(8 * 24 * time.Hour)
	again := h.create(t, "ip:3", "reset")

	if err := h.Cleanup(ctx, h.now); err != nil {
		t.Fatal(err)
	}

	if diff := cmp.Diff([]string{again.ID}, ids(t, h.db, "SELECT id FROM visualizations")); diff != "" {
		t.Errorf("visualizations left (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff([]string{resetTrace}, ids(t, h.db, "SELECT id FROM traces")); diff != "" {
		t.Errorf("traces left (-want +got):\n%s", diff)
	}
	if n := countRows(t, h.db, "SELECT COUNT(*) FROM jobs WHERE trace_id = ?", goneTrace); n != 0 {
		t.Errorf("%d jobs left for the deleted trace, want 0", n)
	}
	assertNoChunks(t, h.b, goneTrace)
	if resp := get(t, http.MethodGet, h.b.url+"/"+domain.ChunkKey("t7", resetTrace, 0)); resp.StatusCode != http.StatusOK {
		t.Errorf("chunk of the reset trace: HTTP %d, want 200", resp.StatusCode)
	}
	if _, err := h.Get(ctx, gone.ID, api.GetVisualizationParams{}); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("deleted visualization: err = %v, want ErrNotFound", err)
	}
}

func TestCleanupDeletesInBatchesUntilNothingExpiredIsLeft(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		traceExpiry time.Time
		wantTraces  int
	}{
		{"over 1,000 expired traces", day0.Add(-time.Second), 0},
		{"over 1,000 expired visualizations of live traces", day0.Add(time.Hour), 1001},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t, 100)
			addExpired(t, h.db, "a", 1000, tt.traceExpiry)
			addExpired(t, h.db, "b", 1, tt.traceExpiry)

			if err := h.Cleanup(t.Context(), day0); err != nil {
				t.Fatal(err)
			}

			if n := countRows(t, h.db, "SELECT COUNT(*) FROM visualizations"); n != 0 {
				t.Errorf("%d visualizations left, want 0", n)
			}
			if n := countRows(t, h.db, "SELECT COUNT(*) FROM traces"); n != tt.wantTraces {
				t.Errorf("%d traces left, want %d", n, tt.wantTraces)
			}
		})
	}
}

func TestCleanupLeavesChunksItCannotDeleteAndLogsTheirTraces(t *testing.T) {
	h := newHarness(t, 100)
	v := h.create(t, "ip:1", "x")
	id := traceOf(t, h.db, v.ID)
	h.complete(t, id)
	h.Blobs = blobStore(t, closedEndpoint(t), "down")
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	if err := h.Cleanup(t.Context(), day0.Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}

	if n := countRows(t, h.db, "SELECT COUNT(*) FROM traces"); n != 0 {
		t.Errorf("%d traces left, want 0", n)
	}
	var logged []string
	for line := range strings.Lines(logs.String()) {
		var rec struct {
			Msg      string   `json:"msg"`
			TraceIDs []string `json:"trace_ids"`
		}
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatal(err)
		}
		logged = append(logged, rec.Msg+" "+strings.Join(rec.TraceIDs, ","))
	}
	if diff := cmp.Diff([]string{"chunks of expired traces left behind " + id}, logged); diff != "" {
		t.Errorf("log records (-want +got):\n%s", diff)
	}
}

func TestLanguagesListsTheEnabledManifests(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	for name, m := range map[string]string{
		"kotlin": `id: kotlin
displayName: "Kotlin 2.2"
editorMode: kotlin-mode
image: kotlin
sourceFile: Main.kt
trace: {cmd: [trace]}
capabilities: {returnValues: true, pointers: false, exceptions: true, startAtLines: true, captureRanges: false}
enabled: true
`,
		"cobol": `id: cobol
displayName: COBOL
editorMode: text
image: cobol
sourceFile: main.cbl
trace: {cmd: [trace]}
enabled: false
`,
	} {
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

	want := api.Languages{Languages: []api.Language{{
		ID:          "kotlin",
		DisplayName: "Kotlin 2.2",
		EditorMode:  "kotlin-mode",
		Visualize: api.VisualizeSupport{
			Enabled:      true,
			Capabilities: api.Capabilities{ReturnValues: true, Exceptions: true, StartAtLines: true},
			Limits:       api.StepLimits{MaxSteps: 1000, MaxStepsCeiling: 5000},
		},
	}}}
	if diff := cmp.Diff(want, app.Languages(set)); diff != "" {
		t.Errorf("languages (-want +got):\n%s", diff)
	}
}

type harness struct {
	*app.Visualizations
	db  *sql.DB
	q   *mysql.Queue
	b   bucket
	now time.Time
}

func newHarness(t *testing.T, maxQueued int) *harness {
	t.Helper()
	h := &harness{db: newDB(t), b: newBucket(t), now: day0}
	h.q = mysql.NewQueue(h.db)
	h.Visualizations = &app.Visualizations{
		Store:    mysql.NewStore(h.db, maxQueued),
		Adapters: fakeAdapters(t),
		Blobs:    h.b,
		Events: waitFunc(func(context.Context, string, int64) error {
			return errors.New("no wait expected")
		}),
		Now:    func() time.Time { return h.now },
		Random: &counterReader{},
	}
	return h
}

func request(source string) api.CreateVisualizationRequest {
	return api.CreateVisualizationRequest{Language: "nobuild", Source: source, Options: trace.Options{MaxSteps: 1000, StartAtLines: []int{}}}
}

func (h *harness) create(t *testing.T, subject, source string) api.Visualization {
	t.Helper()
	v, err := h.Create(t.Context(), app.Caller{Subject: subject}, "", request(source))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return v
}

func (h *harness) createWithKey(t *testing.T, c app.Caller, key string) api.Visualization {
	t.Helper()
	v, err := h.Create(t.Context(), c, key, request("a"))
	if err != nil {
		t.Fatalf("create with key %s: %v", key, err)
	}
	return v
}

func (h *harness) statuses(t *testing.T, vs ...api.Visualization) map[string]api.VisualizationStatus {
	t.Helper()
	got := map[string]api.VisualizationStatus{}
	for _, v := range vs {
		cur, err := h.Get(t.Context(), v.ID, api.GetVisualizationParams{})
		if err != nil {
			t.Fatal(err)
		}
		got[v.ID] = cur.Status
	}
	return got
}

func (h *harness) claim(t *testing.T, traceID string) ports.Lease {
	t.Helper()
	job, err := h.q.Claim(t.Context(), "w1", h.now)
	if err != nil {
		t.Fatal(err)
	}
	if job.Lease.TraceID != traceID {
		t.Fatalf("claimed trace %s, want %s", job.Lease.TraceID, traceID)
	}
	return job.Lease
}

func (h *harness) complete(t *testing.T, traceID string) {
	t.Helper()
	ctx := t.Context()
	l := h.claim(t, traceID)
	if err := h.q.Tracing(ctx, l, h.now); err != nil {
		t.Fatal(err)
	}
	if err := h.b.Put(ctx, domain.ChunkKey("t7", traceID, 0), chunkBody(t)); err != nil {
		t.Fatal(err)
	}
	sha, size := chunkSum(t)
	err := h.q.Complete(ctx, l, ports.CompletedTrace{
		Header:        completedHeader(traceID),
		Chunks:        []ports.Chunk{{Index: 0, FromStep: 0, ToStep: 2, SizeBytes: size, SHA256: sha}},
		ExitKind:      trace.ExitKindNormal,
		StoragePrefix: "t7",
		Build:         json.RawMessage(`{"ok":true,"durationMs":640,"diagnostics":[]}`),
	}, h.now)
	if err != nil {
		t.Fatal(err)
	}
}

func completedHeader(traceID string) json.RawMessage {
	return json.RawMessage(`{"version":"1.0","id":"` + traceID + `",` +
		`"language":{"id":"nobuild","runtime":"fake 1","adapter":"fake/1"},"source":{"file":"main.fake","lineCount":1},` +
		`"options":{"maxSteps":1000,"startAtLines":[]},` +
		`"summary":{"stepCount":3,"truncated":false,"truncation":null,"exit":{"kind":"normal","code":0,"signal":null,"message":null}},` +
		`"encoding":{"mode":"delta","keyframeInterval":50}}`)
}

func chunkBody(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(`[{"line":1},{"line":2},{"line":3}]`)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func chunkSum(t *testing.T) (string, int) {
	t.Helper()
	body := chunkBody(t)
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), len(body)
}

type waitFunc func(ctx context.Context, traceID string, since int64) error

func (f waitFunc) Wait(ctx context.Context, traceID string, since int64) error {
	return f(ctx, traceID, since)
}

type counterReader struct{ n atomic.Uint64 }

func (r *counterReader) Read(p []byte) (int, error) {
	clear(p)
	binary.BigEndian.PutUint64(p[len(p)-8:], r.n.Add(1))
	return len(p), nil
}

func traceOf(t *testing.T, db *sql.DB, vizID string) string {
	t.Helper()
	var id string
	if err := db.QueryRowContext(t.Context(), "SELECT trace_id FROM visualizations WHERE id = ?", vizID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func expiresAt(t *testing.T, db *sql.DB, vizID string) time.Time {
	t.Helper()
	var at time.Time
	if err := db.QueryRowContext(t.Context(), "SELECT expires_at FROM visualizations WHERE id = ?", vizID).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return at
}

func setUsage(t *testing.T, db *sql.DB, subject string, day time.Time, count int) {
	t.Helper()
	_, err := db.ExecContext(t.Context(),
		"INSERT INTO usage_daily (subject, day, count) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE count = new.count",
		subject, domain.QuotaDay(day), count)
	if err != nil {
		t.Fatal(err)
	}
}

func usage(t *testing.T, db *sql.DB, subject string, day time.Time) int {
	t.Helper()
	return countRows(t, db, "SELECT COALESCE(SUM(count), 0) FROM usage_daily WHERE subject = ? AND day = ?", subject, domain.QuotaDay(day))
}

func countRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(t.Context(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func ids(t *testing.T, db *sql.DB, query string) []string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func addExpired(t *testing.T, db *sql.DB, prefix string, n int, traceExpiry time.Time) {
	t.Helper()
	ctx := t.Context()
	expired := day0.Add(-time.Second)
	_, err := db.ExecContext(ctx, `INSERT INTO traces (id, cache_key, language, source, stdin, options, status, updated_at, expires_at)
		WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		SELECT CONCAT('trc_', ?, i), UNHEX(SHA2(CONCAT(?, i), 256)), 'nobuild', '', '', '{"maxSteps":1000,"startAtLines":[]}', 'completed', ?, ? FROM n`,
		n, prefix, prefix, expired, traceExpiry)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO visualizations (id, trace_id, subject, created_at, expires_at)
		WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		SELECT CONCAT('viz_', ?, i), CONCAT('trc_', ?, i), 'ip:1', ?, ? FROM n`,
		n, prefix, prefix, expired, expired)
	if err != nil {
		t.Fatal(err)
	}
}

func jsonValue(t *testing.T, raw []byte) any {
	t.Helper()
	if raw == nil {
		return nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func checkContract(t *testing.T, v api.Visualization) {
	t.Helper()
	const spec = "../../api/openapi.yaml"
	raw, err := os.ReadFile(spec)
	if err != nil {
		t.Fatal(err)
	}
	js, err := yaml.YAMLToJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(js))
	if err != nil {
		t.Fatal(err)
	}
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	if err := c.AddResource(spec, doc); err != nil {
		t.Fatal(err)
	}
	sch, err := c.Compile(spec + "#/components/schemas/Visualization")
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if err := sch.Validate(inst); err != nil {
		t.Errorf("visualization breaks the API contract: %v", err)
	}
}
