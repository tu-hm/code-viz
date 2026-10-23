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

- [ ] Define the `error` fields: `kind` (message key), `line`, `step`, involved values (e.g. `{expr: "a[i]", index: 5, size: 5}`), `raw`
- [ ] Add to the trace schema (minor version) and regenerate types
- [ ] Sign off with FE + DS

## 2. C++ detection

- [ ] Breakpoints on `__ubsan_handle_*` report functions
- [ ] Breakpoint on `__gnu_debug::_Error_formatter::_M_error` (debug-mode containers)
- [ ] Land the error on the exact step and **user** line (walk out of library frames)
- [ ] Read the involved values at that point

## 3. Error kinds (§19.6 table)

- [ ] Index out of range — vector, string, fixed array (C++) and `IndexError` (Python)
- [ ] Signed overflow — operands + type max
- [ ] Division by zero — divisor
- [ ] Empty container — `front()` / `top()` / `*begin()` on empty
- [ ] Recursion too deep — C++ (stack overflow, call depth) and Python (recursion limit)
- [ ] Anything else → raw message, no key

## 4. Tests

- [ ] One fixture per row of the §19.6 table, in C++ and Python where it applies

## Done when

The §19.6 error table works for both C++ and Python.
