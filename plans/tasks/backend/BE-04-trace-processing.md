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

- [ ] Throwaway script: convert S1 prototype output for a DFS on a 200k-element global array into keyframes + deltas
- [ ] Measure gzipped size for 1,000 steps (target ≤ 2 MB)
- [ ] Try keyframe interval 50 / chunk 250; adjust if needed
- [ ] If over budget, propose a fix (e.g. sparse sequences)
- [ ] Present at **G3**; freeze the format; record in spec §0.3

## 2. `internal/tracecore` (M1-04 · 4 d)

**Input**
- [ ] Read NDJSON from fd 3; read fd 1/2 and attribute each chunk to the current step
- [ ] Validate every message against `wire.v1.schema.json` (`santhosh-tekuri/jsonschema v6`)
- [ ] Enforce message order: `hello` first, `exit` last
- [ ] Malformed message → fail with `internal_error`, log a redacted sample (§7.8)

**Transform**
- [ ] Map native IDs → stable `o1, o2…` in order of first appearance
- [ ] Assign frame IDs; build `stack` outermost → innermost
- [ ] Drop `internal` locals unless `showInternals`
- [ ] Keyframe every 50 steps (all frames + every reachable object)
- [ ] Deltas: only new/changed frames and objects (whole), plus `removedObjects`

**Limits** (§11, enforced here, outside the sandbox)
- [ ] `maxSteps` (1,000 default / 5,000 ceiling) → `truncation.step_limit`
- [ ] Uncompressed size (20 MB / 50 MB) → `truncation.size_limit`
- [ ] Time budget → `truncation.time_limit`; keep steps so far
- [ ] Output recorded (64 KB / 1 MB) → `exit.kind = output_limit`
- [ ] Heap objects per step, stack frames (100 innermost + globals), string length, items per container
- [ ] Signal the caller to kill the sandbox when a hard limit is hit

**Output**
- [ ] Build the header (§9.1 minus `steps`), `summary`, `encoding`
- [ ] Split into chunks of 250 steps, each starting on a keyframe
- [ ] gzip each chunk (`klauspost/compress`); compute `sizeBytes` + `sha256`

**Tests**
- [ ] Golden tests: wire input → expected trace (masked addresses/timings), `-update` flag
- [ ] Also mask values that differ between amd64 and arm64 (addresses, padding, `long double`), so fixtures match on Mac laptops and Linux CI; run golden tests on both architectures in CI
- [ ] Unit tests for ID mapping, delta computation, each limit, chunk boundaries
- [ ] Round-trip: rebuild every step from keyframe + deltas equals the full snapshot

## 3. Sparse arrays (M2-B08 · 1 d, after BE-09)

- [ ] Accept sparse sequences and dirty-cell patches from the C++ tracer
- [ ] Keyframe: `sparse.default` + non-default cells (≤ 10,000), else `truncated` + window only
- [ ] Delta: `patch` with changed cells only
- [ ] Golden tests updated

## Done when

Golden tests pass, and a 1,000-step trace over a 200k-element array is ≤ 2 MB gzipped.
