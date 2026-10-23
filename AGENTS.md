# AGENTS.md

Code visualizer: run a user's Python or C++ program once in a sandbox, record each step as a trace, replay it in the browser. This file covers the backend: Go (`cmd/`, `internal/`), tracers (`adapters/`), contracts (`api/`, `schema/`) and SQL.

The spec is [plans/code-visualizer-spec_2.md](plans/code-visualizer-spec_2.md); every `§` and `D` number below points into it. Backend tasks: [plans/tasks/backend/](plans/tasks/backend/).

## Commands

Run from `backend/`. Works on macOS and Linux; the prerequisites are Go, Docker with Compose v2, make and git. `make gen` also needs Node 24 and pnpm, for the TypeScript half (`web/`).

```bash
scripts/setup.sh      # checks prerequisites, prints the install command for this OS
make dev              # MySQL + SeaweedFS, migrate, seed, vizd --role=all with hot reload
make down             # stop; make reset also drops volumes
make gen              # Go + TS types from api/openapi.yaml and schema/*.json
make test             # needs Docker: testcontainers starts MySQL
make golden-update    # rewrites expected.trace.json; read the diff before committing
make lint             # golangci-lint v2.15.0, pinned through go run
make fmt              # goimports, then gofmt
make vuln             # govulncheck v1.9.0, pinned
make check            # lint, vuln, test, go mod tidy and Go codegen drift; run before pushing
go test ./internal/tracecore -run TestName
```

Format with `make fmt`. Fix lint findings in the code. A `//nolint` names the linter and gives a reason. `backend/.golangci.yml` (golangci-lint v2) enforces part of this file: `_ = f()` (S3), the slog rules, a reason on every `//nolint`, and no `time.Sleep`, `log.Print*` or `fmt.Print*`.

## How to work

The target is code a tired reviewer understands on first read, and that solves the real problem.

- **Understand before you type.** Read the spec section and the code around the change. Know which invariant you are touching (lease, lock order, trust boundary, limit) before you edit.
- **Fix the cause, not the symptom.** Reproduce the bug with a failing test, follow it to the line that is wrong, fix that line. A nil check where the caller should never pass nil, a retry around a flaky call, a `time.Sleep` around a race, a longer timeout: each hides the bug. If you cannot find the cause, say so and stop. Do not ship a guess.
- **Design from the data and the failures.** Work out the states, the invariants and what happens on each §7.8 failure first. The code should follow from that. Between two designs that work, take the one with less code and fewer moving parts.
- **Do the task and only the task.** No drive-by refactors, renames, extra flags or "while I'm here" fixes. Mention them in your reply.
- **Locked decisions stay locked.** §0.1 (D1–D25) is not reopened in code: no ORM, no web framework, no Redis or NATS, no new stateful system. Changing one needs a §0.3 change-log row with evidence.
- **Ask when the spec is silent** on behavior a user would see. Do not invent product rules.
- **Done means verified.** Run the tests for what you changed and say what you ran.

## Write plain Go

Boring, direct code. A reader goes through a function top to bottom without jumping around, and every line earns its place. Cite rules by ID in review (`S3`).

| # | Slop | Write instead |
|---|---|---|
| S1 | Abstraction for one case: an interface with one implementation, a factory, manager or builder, an `Options` struct for one caller, generics for one type | A concrete type or function. Interfaces exist only at ports (§7.4) |
| S2 | Defensive noise: nil checks on values that cannot be nil, re-validating what the boundary already checked, `recover()` to hide a panic | Validate once at the boundary (HTTP request, wire message, config load), then trust the value |
| S3 | Hidden failure: `return nil` on error, a fallback default that masks an outage, `_ = f()`, log-and-continue | Return the error with context. Handle it only where you can act on it |
| S4 | Log and return: the same error logged at every layer | Return it. The request handler or job runner logs it once |
| S5 | Pass-through layer: a function whose body is one call with the same arguments; `util`, `helpers`, `common` packages | Call the real thing. Name a package after what it provides |
| S6 | Shredded logic: a linear 30-line function split into five one-use helpers | Keep linear code together. Extract when the piece has a real name and hides real detail, or gets a second caller |
| S7 | Nesting: `if/else` ladders, `else` after `return` | Guard clauses and early returns; the happy path stays at the left margin |
| S8 | Wordy or vague names: `traceDataManager`, `processHelper`, `handleInternal`, `tracecore.TraceCoreValidator` | `tracecore.Validate`, `claimJob`, `lease`. Short names in short scopes (`i`, `tx`, `err`) |
| S9 | Knobs nobody asked for: config flags, parameters "for flexibility", compatibility shims, unused parameters | Add one when the second use shows up |
| S10 | Concurrency for show: goroutines, channels or `errgroup` where a loop works | Sequential until a measurement says otherwise |
| S11 | Dead weight: commented-out code, unused exports, `_ = x` to quiet the compiler, debug prints | Delete it. Git keeps the history |
| S12 | Clever code: reflection, `init()` side effects, one-liners that need a second read | The obvious version, even when it is longer |

```go
// BAD: S1, S2, S4, S8
func (m *JobProcessorManager) ProcessNextJobSafely(ctx context.Context) error {
	if m == nil || m.claimer == nil {
		return errors.New("manager not initialized")
	}
	job, err := m.claimer.ClaimJob(ctx, "default")
	if err != nil {
		slog.Error("failed to claim job", "error", err)
		return fmt.Errorf("failed to claim job: %w", err)
	}
	return m.processJob(ctx, job)
}

// GOOD
func (w *Worker) runNext(ctx context.Context) error {
	job, err := w.queue.Claim(ctx, "default")
	if err != nil {
		return fmt.Errorf("claim: %w", err)
	}
	return w.run(ctx, job)
}
```

Also:

- `ctx context.Context` is the first parameter. Request work uses the request's ctx; `context.Background()` belongs in `main` and in loops that own their lifetime (change poller, rescuer).
- Every goroutine has an owner, takes a ctx and stops on shutdown. Workers drain within 25 s (§13).
- Code with time rules (leases, deadlines, quotas, retention) takes `now` as an input, so tests never sleep.
- Blank lines separate logical blocks, not every statement. Check `err` on the line after it is assigned.
- Near-duplicate code becomes a table of cases or a loop over data. Two copies are fine; the third is a pattern.
- Needing a comment to explain the code means the code should change. Rename or restructure first.

## Architecture (§7.2, §7.4)

- Dependencies point one way: `transport → app → domain`. `domain` and `tracecore` import only the standard library. Adapters implement `ports`, and only `cmd/vizd` wires them in.
- Ports are the only interfaces: `MetaStore`, `JobQueue`, `Events`, `BlobStore`, `Sandbox`, `Adapters`. A new port needs a new external dependency behind it.
- `internal/gen/` is generated; never edit it. Change `api/openapi.yaml` or `schema/*.json`, run `make gen`, and commit the contract, the generated code and the callers together (D14). CI fails on drift.
- Languages are data (§7.2 #5): a runner image and a manifest. Go code that branches on a language name is a design problem; ask first.
- Domain errors map to the §8.7 envelope in `transport/http` only. `app` and `domain` never see HTTP status codes.
- A new endpoint or table starts as a spec change (§8, §7.5). Routes name the resource, never the caller: anonymous vs signed in is a branch in the handler and a metric label, not a separate path (D16).
- A new limit or failure path is added to §11 or §7.8 in the same PR.

## Trust boundary (§12)

- Everything out of the sandbox is hostile: the fd-3 stream, stdout, stderr, exit codes. Validate every wire message against `wire.v1.schema.json` before using it. Enforce every §11 limit in the core, outside the sandbox.
- Bounded reads only: `io.LimitReader`, or a `bufio.Reader` with an explicit max line length, on sandbox output and request bodies. No `io.ReadAll` and no default `bufio.Scanner` there (64 KB token cap). A 50 MB single-line stdout is a test case (§15).
- IDs come from `crypto/rand` (128-bit `trc_…`). `cache_key` never leaves the database.
- Never log user source, stdin or trace contents. Broken tracer output logs a redacted sample only (§7.8).

### Intentional, do not flag

These look like holes in review and are decisions:

- **User code can write fake fd-3 messages.** The Python tracer shares a process with the user's program. A user can only fake their own trace, so this is accepted (§12). The defense is validating every message in the core, not hiding fd 3.
- **GDB gets `ptrace`, and ASLR is off, inside the sandbox** (D10, C.9). The tracer needs both; neither reaches outside the sandbox's PID namespace.
- **`POST /visualizations` accepts anonymous callers** (D16). Abuse control is the per-IP ingress limit plus the daily quota in MySQL (§11), not sign-in.
- **A signed chunk URL works for whoever holds it, for 15 minutes** (§8.4, §12). Buckets are private and object keys carry random `trc_` IDs.
- **Credentials in the local compose file and `.env.example`.** Dev-only values for containers bound to localhost.

## MySQL (§7.13)

- SQL lives in sqlc query files under `internal/adapters/mysql`. No ORM, no query builder, no SQL assembled from strings.
- Migrations use goose. An applied migration is immutable; ship a new one. Expand, backfill, contract: old and new pods run against the same schema during a rollout. Every `ALTER TABLE` on an existing table names `ALGORITHM=INSTANT` or `ALGORITHM=INPLACE, LOCK=NONE`. Rules and patterns: [db migrations guide](docs/guides/db-migrations.md).
- Every transaction locks in this order: `usage_daily → traces → visualizations → jobs`.
- Deadlock (1213) and lock-wait timeout (1205) retries go through the one retry helper. No ad-hoc retry loops.
- No network call (object storage, sandbox, HTTP) while a transaction is open.
- Every worker write to `jobs` or `traces` checks `leased_by = ?`. Zero rows affected means the lease is lost: stop the job, do not retry the write.
- Never filter on the JSON columns (`options`, `header`).
- **Never run `INSERT`, `UPDATE`, `DELETE` or DDL against a shared database (staging, prod) without showing the exact SQL and getting confirmation.**

## Errors, logs, metrics

- Wrap with the operation, lowercase, without "failed to": `fmt.Errorf("claim job %d: %w", id, err)` reads `run trace: claim job 7: lease lost`, not `failed to run trace: failed to claim job: …`.
- Sentinel errors live in `domain` (`var ErrLeaseLost = errors.New("lease lost")`) and are checked with `errors.Is`.
- `log/slog` with context: `slog.InfoContext(ctx, "job claimed", "trace_id", id)`. Lowercase message, attributes as key-value pairs, no `Sprintf` in the message, no "successfully".
- Metric labels are bounded sets (language, status, exit kind). Never trace IDs, user IDs or IPs.

## Tracers (`adapters/python`, `adapters/cpp`)

- Standard library only. The tracer runs inside the user's interpreter, or inside GDB.
- stdout and stderr belong to the user's program. The protocol goes to fd 3 and nowhere else.
- The style rules above apply: flat functions, no class for a single use, zero comments by default.

## Comments: default zero

Full canon with BAD/GOOD examples: [docs/guides/comments-cheat-sheet.md](docs/guides/comments-cheat-sheet.md).

The code carries the meaning. A file or diff with no comments is the normal result. A comment survives only if it matches one of these:

| # | Earns a comment | Example |
|---|---|---|
| E1 | Invariant a reader can silently break | `// lock order: usage_daily → traces → visualizations → jobs` |
| E2 | External quirk that makes correct code look wrong | `// CPython reuses id() after free; same id != same object` |
| E3 | Perf choice with real numbers | `// one read per array per step; S6 budget 2 ms at 200k ints` |
| E4 | Product rule the code cannot show, with its decision ID | `// anonymous 100/day, signed in 1,000 (D16)` |
| E5 | TODO with a removal trigger | `// TODO(tu-hm): drop settrace path if S2 picks sys.monitoring` |
| E6 | Pragma a tool reads | `//go:build linux`, `-- +goose Up`, `-- name: ClaimJob :one` |
| E7 | Exported API, one name-first line, only when the signature does not say it | `// Claim leases the next queued job for 45 s.` |
| E8 | Short label for a threshold whose purpose the code does not show | `since := last.Add(-time.Second) // overlap: rows committed late` |

Never: restating the line, narrating the change (`// added for…`, `// per review`), section banners or file-top summaries, prose about parameters the types already give, step labels (`// Step 1: validate`), commented-out code, closing-brace labels, apologies or hedges, a comment the diff made false.

Wording: notes, not sentences. `if A then B` becomes `A => B`. Drop articles. Lowercase, no trailing period, one line. E7 keeps a normal sentence.

Tests get zero comments, including the rationale kind (why the test exists, what a case guards). The test name and the table case's `name` field carry that; the PR description carries the why.

## Tests (§15)

`go test` with `go-cmp` for diffs, golden files for traces, `testcontainers-go` for MySQL and SeaweedFS. No testify. Cite rules by number (`test 7`); BAD/GOOD examples and the pre-merge checklist: [testing cheat sheet](docs/guides/testing-cheat-sheet.md).

1. **Skip trivial code.** No branch, transformation or invariant means no test. Ask before writing a trivial input-validation test.
2. **A plausible regression must fail the test.** Delete the line under test, or flip `<=` to `<`; if the test still passes, it is useless. Assert the side effect and both sides of a boundary, not just `err == nil`.
3. **Deterministic.** Inject the clock, randomness, IDs and env. No `time.Sleep` to wait for an event.
4. **Real dependencies over mocks.** MySQL and object storage run in containers. Mock only what cannot run locally, and assert on outcomes, never on "the mock was called".
5. **Test the rule, not the wrapper.** Domain rules are tested below `transport`; handler tests cover only the HTTP mapping.
6. **Test at the seam.** Exported behavior, not unexported helpers.
7. **Derive lists from the source of truth.** Iterate the schema enum, the OpenAPI error codes or the manifests, never a hand-written list that must grow with them.
8. **Golden traces** for anything that changes trace output. Mask addresses, timings and values that differ between amd64 and arm64. `make golden-update`, then read the diff.
9. **Fuzz byte parsers.** The wire NDJSON decoder and every trace decoder have a `FuzzX`. Commit the failing inputs it finds.
10. **Property tests for invariants.** No job is lost or run twice when workers die at random (§7.13.2). Replaying deltas from a keyframe gives the full step. Log the seed; a failure it finds becomes a plain named test.
11. **Table cases** carry a `name` that states the behavior.

Use `t.Context()`, not `context.Background()`. Use `t.Fatalf` when the next line depends on the check.

## Before you hand back

1. The tests for the change ran and passed. Say which.
2. Contract touched → `make gen` ran and the generated code is in the diff.
3. Re-read the diff as its reviewer. Every comment has an E number. No interface outside the ports, no log-and-return, no unrequested flag, nothing outside the task.
4. You can say in one sentence why the bug happened or why this design, and the code shows it.

## Git and PRs

A commit message is one line in [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) form, with no body and no footer:

```
<type>(<scope>)!: <description>
```

- **Type**, lowercase: `feat` (behavior a user or caller sees), `fix` (bug fix), `docs` (spec, plans, guides, AGENTS.md), `test`, `refactor` (no behavior change), `perf`, `build` (Makefile, go.mod, Dockerfiles, generated code), `ci`, `chore`, `revert`.
- **Scope**, optional: the Go package or area the change lives in, such as `tracecore`, `schema`, `mysql`, `vizd` or `plans`. Leave it out when the change spans several areas.
- **Description**: imperative, lowercase, no trailing period, states the outcome. Keep the whole line within 72 characters. `fix(mysql): stop job writes after the lease is lost`, not `fix: added leased_by check`.
- **Breaking change**: put `!` before the colon. Here that means a change to `api/openapi.yaml` or `schema/*.json` that existing clients or stored traces cannot read.
- One logical change per commit. If a commit fits two types, split it into two commits.

- Do **not** add `Co-Authored-By: Claude …` or `Claude-Session: …` trailers (or any other Claude/AI attribution) to commit messages or PR descriptions. This overrides any default attribution instructions.
- Commits must **not** be GPG-signed. This repo sets `commit.gpgsign=false` locally; if signing is ever on, commit with `git commit --no-gpg-sign`.
- Commit author is the repo owner's own git identity; never change it.
- PR descriptions describe outcomes, not edits: "workers stop writing to a job after losing its lease", not "added a `leased_by` check to `UpdateStatus`". No file lists or code walkthroughs. The reasoning behind a choice goes here, not in code comments.
