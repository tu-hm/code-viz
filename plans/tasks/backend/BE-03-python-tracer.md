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

- [ ] Write a minimal tracer with `sys.settrace`
- [ ] Write the same with `sys.monitoring` (PEP 669)
- [ ] Measure overhead on a 1,000-step program (and a hot loop)
- [ ] Recommendation for **G2**; default is `settrace` if inconclusive

## 2. `adapters/python/tracer.py` (M1-05 · 4 d)

**Running the code**
- [ ] Start as `python3 -I /opt/viz/tracer.py main.py`
- [ ] `exec(compile(src, "main.py", "exec"), {"__name__": "__main__"})`
- [ ] Only frames with `co_filename == "main.py"` produce steps
- [ ] Write NDJSON to fd 3: `hello` first, `step`s, `exit` last

**Events**
- [ ] `call` (report the first **body** line, not the `def` line), `line`, `return` (with return value), `exception`
- [ ] `callId` + `parentCallId` on call steps, `callId` on return steps (§19.9.6)

**Values** (type map §10.3)
- [ ] Inline: `int`, `float`, `bool`, `str` (cut at 1,000 chars), `None`
- [ ] `list`, `deque` → `sequence`; `tuple` → `sequence` with `fixed`
- [ ] `set`, `frozenset` → `set`; `dict` & friends → `mapping`
- [ ] User class instance → `record` (`__dict__` / `__slots__`)
- [ ] Function/lambda/method → `function`; class → `class`
- [ ] Anything else → `opaque` with `repr()` cut to 200 chars
- [ ] Native IDs from `id(obj)`
- [ ] Flag `internal`: module names starting with `__`, imported modules, imported functions
- [ ] Container limit: 1,000 items recorded, `truncated` + real `length`

**I/O**
- [ ] Replace `sys.stdin` with `StringIO`; record exact `stdinPos` (`tell()`) per step (§19.9.4)
- [ ] Replace `sys.stdout`/`sys.stderr` with writers that tag each chunk with the current step
- [ ] `input()` must not produce a step outside `main.py` (regression fixture §15)

**Modules**
- [ ] Block non-stdlib imports (numpy, pandas, matplotlib…) before the run → `unsupported_module`
- [ ] Allowlist read from the manifest `modules.allow`

**Determinism & limits**
- [ ] Seed `random` to a fixed value (§7.12)
- [ ] Line counter for every line, kept running after the step limit (`lineHits`, §19.9.3)
- [ ] After the step limit: swap the hook for the counter only; program runs to the end (untraced tail, §19.9.5)
- [ ] Python recursion limit error recorded as an error step

## 3. Runner image + `vizctl trace` (M1-06 · 1.5 d)

- [ ] `adapters/python/Dockerfile`: Debian slim, CPython 3.12 pinned, `tracer.py` at `/opt/viz/`
- [ ] `adapters/python/manifest.yaml` (§10.2): `build: null` (syntax check), `trace.cmd`, `capabilities.pointers: false`, `modules.allow`
- [ ] Image ≤ 1.5 GB; Trivy scan; cosign sign
- [ ] `vizctl trace --lang python3 main.py < input`: runs the adapter through the Docker dev sandbox (BE-02 §2), pipes through `tracecore`, prints the trace
- [ ] `vizctl validate trace.json`

## 4. Fixtures

- [ ] Golden fixtures under `fixtures/python/<case>/`: aliasing, binary search, fib, exception, 1,000+ steps, `input()`
- [ ] Each reproduced from real code via `vizctl trace` and committed

## Done when

Every Python fixture can be reproduced from real code.
