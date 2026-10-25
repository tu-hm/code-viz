# Testing Cheat Sheet

11 rules. Cite them by number in review (`test 7`). Tools: `go test`, `go-cmp`, golden files and `testcontainers-go` (§15, §18.2). No testify.

| # | Rule | The tell in review |
|---|---|---|
| 1 | **Skip trivial.** No branch, transformation or invariant => no test. | 1:1 call-return; the function under test has no conditional |
| 2 | **A plausible regression must fail the test.** Delete the line under test, or flip `<=` to `<`; the test goes red. | Ends on `err == nil`; never checks the side effect; one value per boundary |
| 3 | **Deterministic.** Inject the clock, randomness, IDs and env. | `time.Now()`, `rand.*`, `os.Getenv` inside the code under test; `time.Sleep` in the test; a retry around a flaky test |
| 4 | **Real dependencies over mocks.** MySQL and SeaweedFS run in containers. Assert on outcomes. | A fake `MetaStore` in a query test; `if !fake.called` |
| 5 | **Test the rule, not the wrapper.** Domain rules are tested in `domain` and `app`; handler tests cover only the HTTP mapping. | An `httptest` round trip to check a limit |
| 6 | **Test at the seam.** Exported behavior, from a `_test` package. | Calls to unexported helpers; poking at struct internals |
| 7 | **Derive lists from the source of truth.** Iterate the schema enum, the OpenAPI error codes, the manifest. | A hand-written `[]string{...}` that must grow when the schema does |
| 8 | **Golden traces** for anything that changes trace output. Mask addresses and timings. | Field-by-field asserts on a trace |
| 9 | **Fuzz byte parsers.** | Code decodes NDJSON, JSON or bytes, and its test file has no `Fuzz*` |
| 10 | **Property tests for invariants.** | Three hand-picked cases for a rule that must hold for every input |
| 11 | **Table cases carry a `name`** that states the behavior. | `{"case 1", ...}`, or a comment above a case |

## BAD vs GOOD

Examples show the shape. Names are illustrative.

### 1. Skip trivial

```go
// BAD: a field read; catches nothing
func TestTraceID(t *testing.T) {
	tr := Trace{ID: "trc_1"}
	if tr.ID != "trc_1" {
		t.Fatal("wrong id")
	}
}

// GOOD: skip the field; test a rule
func TestParseTraceIDRejectsVisualizationPrefix(t *testing.T) {
	if _, err := domain.ParseTraceID("viz_8f2c"); !errors.Is(err, domain.ErrBadID) {
		t.Fatalf("err = %v, want ErrBadID", err)
	}
}
```

### 2. A plausible regression must fail

```go
// BAD: never looks at the boundary; `>` vs `>=` both pass
func TestQuotaAllowsRequest(t *testing.T) {
	if err := quota.Take(ctx, anon, day); err != nil {
		t.Fatal(err)
	}
}

// GOOD: the 100th request passes, the 101st fails (D16)
func TestQuotaRejectsAnonymousAfter100(t *testing.T) {
	for i := range 100 {
		if err := quota.Take(ctx, anon, day); err != nil {
			t.Fatalf("request %d: %v", i+1, err)
		}
	}
	if err := quota.Take(ctx, anon, day); !errors.Is(err, domain.ErrQuotaExceeded) {
		t.Fatalf("request 101: err = %v, want ErrQuotaExceeded", err)
	}
}
```

Line coverage does not count. A test that runs every line and asserts only `err == nil` lets every mutation through. Boundary pairs (100 passes, 101 fails) catch operator swaps.

### 3. Deterministic

```go
// BAD: reads the wall clock; the result depends on when CI runs
func TestRetryAfterIsBeforeMidnight(t *testing.T) {
	if got := domain.QuotaRetryAfter(); got <= 0 || got > 24*time.Hour {
		t.Fatalf("QuotaRetryAfter = %v", got)
	}
}

// GOOD: now is an input, so the answer is exact
func TestQuotaRetryAfterEndsAtUTCMidnight(t *testing.T) {
	now := time.Date(2026, 11, 2, 23, 59, 40, 0, time.UTC)
	if got := domain.QuotaRetryAfter(now); got != 20*time.Second {
		t.Fatalf("QuotaRetryAfter = %v, want 20s", got)
	}
}
```

The same applies to IDs: `domain.NewTraceID(r io.Reader)` takes the random source, production passes `crypto/rand.Reader`, and a test passes fixed bytes. Never wait for an event with `time.Sleep`. Wait on a channel, or drive the loop one tick at a time.

### 4. Real dependencies over mocks

```go
// BAD: tests the fake, not the SQL
store := &fakeStore{}
app.New(store).Create(ctx, req)
if !store.inserted {
	t.Fatal("trace not inserted")
}

// GOOD: real MySQL; assert what the second caller sees (single-flight, §7.12)
func TestCreateReusesTraceForIdenticalRequest(t *testing.T) {
	svc := app.New(mysqltest.New(t)) // MySQL 8.4 container, migrated
	first, err := svc.Create(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Create(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if first.TraceID != second.TraceID {
		t.Fatalf("second create got trace %s, want %s", second.TraceID, first.TraceID)
	}
}
```

Fake only what cannot run on a laptop or in CI. A `Sandbox` that replays recorded NDJSON from `fixtures/` is fine, because the test still asserts the trace that comes out, not that the fake was called.

### 5. Test the rule, not the wrapper

```go
// BAD: an HTTP round trip to test a §11 limit
rec := httptest.NewRecorder()
h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/visualizations", bigBody))
if rec.Code != http.StatusRequestEntityTooLarge {
	t.Fatalf("status = %d", rec.Code)
}

// GOOD: the limit is tested in domain
func TestValidateSourceRejectsOver64KB(t *testing.T) {
	src := strings.Repeat("x", 64<<10+1)
	if err := domain.ValidateSource(src); !errors.Is(err, domain.ErrPayloadTooLarge) {
		t.Fatalf("err = %v, want ErrPayloadTooLarge", err)
	}
}

// GOOD: the handler test covers only error -> status and code (§8.7)
func TestErrorEnvelope(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"payload too large maps to 413", domain.ErrPayloadTooLarge, 413, "payload_too_large"},
		{"quota exceeded maps to 429", domain.ErrQuotaExceeded, 429, "rate_limited"},
	}
	...
}
```

### 6. Test at the seam

```go
// BAD: package tracecore, calling an unexported helper
func TestDiffHeap(t *testing.T) { ... diffHeap(prev, next) ... }

// GOOD: package tracecore_test, through the exported API
func TestBuildEmitsDeltaBetweenKeyframes(t *testing.T) { ... tracecore.Build(msgs) ... }
```

If a private helper is complex enough to want its own tests, it has earned a name and a package of its own. Move it there and test that package's exported API.

### 7. Derive lists from the source of truth

```go
// BAD: grows by hand; a new kind ships without a fixture
kinds := []string{"sequence", "set", "mapping", "record", "function", "class", "opaque"}

// GOOD: read the enum from the schema the code is generated from
func TestEveryHeapKindHasAFixture(t *testing.T) {
	for _, kind := range schemaEnum(t, "trace.v1.schema.json", "/$defs/heapObject/properties/kind") {
		t.Run(kind, func(t *testing.T) {
			if !fixtureUses(t, kind) {
				t.Fatalf("no fixture under fixtures/ produces a %q object", kind)
			}
		})
	}
}
```

Other lists with a source: the §8.7 error codes in `api/openapi.yaml` (each maps to a status), the wire message types in `wire.v1.schema.json` (each has a decoder case), the languages in the adapter manifests (each passes the conformance suite).

### 8. Golden traces

```go
// BAD: three fields out of a whole trace
if tr.Steps[3].Line != 7 {
	t.Fatalf("line = %d", tr.Steps[3].Line)
}

// GOOD: the whole trace against the fixture, masked
func TestGoldenTraces(t *testing.T) {
	for _, dir := range fixtureDirs(t, "python") {
		t.Run(filepath.Base(dir), func(t *testing.T) {
			got := mask(build(t, dir))
			want := readTrace(t, filepath.Join(dir, "expected.trace.json"))
			if diff := cmp.Diff(want, got); diff != "" {
				t.Errorf("trace mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
```

Mask what changes between runs and machines: addresses, timings, and values that differ between amd64 and arm64 (padding, `long double`). Fixtures recorded on a Mac must pass on Linux CI. `make golden-update` rewrites `expected.trace.json`. Read the diff before you commit it.

### 9. Fuzz byte parsers

```go
func FuzzDecodeWire(f *testing.F) {
	for _, line := range lines(f, "testdata/wire/python.ndjson") {
		f.Add([]byte(line))
	}
	f.Add([]byte(`{"type":"step"`))
	f.Fuzz(func(t *testing.T, line []byte) {
		msg, err := tracecore.DecodeWire(line)
		if err == nil && msg.Type == "" {
			t.Fatalf("accepted %q without a type", line)
		}
	})
}
```

Run it with `go test ./internal/tracecore -fuzz=FuzzDecodeWire -fuzztime=30s`. A failing input lands in `testdata/fuzz/FuzzDecodeWire/` and runs on every later `go test`. Commit it. Every decoder of sandbox output gets one: the fd-3 NDJSON stream, stdout and stderr capture, and the trace decoder `vizctl` uses.

### 10. Property tests for invariants

Use them where the spec states an invariant over all inputs:

- No job is lost or run twice when workers die at random (§7.13.2). Real MySQL, workers killed at random points.
- Replaying deltas from the nearest keyframe gives the full step, for every step (§9).
- Chunk boundaries line up with keyframes (250 = 5 × 50).

```go
func TestDeltasReplayToFullSteps(t *testing.T) {
	seed := rand.Uint64()
	t.Logf("seed %d", seed)
	r := rand.New(rand.NewPCG(seed, seed))
	for range 200 {
		steps := randomSteps(r, 300)
		enc := tracecore.Encode(steps)
		for i := range steps {
			if diff := cmp.Diff(steps[i], enc.Replay(i)); diff != "" {
				t.Fatalf("seed %d, step %d (-full +replayed):\n%s", seed, i, diff)
			}
		}
	}
}
```

Log the seed so a failure can be replayed. Once one is found, copy the failing input into a plain named test next to the code that owns the bug and assert the right outcome. Rerunning the seed is not a regression test: the random sequence changes as soon as the generator does.

### 11. Table cases carry a name

```go
// BAD
{"1", hello, "/protocol", unset},
// hello needs a runtime
{"2", hello, "/runtime", unset},

// GOOD
{"hello without protocol", hello, "/protocol", unset},
{"hello without runtime", hello, "/runtime", unset},
```

## Go specifics

- `ctx := t.Context()`, not `context.Background()`. It is canceled when the test ends, so goroutines the test started stop with it.
- `t.Fatalf` when the next line depends on the check (an index, a dereference, a decoded value). `t.Errorf` when later checks still make sense on their own.
- `cmp.Diff(want, got)`, reported as `(-want +got)`. Compare whole values, not field by field.
- `t.Setenv`, `t.TempDir` and `t.Cleanup` instead of hand-rolled setup and teardown.
- Helpers call `t.Helper()` and take a `*testing.T` (or `testing.TB` when fuzz targets share them).
- Start one container per test package, not one per test. Each test gets its own database or its own rows, so tests do not see each other's data.
- Run `go test -race ./...` before pushing code with goroutines (worker, change poller, long-poll). It needs cgo and a C compiler: `xcode-select --install` on macOS, `gcc` from apt or dnf on Linux.

## Pre-merge checklist

For every new test:

1. What plausible regression does it catch?
2. Delete a line in the code under test. Does the test still pass?
3. Does it depend on the wall clock, randomness, the network or the filesystem?
4. Does it assert on a fake or on an outcome?
5. Does it test the domain rule or the transport wrapper?

If the answers are nothing, yes, yes, a fake, or the wrapper, fix the test or delete it.

## Tensions

- **Rule 1 vs 2:** a thin wrapper that carries a domain rule? Test the rule (5), not the wrapper.
- **Rule 6:** a private helper that deserves its own tests? Move it to its own package and test that package's API.
- **Rule 4 vs 10:** a property test built on fakes proves the fakes. Run it on the real dependency (the job-queue property test uses MySQL), or make the code under test pure first.
- **Rule 3 vs 10:** a property test uses randomness on purpose. It stays deterministic by logging its seed.

Tests carry zero comments: [comments cheat sheet](comments-cheat-sheet.md), "Tests get zero".
