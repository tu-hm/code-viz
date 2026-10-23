# BE-11 · Whole-run data & trace options

| | |
|---|---|
| **Milestone** | M3 (by week 2); optional M5 work |
| **Estimate** | 6.5 days (+3 d if S8 fails) |
| **Depends on** | BE-07 (`--coverage`), BE-08, BE-09 §2, BE-03 |
| **Blocks** | FE hit-count gutter, step-limit banner, start-at-line dialog |
| **Covers** | M3-B02, M3-B03, M3-B04, M3-B05, (M5-B01) |
| **Spec** | §5.6, §19.8, §19.9.2, §19.9.3, §19.9.5, FR-11 |

🔁 **Handoff to FE:** `lineHits` and untraced tail by **M3 week 2**.

## 1. Line hit counts (M3-B02 · 2 d)

- [ ] C++: read gcov counts after a normal exit → `summary.lineHits`, `lineHitsSource: "gcov"`
- [ ] C++ after a crash: count from recorded steps → `lineHitsSource: "trace"`
- [ ] Python: use the tracer's line counter (BE-03) for the whole run
- [ ] **Done:** binary-search counts match the §19.3 mock

## 2. Untraced tail for C++ (M3-B03 · 2 d)

- [ ] After the step limit: delete all breakpoints and `continue` at full speed
- [ ] Respect the wall-time limit while untraced
- [ ] Capture output after the last traced step → store as `tail.txt.gz`
- [ ] Fill `summary.untracedTail` (`completed`, `exit`, `stdoutBytes`)
- [ ] List `tail.txt.gz` in the trace manifest / API response
- [ ] Python side (hook → counter only) already in BE-03; verify it fills the same fields
- [ ] **Done:** a 2,000-iteration loop gives complete output

## 3. Start tracing from line N (M3-B04 · 1.5 d)

- [ ] Accept `options.startAtLines`
- [ ] C++: run untraced to the first hit of a listed line, then start stepping
- [ ] Python: hook ignores events until the line is reached
- [ ] Include in the cache key
- [ ] **Done:** §5.6 dialog works end to end

## 4. Show range (M3-B05 · 1 d)

- [ ] Accept `options.captureRanges` (e.g. `{"depth": [[0, 50]]}`)
- [ ] Record the requested window for the named arrays on a re-run
- [ ] Determinism (seeded RNG, ASLR off) so step counts match the original
- [ ] **Done:** window moves beyond the originally recorded range

## 5. (Conditional) Exact access hints (M5-B01 · 3 d)

Only if FE spike S8 (tree-sitter accuracy) misses 95%.

- [ ] Emit `access[]` (`obj`, `path`, `mode`) from the tracer
- [ ] Writes from the diff; reads from instrumentation

## Done when

A 2,000-iteration loop gives complete output, and binary-search hit counts match the §19.3 mock.
