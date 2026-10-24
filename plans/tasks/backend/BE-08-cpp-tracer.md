# BE-08 · C++ tracer ⚠

| | |
|---|---|
| **Milestone** | M0 prototype (week 2) → M2 |
| **Estimate** | 12 days (2 d M0 prototype + 10 d M2) |
| **Depends on** | BE-01 (wire schema), BE-07 (build) |
| **Blocks** | BE-09, BE-10, BE-11, BE-14 |
| **Covers** | M0-09, M2-B03, M2-B04, M2-B05 |
| **Spec** | §7.11.2, §9.4, §10.3, §19.9.6 |

Step through C++ with GDB's Python API (`adapters/cpp/trace.py`). The step loop stays **inside** the sandbox.

🔁 **Handoffs to FE:** real C++ traces from the prototype by **Fri 6 Nov** · `ptr` values by **M2 week 3**.

## 1. Spike S1a — GDB prototype (M0-09 · 2 d)

- [x] GDB Python script that writes wire NDJSON on fd 3
- [x] Programs: a loop, a recursion, an STL example
- [x] Output validates against `wire.v1.schema.json`
- [x] Hand to BE-02 for the gVisor/nsjail measurements

The script is `adapters/cpp/trace.py`. The programs are in `fixtures/cpp/{loop,recursion,stl}`. The three sessions are in `schema/testdata/wire/` (`cpp-loop`, `cpp-recursion`, `cpp-stl`), so the schema tests validate them in CI. BE-02 ran it in a throwaway Debian trixie image (GCC 14.2, GDB 16.3) for S1b: 1,003 steps in 1.45 s under nsjail through the adapter ([report](../../spikes/s1b-sandbox.md)).

Findings, on GDB 17.1 and GCC 15.2 (x86_64):

- 1,005 steps trace in 0.8 s natively, against the 3 s target outside a sandbox.
- `skip -gfi <glob>` matches `main.cpp` for any glob in GDB 17, so the tracer skips by function name (`^(std|__gnu_cxx)::`) and `finish`es out of any other non-user frame.
- `step` does not stop in the caller after a return, so in `fib(n-1) + fib(n-2)` the second call reuses the first one's stack slot with no stop in between. A breakpoint on every `main.cpp` function (`rbreak`) marks each entry, which gives each call its own frame id.
- GDB's stop banners go to fd 1. The tracer sets `suppress-cli-notifications` and points GDB's own fd 1 and 2 at `/dev/null` once the program runs. The program can't write to fd 3.
- A local shows `uninit` on its own declaration line until that line has run in the current entry of its block (§7.11.2, v1.4). Without this, `int sum = 0;` showed garbage before it ran.

## 2. Tracer core (M2-B03 · 4 d)

- [x] Run as `gdb -q -nx -batch -x /opt/viz/trace.py --args ./main`
- [x] Load libstdc++ pretty printers
- [x] Break at `main`, then loop `step`
- [x] `skip -gfi /usr/*`; if a stop lands outside `main.cpp`, `finish`
- [x] One step per stop inside `main.cpp`; record `line` and `prevLine`
- [x] Frames from `gdb.newest_frame()` walked outward, reversed (outermost first)
- [x] Stdin from the job's file; stdout/stderr on fd 1/2
- [x] Seed `rand()` / ASLR off (§7.12)
- [x] **Done:** loop, recursion and STL programs trace correctly

**Result (24 Oct):** `adapters/cpp/trace.py`, adapter `cpp-gdb/0.2.0`, on GDB 14.2 and GCC 13.5 (arm64). Where it differs from the list:

- No `step` and no `skip -gfi`. GDB on Linux has no range stepping, so `step` single-steps every instruction while the pc stays in a line: a one-line loop such as `for (int i = 0; i < n; i++) cin >> a[i];` made 2 steps and then ran out of time. Every `is_stmt` row of a `main.cpp` function past its prologue gets an internal breakpoint instead, and the tracer resumes with `continue`. Library code runs at full speed, and a callback from it, such as a `sort` comparator, stops at its own rows.
- The rows come from the binary's `.debug_line`, which `trace.py` parses itself (DWARF 5). GDB's own line table drops a row whose line repeats with a new discriminator, and that row is often a one-line loop's back edge.
- A stop is a step when its line differs from the call's last step, or when the code jumped back within the line to code the call hasn't shown since its last jump back. A one-line loop gives one step per iteration, like Python's line events; a multi-line range-for jumps back to its condition after its `++` step and gives no extra one.
- Not every row at a function's closing brace (the row holding its `ret`) is the epilogue: GCC puts a VLA's stack save and an aggregate temporary's setup there too. Those before the first statement get no breakpoint, so the call step is on the first statement. A later one is held and becomes the `}` step only if the frame then returns or calls a destructor.
- Implicit constructors, destructors and assignment operators, a lambda's closure members and functions with reserved names (`__tcf_0`, `_GLOBAL__sub_I_main`, `_FUN`) get no breakpoints and make no steps. GDB 14's Python has no `Symbol.is_artificial`; `ptype/r` of the class leaves out every method DWARF marks `DW_AT_artificial`, so a method whose name and parameter types it doesn't list is compiler-generated. If GDB ever printed a parameter type differently there than in the definition, a user-written method would lose its steps.
- Breakpoints go in once `main` starts, with `set breakpoint always-inserted on` (700 breakpoints: 1.8 s → 0.5 s per 1,000 steps). Code before `main` and after it returns runs untraced.
- The stack is the tracer's own list of user calls, not a walk of `gdb.newest_frame()`, so library frames between two user calls don't show. It is still outermost first.
- `/work/stdin` is `dup2`ed onto GDB's fd 0 before `run`; a missing file is empty input. Nothing is seeded: glibc's `rand()` without `srand` is deterministic, and ASLR is off. Two runs give byte-identical traces.
- GDB time in the container (one CPU), `step` engine → breakpoints: a 1,000-step loop 0.49 s → 0.27 s; recursion 300 deep 3.2 s → 3.2 s; 1,000 STL-heavy steps 2.4 s → 1.7 s; a one-line loop over 100,000 iterations 50 s with 2 steps → 0.4 s; a one-line `cin >> a[i]` over 5,000 numbers 16 s → 0.4 s. The last two reach the step limit and finish untraced.

Fixtures: `loop`, `recursion` and `stl` (regenerated), plus `input` for stdin.

## 3. Variables & pointers (M2-B04 · 4 d)

- [x] Locals from `frame.block()` in declaration order
- [x] Hide a variable while `symbol.line > current line`; `uninit` on its declaration line until it runs (no garbage values)
- [x] Flag `internal`: names starting with `__`, compiler-generated (`__for_range`, etc.)
- [x] Globals from the static block of `main.cpp` → separate **globals** frame
- [x] Inline values: integers, floats, `bool`, `enum` (enumerator name), `char` (+ `code`)
- [x] `T&` → referenced value with `type: "T&"`
- [x] `T*` → `ptr {addr, target, index?}`; `0x0` = nullptr
- [x] Follow pointers to user `struct`/`class` or into a recorded array; object key `(address, type)`
- [x] Stop following at `maxPointerDepth` (32 / 128) or per-step object budget (500 / 2,000) → `target: null`
- [x] Unreadable → `unavailable {reason}`
- [x] **Done:** `cpp_view` mock data (§5.4) reproduced

**Result:** where it differs from the list:

- Declaration order holds for the function's own block. GDB returns nested blocks and globals in hash order, so those are sorted by `(line, name)`. Globals come from both the global and the static block of `main.cpp`.
- `internal` is every name starting with `__`, which covers `__for_range`, `__for_begin`, `__for_end` and a lambda's `__closure`. `this` and lambda captures stay visible. The `__for_*` internals show stale values on the `for` line; they're hidden by default.
- `T&&` is dereferenced like `T&`. `double` uses `repr`, `float` the shortest decimal that round-trips in 32 bits, `long double` GDB's text, and `__int128` GDB's text too: GDB 14's `int()` refuses 128-bit values.
- A `std::string` is its first 1,000 bytes decoded as UTF-8, with `len` and `truncated` when it's longer. GDB's target charset is ASCII in the sandbox, so `café` used to end the run, and `max-value-size` made a 70,000-char string `unreadable` while a 60,000-char one went whole on every step.
- A value the libstdc++ printers fail on, with `gdb.error`, `OverflowError` or `ValueError` (a `std::string` in a deleted struct), is `unreadable`, and such a heap object `opaque` with summary `unreadable`. Other exceptions still end the run, so tracer bugs surface. Bulk-read C-array items carry no `type`; the sequence has it.
- Object keys are `<addr>:<type>`, the type without typedefs and `const`, or `tmpN:<type>` for a value with no address.
- Pointers into an array get `target` plus `index` and aren't followed further. The array must be recorded in the same step with the same element type, and the match runs after the whole step is encoded. `index` counts over the whole array, so it can be past the window.
- A pointer that isn't followed has no `target` at all, as the schema says ("absent when the pointer was not followed"), rather than `target: null`. The limits are the defaults, 32 hops and 500 objects; the ceilings aren't configurable.
- `unavailable` reasons: `optimized_out`, `unreadable`, `unknown_return` and `object_limit`.
- Known limits, left for BE-09's type map: records skip base-class fields, `const char*` stays a pointer, and a container's `length` is the number of items read.

Fixtures: `pointer` is the §5.4 program, with its globals, frames and heap; `stl`, `methods`, `array-pointer` and `segfault` cover pointers to records, `this`, and pointers into a local and a global array.

## 4. Returns, calls, crashes (M2-B05 · 2 d)

- [x] Return values via `gdb.FinishBreakpoint.return_value` on user functions
- [x] `callId` / `parentCallId` on call steps; `callId` on returns (§19.9.6)
- [x] `SIGSEGV`, `SIGFPE`, `SIGABRT` → `error` step, then `exit {kind: "signal"}`
- [x] Deep recursion stack overflow recorded as a signal
- [x] **Done:** fib and segfault fixtures pass

**Result:** where it differs from the list:

- One `FinishBreakpoint` at a time, on the innermost call: GDB unwinds to every finish breakpoint's frame on each stop, so one per call cost 3.3 s per 1,000 steps at depth 300, against 0.6 s. It goes on the outermost inline frame, because it never fires under an inline caller, and `main`'s needs `set backtrace past-main on`. A frame left by an exception, `exit()` or `longjmp` gets no return step.
- A return step is the live stack plus the returning frame on top, with `returnValue`: `null` for `void`, `unavailable`/`unknown_return` when GDB can't compute it. Its locals come from the frame's epilogue stop, even one that makes no step: one-line `chmax` and `add` return showing their parameters after the body ran. On arm64 a result returned in memory is read from `x8` saved at the call, because GDB alone reads a clobbered `x8`.
- A frame GDB can no longer find (an exception or `longjmp` unwound it) is dropped at the next stop, and its finish breakpoint deleted.
- A return address overwritten by a stack-smashing write gets no finish breakpoint when it can't be read: GDB couldn't insert one, and the next resume failed with "Command aborted." The return then faults and ends as a signal with its error step, at the last step's line when no frame can be read.
- An internal error's `log` is the exception type and the `trace.py` line numbers from its traceback, never its message, which can carry the user's identifiers or values.
- Every signal GDB stops on is treated as fatal, not just these three. The step is an `exception` step with `error {type, message, line}` at the innermost call's line; `message` is `strsignal`'s text.
- Deep recursion with ordinary frames ends as `memory_limit`, not a signal: stack pages count toward the 256 MB memory limit, so the out-of-memory kill comes first. A real `SIGSEGV` needs huge frames. When the program is SIGKILLed, the tracer kills itself with SIGKILL so the core applies its limits.
- Frames: `method` for functions with `this`, `lambda` for GCC's `__closure` (named `<lambda>`), `function` otherwise. Recursion 100 or more deep costs about 3.3 s per 1,000 steps, reading the 100 capped frames.

Fixtures: `fib`, `recursion` and `methods` (calls, returns, constructors, destructors, a lambda), `one-line` (one-line functions and a `sort` comparator), `implicit` (implicit members make no steps), `exception` (frames unwound without a return step), `values` (the value types and a 24-byte struct returned by value), `segfault`, and `stack-overflow` (32 MiB frames, so it ends in `SIGSEGV`).

## 5. Regression fixtures (§15)

- [x] `sync_with_stdio(false)` with no `endl` still shows output at the right step
- [x] Range-for hides `__for_range` by default
- [x] Segfault → error step with the right exit kind
- [x] Global `int[200005]` is visible (as a window)

**Result:** fixtures `sync-stdio`, `range-for`, `segfault` and `pointer`. The window is the first 100 items, not §11's 1,000: at 1,000, one global `int[200005]` cost about 34 KB of wire and about 3 ms in the core per step (4.5 s per 1,000 steps). 100 stays until BE-09's sparse arrays; a 1,000-step trace with that array takes 1–2 s through `vizctl`. `long` covers the step limit: a marker step, then every breakpoint deleted and a full-speed `continue` to the real exit, with no steps after the marker. `read-loop` reaches it with a one-line `cin >> a[i]` loop into a VLA. BE-11 still stores the tail and adds gcov line hits.

Every C++ fixture's `main.cpp` line table was compared between arm64 and amd64 builds with the manifest's flags: the rows in pc order have the same lines and `is_stmt` flags. Three fixtures first differed by one row inside a line (`exception`, `implicit`, `values`) and were changed until they matched; in `stl`, `pointer` and `one-line` only the column order inside one line differs, which makes no step.

## Done when

The loop, recursion, pointer, fib and segfault programs all trace correctly.
