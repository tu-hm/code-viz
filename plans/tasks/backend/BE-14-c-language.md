# BE-14 · C language support

| | |
|---|---|
| **Milestone** | M4 |
| **Estimate** | 5 days |
| **Depends on** | BE-07, BE-08, BE-09 |
| **Blocks** | — |
| **Covers** | M4-B01, M4-B02 (alternative: M4-B03) |
| **Spec** | §10.4, §10.5 |

Prove a new language needs **no Go, API or UI changes** — only an image, a manifest and a type map.

## 1. C adapter (M4-B01 · 3 d)

- [ ] `adapters/c/` reusing the C++ GDB tracer (`trace.py`)
- [ ] Build: `gcc -std=c17 -O0 -g3 -fno-omit-frame-pointer` + UBSan + `--coverage` + warnings
- [ ] C version of `flush_init` (`setvbuf` only)
- [ ] Type map: drop STL rows; keep arrays, structs, pointers, `char`, `char*` → `str`
- [ ] Runner image (reuse the C++ base), manifest with honest capabilities

## 2. Conformance & rollout (M4-B02 · 2 d)

- [ ] Port the conformance suite to C (≥ 30 programs, §10.4)
- [ ] Image security review (no setuid, no network tools)
- [ ] Register the manifest behind a feature flag
- [ ] Rollout plan 5% → 50% → 100%
- [ ] Confirm no changes were needed in `vizd` or the UI (if any were, write them down — that's a finding)

## Alternative (not planned): generic DAP bridge (M4-B03 · 8 d)

Static Go binary with `google/go-dap` driving any debug adapter. Doesn't fit in M4; revisit after launch.

## Done when

The conformance suite passes for C.
