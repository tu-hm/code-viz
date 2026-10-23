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

- [ ] GDB Python script that writes wire NDJSON on fd 3
- [ ] Programs: a loop, a recursion, an STL example
- [ ] Output validates against `wire.v1.schema.json`
- [ ] Hand to BE-02 for the gVisor/nsjail measurements

## 2. Tracer core (M2-B03 · 4 d)

- [ ] Run as `gdb -q -nx -batch -x /opt/viz/trace.py --args ./main`
- [ ] Load libstdc++ pretty printers
- [ ] Break at `main`, then loop `step`
- [ ] `skip -gfi /usr/*`; if a stop lands outside `main.cpp`, `finish`
- [ ] One step per stop inside `main.cpp`; record `line` and `prevLine`
- [ ] Frames from `gdb.newest_frame()` walked outward, reversed (outermost first)
- [ ] Stdin from the job's file; stdout/stderr on fd 1/2
- [ ] Seed `rand()` / ASLR off (§7.12)
- [ ] **Done:** loop, recursion and STL programs trace correctly

## 3. Variables & pointers (M2-B04 · 4 d)

- [ ] Locals from `frame.block()` in declaration order
- [ ] Hide a variable while `symbol.line > current line` (no garbage values)
- [ ] Flag `internal`: names starting with `__`, compiler-generated (`__for_range`, etc.)
- [ ] Globals from the static block of `main.cpp` → separate **globals** frame
- [ ] Inline values: integers, floats, `bool`, `enum` (enumerator name), `char` (+ `code`)
- [ ] `T&` → referenced value with `type: "T&"`
- [ ] `T*` → `ptr {addr, target, index?}`; `0x0` = nullptr
- [ ] Follow pointers to user `struct`/`class` or into a recorded array; object key `(address, type)`
- [ ] Stop following at `maxPointerDepth` (32 / 128) or per-step object budget (500 / 2,000) → `target: null`
- [ ] Unreadable → `unavailable {reason}`
- [ ] **Done:** `cpp_view` mock data (§5.4) reproduced

## 4. Returns, calls, crashes (M2-B05 · 2 d)

- [ ] Return values via `gdb.FinishBreakpoint.return_value` on user functions
- [ ] `callId` / `parentCallId` on call steps; `callId` on returns (§19.9.6)
- [ ] `SIGSEGV`, `SIGFPE`, `SIGABRT` → `error` step, then `exit {kind: "signal"}`
- [ ] Deep recursion stack overflow recorded as a signal
- [ ] **Done:** fib and segfault fixtures pass

## 5. Regression fixtures (§15)

- [ ] `sync_with_stdio(false)` with no `endl` still shows output at the right step
- [ ] Range-for hides `__for_range` by default
- [ ] Segfault → error step with the right exit kind
- [ ] Global `int[200005]` is visible (as a window)

## Done when

The loop, recursion, pointer, fib and segfault programs all trace correctly.
