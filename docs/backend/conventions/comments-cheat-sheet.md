# Code Comments Cheat Sheet

**Default = zero comments.** Not "few": zero. The code carries the meaning; rename, extract or simplify instead of explaining. A file, function or diff with no comments is the normal result.

A comment matches one of the eight exceptions below or it is deleted. The one close call is E8 vs N1: when a short label could be either, keep it. Cite rules by ID in review: `E4` for an exception, `N2` for a never, `T` for wording.

## Earns a comment (E1–E8)

| # | Earns it | Example |
|---|---|---|
| E1 | **Invariant a reader can silently break.** Lock order, call order, goroutine ownership, lease checks. | `// lock order: usage_daily → traces → visualizations → jobs` |
| E2 | **External quirk that makes correct code look wrong.** Runtime, debugger, driver or protocol behavior. | `// CPython reuses id() after free; same id != same object` |
| E3 | **Perf choice with real numbers.** No numbers, no comment. | `// one read per array per step; S6 budget 2 ms at 200k ints` |
| E4 | **Product rule the code cannot show.** Carries the spec decision or section that owns it; none exists => rule text alone. | `// anonymous 100/day, signed in 1,000 (D16)` |
| E5 | **TODO with a trigger.** Names the condition that removes it. | `// TODO(tu-hm): drop settrace path if S2 picks sys.monitoring` |
| E6 | **Pragma a tool reads.** | `//go:build linux`, `//go:generate`, `//nolint:gosec // path built from trc_ id`, `-- +goose Up`, `-- name: ClaimJob :one` |
| E7 | **Exported Go API.** One name-first line. Skip it when the signature already says it. Unexported code gets nothing unless E1–E6. | `// Claim leases the next queued job for 45 s.` |
| E8 | **Short label for a threshold or condition whose purpose the code does not show.** Names the why, not the mechanics. Prefer a named constant when the value is reused. | `since := last.Add(-time.Second) // overlap: rows committed late` |

**Density does not follow risk.** The sandbox boundary, the job queue and the trace core do not buy comments. They buy tests, names and smaller functions. Only E1–E4 legitimately grow there, and only because the invariant is real.

## Never (N1–N9)

| # | Never | Tell |
|---|---|---|
| N1 | **Restates the line.** | `// nil check`, `// loop over frames`, `// return error` |
| N2 | **Diff narration or journal.** Git owns this. | `// added for C++ support`, `// see PR #12`, `// 2026-11: refactored`, `// per review` |
| N3 | **Section banner or file-top summary.** | `// ==== helpers ====`, `// This file handles job claiming.` |
| N4 | **Parameter and return prose the types already give.** | `// ctx: context. id: the trace id. returns error.` |
| N5 | **Step labels.** | `// Step 1: validate`, `// First, load the trace` |
| N6 | **Commented-out code.** Delete it; git is the archive. | any `// if job.Attempt > 3 { ... }` block |
| N7 | **Closing-brace label.** | `} // end if`, `} // for steps` |
| N8 | **Apology or hedge.** Fix it, or state the constraint with a trigger (E5). | `// hacky, sorry`, `// not sure this is right` |
| N9 | **Stale comment.** A wrong comment is worse than none. Change the behavior, update or delete the comment in the same diff. | the comment describes the old branch |

A reference alone does not rescue a comment. `// added for D21` is N2. `// safety checks on by default (D21)` is E4. The rule must be in the comment, not only its ID.

## T: how to write the one that survives

Comments are notes, not prose. Fewest words that carry the fact. Applies to E1–E6 and E8; E7 keeps the godoc sentence because pkgsite renders it.

- **`if A then B` becomes `A => B`.** Same for cause: `A => B` reads "A leads to B".
- **Drop articles and filler.** No "the", "a", "we", "this is because", "in order to", "note that".
- **Lowercase start, no trailing period** on a one-line comment. E7 keeps capitals and a period.
- **One line.** Multi-line only for a numbered invariant list or one genuinely subtle algorithm.
- **Name the thing exactly.** `leased_by`, `claim_idx`, `1213`, `fd 3`. Never "the former", "the above call".
- **Technical terms stay bare and exact.** lease, keyframe, delta, SKIP LOCKED, ptrace, seccomp. Never swap a precise term for a vaguer one.

| Wordy | Terse |
|---|---|
| `// If the lease has expired we must not write to the job, because another worker may own it now.` | `// lease lost => another worker may own job; no writes` |
| `// We take the usage_daily lock first, otherwise we can deadlock against the create transaction.` | `// lock order: usage_daily first; create tx deadlocks otherwise` |
| `// Python reuses object ids after an object is freed, so the same id does not mean the same object.` | `// CPython reuses id() after free; same id != same object` |
| `// Anonymous users are limited to 100 visualizations per day, as decided in D16.` | `// anonymous 100/day (D16)` |

## BAD vs GOOD

Examples show the shape. Names are illustrative.

### E1 invariant

```go
// BAD: silent lock order; the next contributor deadlocks against create
q.LockTrace(ctx, id)
q.BumpUsage(ctx, userID, day)

// GOOD
// lock order: usage_daily → traces → visualizations → jobs
q.BumpUsage(ctx, userID, day)
q.LockTrace(ctx, id)
```

### E2 external quirk

```go
// BAD: looks like a redundant check
if prev, ok := seen[nativeID]; ok && prev.Type == obj.Type && prev.Live {

// GOOD
// CPython reuses id() after free; same id != same object
if prev, ok := seen[nativeID]; ok && prev.Type == obj.Type && prev.Live {
```

### E3 perf choice

```go
// BAD: a claim with no number, so nobody can re-check it
// reading the whole array is faster
buf, err := mem.Read(addr, n*elemSize)

// GOOD
// one read per array per step; S6 budget 2 ms at 200k ints
buf, err := mem.Read(addr, n*elemSize)
```

### E4 product rule

```go
// BAD: restates the constant, hides the rule
// max 100
if used >= anonDailyQuota {

// GOOD
// anonymous 100/day, signed in 1,000 (D16)
if used >= anonDailyQuota {
```

### E5 TODO with a trigger

```go
// BAD: no removal condition; rots forever
// TODO: clean this up later

// GOOD
// TODO(tu-hm): drop settrace path if S2 picks sys.monitoring
```

### E7 exported API

```go
// BAD: N1 dressed as a doc comment
// ID returns the ID.
func (t *Trace) ID() string { return t.id }

// GOOD: no comment; the signature says it
func (t *Trace) ID() string { return t.id }

// GOOD: the doc comment adds the contract
// Claim leases the next queued job for 45 s.
// Returns ErrNoJob when the queue is empty.
func (q *Queue) Claim(ctx context.Context, queue string) (Job, error) { ... }
```

### Rename instead of annotating

```go
// BAD: the comment makes up for the name
var lim int // max steps recorded, from the manifest or the default

// GOOD
var maxSteps int

// ALSO GOOD: short idiomatic names need neither
for i, s := range steps { ... }
tx, err := db.BeginTx(ctx, nil)
```

## Tests get zero

Test files carry no comments. The test name carries the intent; a table case gets a `name` field, not a comment above it. E1–E6 still apply if a test really encodes one, which is rare.

The kind that slips through is rationale: why the test exists, which mutation it pins, why a fake fails on one call and answers another, what a case guards against. It reads as useful, and it is still zero. The test name, the fake's name (`leaseLostQueue`) and the `name` field carry it; the PR description carries the mutation checks and coverage gaps.

```go
// BAD: rationale above a fake and a test
// leaseLostQueue returns zero rows on every update so the worker must stop the job
// instead of retrying. Nothing covered this before.
type leaseLostQueue struct{ ports.JobQueue }

func TestWorkerStopsWhenLeaseLost(t *testing.T) {

// GOOD: same information, no comments
type leaseLostQueue struct{ ports.JobQueue }

func TestWorkerStopsWhenLeaseLost(t *testing.T) {
```

## Editing existing code

The edit itself never earns a comment. If the change needs explaining, that goes in the PR description or the commit body, not the file. Do not mark what changed (N2).

Old comments you touch: if the diff makes one wrong, fix or delete it (N9). That includes a move or reorder that makes it false. A comment that only moves with its line keeps its text and is not reviewed again; the rules apply to comments the diff writes. Sweeping unrelated comments out of a file you happen to open is a separate PR.

## Pre-merge checklist

For every comment the diff adds or rewrites, in order:

1. Can I name its exception, E1–E8? No → delete.
2. Does the next line of code say the same thing? → delete (N1).
3. Could a rename or an extracted function make it unnecessary? → do that instead. Exception: a single-use threshold with an E8 label stays.
4. Does it narrate the change, the PR or the date? → delete (N2).
5. Is it wordy? → apply T.

Then, for every existing comment next to code the diff changes or moves:

6. Is it now false? → update or delete it (N9).

Target for CRUD, glue, handlers, tests, config and refactors: exactly 0.

## Project conventions, do not flag

- `AND leased_by = ?` on every worker write to `jobs` and `traces`. Convention from §7.13.2; no comment.
- `internal/gen/` is generated. Its comments belong to the generator; never edit them.
- sqlc annotations (`-- name: ClaimJob :one`) and goose annotations (`-- +goose Up`, `-- +goose StatementBegin`) are pragmas (E6).
- Idiomatic short names: `q` sqlc queries, `tx` transaction, `db` pool, `w` worker, `i/j/k`.
- Spec references in code (`D16`, `§7.13.4`) only for a runtime rule (E4) or a removal trigger (E5), never as provenance.

## Scope

Source code only: Go, Python tracers, SQL, Dockerfiles, Makefile. Commit messages, PR descriptions, `docs/` and `plans/` are written in normal prose.
