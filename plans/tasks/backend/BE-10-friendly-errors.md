# BE-10 · Friendly errors

| | |
|---|---|
| **Milestone** | M3 (by week 2) |
| **Estimate** | 3 days |
| **Depends on** | BE-08 §4 (signals as error steps), BE-07 (safety flags), BE-03 |
| **Blocks** | FE friendly-error UI |
| **Covers** | M3-B01 |
| **Spec** | §19.6 |

Send structured error data so the UI can show one sentence + one hint.

🔁 **Agree the payload shape with FE and Design before M3.**

## 1. Payload design

- [x] Define the `error` fields: `kind` (message key), `line`, `step`, involved values (e.g. `{expr: "a[i]", index: 5, size: 5}`), `raw`
- [x] Add to the trace schema (minor version) and regenerate types
- [ ] Sign off with FE + DS

**Result:** trace format 1.2 (spec v1.12, §19.6). `error` keeps `type`, `message` and `line` and adds `kind` (`index_out_of_range`, `signed_overflow`, `division_by_zero`, `empty_container`, `recursion_too_deep`) and `values`. Where it differs from the list:

- `step` is the error step's own `i`, and `raw` is `message`, the runtime's own words, so neither is a new field.
- `values` holds what the tracer could read, each field optional: `name`, `type`, `index`, `size` for an index; `op`, `operands`, `type`, `max` for an overflow; `expr` and `divisor` for a Python division; `call`, `type`, `name` for an empty container; `depth` and Python's `limit` for recursion. Program values are decimal strings, as in `value.v`, so `long long` keeps its precision.
- There's no `expr` like `a[i]` in C++: UBSan's column points at the operator or the `]`, and libstdc++ gives none. The UI can say "Index out of range: a[5], size 5" (§19.5) from `name`, `index` and `size`. Python has the source text, from the AST.
- **Open: sign-off.** FE + DS haven't seen the shape yet. The spec's §19.6 table is the proposal.

## 2. C++ detection

- [x] Breakpoints on `__ubsan_handle_*` report functions
- [x] Breakpoint on `__gnu_debug::_Error_formatter::_M_error` (debug-mode containers)
- [x] Land the error on the exact step and **user** line (walk out of library frames)
- [x] Read the involved values at that point

**Result:**

- Also `std::__glibcxx_assert_fail`: `string`, `std::array`, `queue`, `stack` and `priority_queue` check with libstdc++ assertions, not the debug containers. Not `__ubsan_handle_dynamic_type_cache_miss`: vptr checks call it on every cache miss, and a `catch` stopped there in the `exception` fixture.
- The functions have no debug info, so the arguments come from `x0`–`x3` or `rdi`–`rcx`. UBSan's data and type descriptors, and libstdc++'s `_Error_formatter`, whose layout the program's own debug info has, give the values.
- The error step is a snapshot at the innermost traced call's line, like a signal's. Then the tracer lets the program finish untraced: its report lands on stderr of that step, and the exit is what the process did (`SIGABRT`, or exit code 1 after UBSan).
- Only verified on arm64. The amd64 path (registers, the stack-overflow test) runs first in CI; the new fixtures' line tables match on both.

## 3. Error kinds (§19.6 table)

- [x] Index out of range — vector, string, fixed array (C++) and `IndexError` (Python)
- [x] Signed overflow — operands + type max
- [x] Division by zero — divisor
- [x] Empty container — `front()` / `top()` / `*begin()` on empty
- [x] Recursion too deep — C++ (stack overflow, call depth) and Python (recursion limit)
- [x] Anything else → raw message, no key

**Result:**

- Index: `vector`, `deque`, `string`, `std::array` and C arrays; a `size_t` index reads as signed, so `v[i - 1]` at `i = 0` is `-1`. Python: an `IndexError` from a subscript, not from `pop()`.
- Overflow: `+`, `-`, `*`, negation and `INT_MIN / -1`, with `max` from the type's width.
- Division: C++ knows only that the divisor is 0 (UBSan doesn't tell `/` from `%`). Python gives `expr` and `divisor` as text.
- Empty: any libstdc++ empty check (`front`, `back`, `top`, `pop_back` …), and a past-the-end dereference when the container is empty (`*s.begin()`); on a non-empty one it stays a raw message.
- Recursion: C++ when a `SIGSEGV` faults within 64 KiB of the stack pointer, with `depth` the calls on the stack. Deep recursion with small frames still ends as `memory_limit` (BE-08), with no step to carry it.
- Python reads values from names, constants, builtin containers indexed by `int` or `str`, and integer arithmetic only, so it never runs the program's code (`error-index-object`).
- Not covered: a check that fails after the step limit or before `main` has only its exit.

## 4. Tests

- [x] One fixture per row of the §19.6 table, in C++ and Python where it applies

**Result:** C++ `check-index-vector`, `check-index-string`, `check-index-array`, `check-overflow`, `check-divide`, `check-empty-queue`, `check-empty-set`, `check-shift` (anything else) and `stack-overflow`; Python `exception`, `error-index-grid`, `error-index-object`, `error-divide`, `recursion-limit` and `error-other`. `TestErrorKindsHaveFixtures` fails when a schema `errorKind` is on no golden's error step. The golden test masks addresses in stderr, which libstdc++'s reports print.

## Done when

The §19.6 error table works for both C++ and Python.
