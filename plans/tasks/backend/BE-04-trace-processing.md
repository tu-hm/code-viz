# BE-04 · Trace processing (`tracecore`)

| | |
|---|---|
| **Milestone** | M0 (week 3) → M1 (week 5); sparse arrays in M2 |
| **Estimate** | 6.5 days |
| **Depends on** | BE-01 (schemas), G3 |
| **Blocks** | BE-03 `vizctl`, BE-05 worker, BE-09 sparse output |
| **Covers** | M0-12, M1-04, M2-B08 |
| **Spec** | §9, §10.1, §11, §19.9.1 |
| **Gate** | **G3 · Fri 13 Nov** — freeze trace format |

Turn raw wire NDJSON into the stored trace. Pure Go, stdlib only (§7.4).

## 1. Spike S4 — trace size (M0-12 · 1.5 d)

- [x] Throwaway script: convert S1 prototype output for a DFS on a 200k-element global array into keyframes + deltas
- [x] Measure gzipped size for 1,000 steps (target ≤ 2 MB)
- [x] Try keyframe interval 50 / chunk 250; adjust if needed
- [x] If over budget, propose a fix (e.g. sparse sequences)
- [ ] Present at **G3**; freeze the format; record in spec §0.3

**Result (24 Oct, ahead of G3):** recommends keeping keyframe 50 and chunk 250, not decided. A 1,000-step DFS over 200,005-element global arrays, traced with the GDB prototype and a variant of it, gzips to 29–246 KB through the real recorder, against 2 MB. The limit that binds is the 20 MB uncompressed budget, because a delta re-sends a changed array whole: a fill loop over 1,000-item arrays stops at step 747, and at the 10,000-item ceiling by step 76. Dense items also show only 4% of `dfs-heap`'s writes. The fix is §3, with `patch` widened to dense `items` (all 1,000 steps of the fill loop in 2.24 MB), plus a rule for arrays of containers, which use up the 500-object budget. Report: [plans/spikes/s4-trace-size.md](../../spikes/s4-trace-size.md).

## 2. `internal/tracecore` (M1-04 · 4 d)

**Input**
- [x] Read NDJSON from fd 3; read fd 1/2 and attribute each chunk to the current step
- [x] Validate every message against `wire.v1.schema.json` (`santhosh-tekuri/jsonschema v6`)
- [x] Enforce message order: `hello` first, `exit` last
- [x] Malformed message → fail with `internal_error`, log a redacted sample (§7.8)

**Transform**
- [x] Map native IDs → stable `o1, o2…` in order of first appearance
- [x] Assign frame IDs; build `stack` outermost → innermost
- [x] Drop `internal` locals unless `showInternals`
- [x] Keyframe every 50 steps (all frames + every reachable object)
- [x] Deltas: only new/changed frames and objects (whole), plus `removedObjects`

**Limits** (§11, enforced here, outside the sandbox)
- [x] `maxSteps` (1,000 default / 5,000 ceiling) → `truncation.step_limit`
- [x] Uncompressed size (20 MB / 50 MB) → `truncation.size_limit`
- [x] Time budget → `truncation.time_limit`; keep steps so far
- [x] Output recorded (64 KB / 1 MB) → `exit.kind = output_limit`
- [x] Heap objects per step, stack frames (100 innermost + globals), string length, items per container
- [x] Signal the caller to kill the sandbox when a hard limit is hit

**Output**
- [x] Build the header (§9.1 minus `steps`), `summary`, `encoding`
- [x] Split into chunks of 250 steps, each starting on a keyframe
- [x] gzip each chunk (stdlib `compress/gzip`, which keeps tracecore stdlib-only); compute `sizeBytes` + `sha256`

**Tests**
- [x] Golden tests: wire input → expected trace (masked addresses/timings), `-update` flag
- [x] Also mask values that differ between amd64 and arm64 (addresses, padding, `long double`), so fixtures match on Mac laptops and Linux CI; run golden tests on both architectures in CI
- [x] Unit tests for ID mapping, delta computation, each limit, chunk boundaries
- [x] Round-trip: rebuild every step from keyframe + deltas equals the full snapshot

Built early, inside the BE-03 run, so `vizctl trace` prints real traces. `tracecore` stays stdlib-only: the `schema` package compiles both JSON Schemas and the caller hands `Validator.Wire` to the recorder. The recorder's writers return an error at a hard limit, so the sandbox kills the box; the step limit is not a kill (D25). Malformed output returns `ErrMalformed` with a message that names only the failed schema rule; the job runner logs it (BE-05). The goldens needed no new masks: the Python fixtures give the same fd-3 stream on amd64 and arm64 once ids are mapped, and the C++ sessions re-recorded on arm64 (same GCC 15.2 and GDB 17.1) give the same goldens. CI runs them on amd64 in `make check` and on arm64 in the `golden-arm64` job.

## 3. Sparse arrays (M2-B08 · 1 d, after BE-09)

- [x] Accept sparse sequences and dirty-cell patches from the C++ tracer
- [x] Keyframe: `sparse.default` + non-default cells (≤ 10,000), else `truncated` + window only
- [x] Delta: `patch` with changed cells only
- [x] Golden tests updated

**Result:** built with BE-09 §2 (`internal/tracecore/sparse.go`). A wire `patch` is checked and applied to the core's own copy of the sequence; keyframes come from that copy and delta patches are computed by the core, so no stored step depends on the tracer's patches. Over 10,000 non-default cells the stored object keeps the first 1,000 cells' window; over 100,000 cells in one step message the trace ends with `size_limit`. A 1,000-step trace over a 200k array is 54 KB gzipped in `TestBigArrayDFSFitsTheSizeTarget` (32 KB from the real tracer). Golden `cpp-sparse`, the replay property with sparse arrays, and `FuzzWire` seeded with it.

## Done when

Golden tests pass, and a 1,000-step trace over a 200k-element array is ≤ 2 MB gzipped.
