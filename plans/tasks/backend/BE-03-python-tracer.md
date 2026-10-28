# BE-03 · Python tracer

| | |
|---|---|
| **Milestone** | M0 (week 3) → M1 (week 6) |
| **Estimate** | 7 days |
| **Depends on** | BE-01 (wire schema), BE-04 (`tracecore` for `vizctl`), BE-02 §2 (Docker sandbox for `vizctl`) |
| **Blocks** | BE-05/06 end-to-end Python, FE real Python traces |
| **Covers** | M0-11, M1-05, M1-06 |
| **Spec** | §7.11.1, §10.2, §10.3, §19.9 |
| **Gate** | **G2 · Fri 13 Nov** — `settrace` or `sys.monitoring` |

🔁 **Handoff to FE:** real Python traces by **Fri 4 Dec**.

## 1. Spike S2 — hook choice (M0-11 · 1.5 d)

- [x] Write a minimal tracer with `sys.settrace`
- [x] Write the same with `sys.monitoring` (PEP 669)
- [x] Measure overhead on a 1,000-step program (and a hot loop)
- [x] Recommendation for **G2**; default is `settrace` if inconclusive

**Result (24 Oct, ahead of G2):** recommends `sys.monitoring`, not decided. A 1,000-step trace is a tie (22 vs 25 µs per step), but the line counter after the step limit is 1.5–3.4× faster, which decides how much of an untraced tail fits in the CPU limit (D25). Report: [plans/spikes/s2-python-hook.md](../../spikes/s2-python-hook.md). The tracer below uses `settrace` until G2 decides.

## 2. `adapters/python/tracer.py` (M1-05 · 4 d)

**Running the code**
- [x] Start as `python3 -s -P /opt/viz/tracer.py main.py` with `PYTHONHASHSEED=0` (`-I` ignores the seed; spec v1.6)
- [x] `exec(compile(src, "main.py", "exec"), {"__name__": "__main__"})`
- [x] Only frames with `co_filename == "main.py"` produce steps
- [x] Write NDJSON to fd 3: `hello` first, `step`s, `exit` last

**Events**
- [x] `call` (report the first **body** line, not the `def` line), `line`, `return` (with return value), `exception`
- [x] `callId` + `parentCallId` on call steps, `callId` on return steps (§19.9.6)

**Values** (type map §10.3)
- [x] Inline: `int`, `float`, `bool`, `str` (cut at 1,000 chars), `None`
- [x] `list`, `deque` → `sequence`; `tuple` → `sequence` with `fixed`
- [x] `set`, `frozenset` → `set`; `dict` & friends → `mapping`
- [x] User class instance → `record` (`__dict__` / `__slots__`)
- [x] Function/lambda/method → `function`; class → `class`
- [x] Anything else → `opaque` with `repr()` cut to 200 chars
- [x] Native IDs from `id(obj)`
- [x] Flag `internal`: module names starting with `__`, imported modules, imported functions
- [x] Container limit: 1,000 items recorded, `truncated` + real `length`

**I/O**
- [x] Replace `sys.stdin` with `StringIO`; record exact `stdinPos` (`tell()`) per step (§19.9.4)
- [x] Replace `sys.stdout`/`sys.stderr` with writers that tag each chunk with the current step
- [x] `input()` must not produce a step outside `main.py` (regression fixture §15)

**Modules**
- [x] Block non-stdlib imports (numpy, pandas, matplotlib…) before the run → `unsupported_module` (`tracer.py --check`, the Python build step)
- [x] Allowlist read from the manifest `modules.allow` (passed as `VIZ_MODULES_ALLOW`)

**Determinism & limits**
- [x] Seed `random` to a fixed value (§7.12)
- [x] Line counter for every line, kept running after the step limit (`lineHits`, §19.9.3)
- [x] After the step limit: swap the hook for the counter only; program runs to the end (untraced tail, §19.9.5)
- [x] Python recursion limit error recorded as an error step

## 3. Runner image + `vizctl trace` (M1-06 · 1.5 d)

- [x] `adapters/python/Dockerfile`: Debian slim, CPython 3.12 pinned, `tracer.py` at `/opt/viz/`
- [x] `adapters/python/manifest.yaml` (§10.2): `build` is the `tracer.py --check` syntax and import check (spec v1.6), `trace.cmd`, `capabilities.pointers: false`, `modules.allow`
- [ ] Image ≤ 1.5 GB; cosign sign
- [x] `vizctl trace --lang python3 main.py < input`: runs the adapter through the Docker dev sandbox (BE-02 §2), pipes through `tracecore`, prints the trace
- [x] `vizctl validate trace.json`

The runner image is `viz-runner-python:3.12.15-1` (`make images`), 214 MB. pip is removed and setuid bits are stripped. Signing stays open: cosign needs the registry and a key (BE-13). `vizctl trace` runs the build check and then the tracer in the Docker dev sandbox, feeds `tracecore` (BE-04 §2, built in this run), and prints the trace.

## 4. Fixtures

- [x] Golden fixtures under `fixtures/python/<case>/`: aliasing, binary search, fib, exception, 1,000+ steps, `input()`
- [x] Each reproduced from real code via `vizctl trace` and committed

Fixtures: aliasing, binary-search, fib, exception, long (step limit plus untraced tail), input, recursion-limit and thread-main. `go test ./cmd/vizctl` runs each one through `vizctl trace` and compares it with its `expected.trace.json`; `make golden-update` rewrites them.

## Done when

Every Python fixture can be reproduced from real code.
