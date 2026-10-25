# S2: `sys.settrace` vs `sys.monitoring` for the Python tracer

**Gate G2 (Fri 13 Nov) · run Sat 24 Oct 2026 · BE-03 §1 · recommendation: `sys.monitoring`; not decided**

## Question

Which hook should the Python tracer use: `sys.settrace` (D12, and the default if S2 is inconclusive) or `sys.monitoring` (PEP 669)? §18.7 asks for the overhead on a 1,000-step program. A second cost now matters as much. After the step limit, the tracer keeps only a line counter and the program runs to the end (D25, §19.9.3, §19.9.5). That untraced tail has to fit in the 10 s CPU limit (§11). The counter's speed decides how long a program can run and still end with complete output, exit status and line hits.

## Setup

- **Host:** Apple M5 (4 performance and 6 efficiency cores), Docker 29.4 on OrbStack: a Linux 7.0 arm64 VM with 10 vCPUs.
- **Runtime:** `python:3.12.15-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704` (CPython 3.12.15, Debian trixie). The digest is the multi-arch index.
- **Tracers** (`plans/spikes/s2/`): `settrace_tracer.py` and `monitoring_tracer.py` share `snapshot.py`, so each step does the same work. It walks the `main.py` frames (100 innermost) and reads `f_locals`. Ints, floats, strings and `None` are encoded inline; lists, tuples, dicts and sets go by `id()` with up to 1,000 items. Then `json.dumps` writes one step message to fd 3, line-buffered: one `write` per step, to `/dev/null` in the bench. Both tracers put the call step on the first body line, attach return values, report one exception step per exception, and count line hits on every line event. `sys.stdin` is a `StringIO` and `sys.stdout` a small Python wrapper, as BE-03 plans.
- **settrace:** the global hook returns `None` for frames outside `main.py`; `main.py` frames get the local hook.
- **monitoring:** PY_START, PY_RESUME, LINE, JUMP, PY_RETURN and PY_YIELD are set with `set_local_events` on `main.py`'s code objects only: the compiled module and every code object in its `co_consts`, recursively. Tracer and stdlib code never call back. In 3.12, RAISE and PY_UNWIND can't be local events (`ValueError: invalid local event set`, see `probes.py`), so they are global and check `co_filename`. Callbacks get no frame; the tracer takes it from `sys._getframe(1)`.
- **Modes:** `full` records steps up to the limit (1,000), then swaps to that hook's counter. `count` runs the counter alone from the first line. `full-hybrid` records steps with settrace, then swaps to the monitoring counter.
- **Timing:** CPU time (`time.process_time`) around `exec`, in a fresh process per run. Each row has 9 runs, interleaved with the other rows of the same program. Tables give the median and the min–max. "Process" is the child's whole CPU time from `getrusage`, including interpreter start.

| Program | What it stresses |
|---|---|
| `steps1000` | Loops, recursive `fib(11)`, bubble sort on a list, a dict of counts: 1,086 steps |
| `hot_loop` | 6 M iterations of a 4-line loop body in `main()`: 20 M line hits |
| `hot_oneline` | `for i in range(n): a[i] = …` on one line, a list comprehension and a generator expression over 3 M items |
| `hot_calls` | Recursive `fib(32)`: 7 M calls, 14 M line hits |
| `hot_stdlib` | 300,000 `fractions.Fraction` additions: pure-Python stdlib frames under each `main.py` line |

## Results

### Full tracing, 1,000-step program

| `steps1000` (1,086 steps) | Untraced | settrace | monitoring | Hybrid |
|---|---|---|---|---|
| Exec CPU, median (min–max) | 0.2 ms | 27 ms (26–49) | **24 ms** (22–30) | 28 ms (25–51) |
| Per step | — | 25 µs | **22 µs** | 26 µs |
| Process CPU | 11 ms | 37 ms | 34 ms | 38 ms |

A tie in practice. The snapshot (frame walk, value encoding, `json.dumps`) is most of the cost, and it is the same for both hooks. Monitoring was 3–4 ms faster per 1,000 steps in both passes. Next to the 11 ms interpreter start and the sandbox start, that's noise. Snapshot cost grows with the data: in `hot_loop`, where every step encodes a 1,000-item list, 1,000 steps cost about 0.25 s on either hook.

### Counter after the step limit

| Counter only, median (min–max) | Untraced | settrace | monitoring | settrace ÷ monitoring |
|---|---|---|---|---|
| `hot_loop` | 0.30 s | 2.08 s (2.01–2.47), 7.0× | **1.12 s** (1.07–2.04), 3.8× | **1.9×** |
| `hot_oneline` | 0.09 s | 1.18 s (0.96–2.57), 12.9× | **0.80 s** (0.76–2.23), 8.8× | **1.5×** |
| `hot_calls` | 0.16 s | 3.09 s (2.21–3.70), 19.1× | **0.91 s** (0.66–1.50), 5.6× | **3.4×** |
| `hot_stdlib` | 0.20 s | 0.58 s (0.48–0.83), 2.9× | **0.21 s** (0.19–0.26), 1.0× | **2.8×** |

| Full: 1,000 steps, then counter | settrace | monitoring | Hybrid |
|---|---|---|---|
| `hot_loop` | 2.38 s | **1.35 s** | 1.39 s |
| `hot_oneline` | 1.36 s | **1.10 s** | 1.25 s |
| `hot_calls` | 2.60 s | **0.90 s** | 0.98 s |
| `hot_stdlib` | 0.51 s | **0.23 s** | 0.24 s |

What that buys inside the 10 s CPU limit. These are the longest untraced runs whose tail still fits: 10 s divided by the counter ratio, ignoring the 1,000 snapshots and interpreter start.

| Kind of program | settrace | monitoring |
|---|---|---|
| Plain loops (`hot_loop`) | 1.4 s | **2.6 s** |
| One-line loops, comprehensions (`hot_oneline`) | 0.8 s | **1.1 s** |
| Recursion (`hot_calls`) | 0.5 s | **1.8 s** |
| Pure-Python stdlib calls (`hot_stdlib`) | 3.4 s | **~10 s** |

- **settrace pays per call, not just per line.** Every call fires the global hook, every `main.py` frame also sends `return` to the local hook, and a resumed generator counts as a new call. That is why recursion is 3.4× slower. In stdlib-heavy code the global hook runs for every stdlib frame and returns `None`. Monitoring with local events never calls back outside `main.py`, so `hot_stdlib` runs at untraced speed.
- **Per line hit**, settrace's counter costs 90 ns on a plain loop and 150–210 ns in recursive code, where the call and return callbacks add up; monitoring's costs 40–55 ns.
- **No cost stays behind after the swap.** With a 10-step limit, `full` took the same time as `count` on both hooks: 2.0–2.3 s vs 2.0–2.4 s for settrace, and 1.09–1.17 s vs 1.11–1.27 s for monitoring.
- **The hybrid gets close to monitoring's tail speed** with settrace's steps: 3–14% slower than pure monitoring, inside the run-to-run spread.
- **Line hits are identical** across hooks and modes (same CRC over the hit table) on every bench program.

### Monitoring variants: JUMP and DISABLE

| Median | `count`: local LINE + JUMP | `count-nojump`: local LINE | `count-global`: global LINE, DISABLE outside `main.py` |
|---|---|---|---|
| `hot_loop` | 1.12 s | 1.13 s | 1.61 s |
| `hot_oneline` | 0.80 s, 7,285,722 hits | 0.14 s, **9 hits** | 0.13 s, **9 hits** |
| `hot_calls` | 0.91 s | 0.83 s | 1.17 s |
| `hot_stdlib` | 0.21 s | 0.21 s | 0.24 s |

- **LINE alone undercounts one-line loops.** In 3.12, LINE fires only when the line number changes. settrace also reports a `line` on every backward jump that lands on the same line. So `for i in range(3): x += i` is 4 hits under settrace and 1 under LINE. The fix is the JUMP event plus an offset→line table built from `co_lines()` at start. Jumps that are forward or change lines return DISABLE once and stop firing, so JUMP costs nothing on loops that span several lines.
- **DISABLE works as documented.** Each non-`main.py` line calls back once, then stays off. In `probes.py`, `json.dumps` makes 125 LINE callbacks the first time and none after, even after a later `set_events`; `restart_events()` turns all 125 back on. Every `main.py` hit is still counted. The global variant is still 15–40% slower than local events, because each `main.py` event pays a `co_filename` check in Python. Local events need no check.

## Functional notes

`compare.py` runs both tracers on small programs and diffs their step streams and line hits.

| | `sys.settrace` | `sys.monitoring` |
|---|---|---|
| Call step on the first body line | ✓ `call`, then the step on the first `line` (`add:14`, not the `def` on line 12) | ✓ PY_START, then the step on the first LINE |
| Return value | `return` carries it, but also fires with `None` when the frame unwinds, and with the yielded value at a `yield`. Needs a per-frame "unwinding" flag | PY_RETURN, PY_YIELD and PY_UNWIND are separate events |
| One step per exception | `exception` fires in every frame the exception passes through. Dedupe by exception identity | RAISE also fires once per frame in 3.12. Same dedupe. It can't be a local event, so it also fires for stdlib exceptions (filtered by `co_filename`) |
| Exception raised in stdlib (`Fraction(1, 0)`) | Step at the `main.py` line that called it | Same |
| Uncaught exception | Step at the raise site, then `exit` with the exception | Same |
| One-line loops, comprehensions | One `line` step per iteration | Same steps and hits once JUMP is handled; LINE alone gives one step for the whole loop |
| Generator resume | Every resume is a new `call`; telling it from a first call needs bookkeeping (the spike's tracer labels resumes as calls) | PY_RESUME |
| `input()` with the stdout wrapper | No steps outside `main.py`; the global hook still runs for each wrapper frame | No steps, and no callbacks at all outside `main.py` |
| RecursionError near the limit | The error is raised inside the hook. CPython then removes the hook (`gettrace()` is `None`, `probes.py`), and the rest of the run is lost: no more steps or hits, and `exit` still says normal | The error reaches user code and the tool stays on. Steps and hits continue |
| Threads | Per thread. Threads the program starts are not traced: no steps, no hits | All threads call the same callbacks. Hits are complete. Full tracing needs per-thread call stacks |
| Swap to the counter | `sys.settrace(counter)`, set `f_trace` on every `main.py` frame, return the counter from the current callback. Other threads' frames need `sys._current_frames()` | `set_events(0)`, register the counter, `set_local_events` on the `main.py` code objects. Covers every frame and thread |
| Frame | Passed to the hook | `sys._getframe(1)` in each callback |

- **Recursion depth.** `depth(n)` recursing until RecursionError reaches 996 untraced, 995 under either counter, 991 under settrace full and 990 under monitoring full. The callbacks' own frames count toward the limit on both hooks. The difference is what happens next. With settrace the trace silently stops at the deepest frame. A program that hits the recursion limit, a bug students will bring to a visualizer, loses its line hits and any steps after that point. A monitoring callback can raise into user code without losing the tool, so the real tracer could even raise RecursionError itself at the untraced depth. Either way, no exception may escape a callback by accident.
- **The CP thread idiom.** `threading.stack_size(…)` with `threading.Thread(target=main)` is a common way to get deep recursion in Python on judges. Under settrace, the spike's tracer records nothing inside `main()`: 0 steps and 0 hits for its lines. The real tracer needs `threading.settrace`. Monitoring traces it without changes, but the worker thread's frames don't lead back to the module frame, so the tracer has to add the globals frame itself (it should anyway). The spike's single call stack worked only because the main thread waits in `join()`.

## Recommendation for G2

**`sys.monitoring`.** On the §18.7 criterion as written (the 1,000-step program), S2 is a tie: 22 vs 25 µs per step, mostly snapshot encoding. On that alone, D12 would stay. The evidence for switching is the untraced tail, which D25 added after §18.7 was written:

- The tail counter is **1.5–3.4× faster**: 1.9× on plain loops, 3.4× on recursion, 2.8× on stdlib-heavy code. Within the 10 s CPU limit, a recursive program can run 1.8 s untraced and still finish, against 0.5 s under settrace. Whether D25's "run to the end" holds for typical CP solutions depends mostly on this number.
- Explicit PY_RESUME, PY_YIELD and PY_UNWIND events replace three pieces of settrace guesswork.
- A failing callback doesn't silently end the trace, which matters for programs that recurse to the limit.
- The swap to the counter needs no frame walk and covers every frame and thread.

What it costs:

- The JUMP handler and its offset→line table, needed to match settrace's per-iteration steps.
- `sys._getframe(1)` in each callback.
- RAISE and PY_UNWIND fire for exceptions in all code.
- Full tracing needs per-thread state.
- More hook code: about 145 lines in the spike against 80 for settrace. The shared snapshot code, most of a real tracer, doesn't change.
- The API is newer and less familiar. It is 3.12-specific, which D1 already pins. 3.13 changes `f_locals` for both hooks (PEP 667), and 3.14 splits BRANCH, which this design doesn't use.
- User code that grabs tool id 0 (`DEBUGGER_ID`) breaks only its own trace, like a user calling `sys.settrace` today.

**If G2 keeps D12**, the hybrid is the smaller change to the settrace tracer that BE-03 is writing now. It keeps settrace for the recorded steps and moves to the monitoring counter at the limit, for about 30 more lines. It measured 3–14% slower than pure monitoring on the tails, against 1.5–3.4× slower for settrace alone. It doesn't fix the RecursionError and thread behavior during the first 1,000 steps. A settrace tracer needs those fixes either way: catch everything inside the hook, keep a recursion margin, and call `threading.settrace`.

Not covered: the real `tracer.py`, amd64, CPython 3.13+, memory use, and the stdout step tagging. The spike's settrace tracer leaves the generator-resume check out, and its monitoring tracer keeps one call stack for all threads.

## How to rerun

```sh
plans/spikes/s2/run.sh      # probes.py, compare.py, then bench.py with 9 runs per row (about 5 min)
plans/spikes/s2/run.sh 3    # fewer runs
```

`run.sh` uses the pinned image above. `probes.py` checks the 3.12 API facts used here: which events can be local, how DISABLE persists, and what happens when a hook raises. `compare.py` prints each program's step diff and line-hit differences. `bench.py` prints the table these numbers came from. On this machine, single runs vary by up to 2×: macOS places the VM's vCPUs on performance or efficiency cores, and other builds shared the host during the final pass. Check the medians and ratios, not single runs. Three passes (1, 7 and 9 runs per row) gave the same settrace÷monitoring counter ratios within about 15%: 1.8–2.0× (`hot_loop`), 1.3–1.5× (`hot_oneline`), 3.2–3.5× (`hot_calls`), 2.5–3.0× (`hot_stdlib`).
