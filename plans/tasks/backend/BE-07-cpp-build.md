# BE-07 · C++ build & compile errors

| | |
|---|---|
| **Milestone** | M2 |
| **Estimate** | 6.5 days |
| **Depends on** | BE-02 (sandbox), BE-05 (worker build stage) |
| **Blocks** | BE-08 tracer, BE-11 line hits |
| **Covers** | M2-B01, M2-B02, M2-B10 |
| **Spec** | §7.11.2, §8.3, §10.2, §19.6, §18.7 S7 |
| **Gate** | **G5 · Fri 19 Feb** — safety checks default (input: S7) |

🔁 **Handoff to FE:** structured diagnostics for the error panel.

## 1. Build pipeline (M2-B01 · 3 d)

- [ ] `adapters/cpp/flush_init.cpp` (unbuffered stdout + `std::unitbuf` before `main`)
- [ ] Base flags: `g++ -std=gnu++17 -O0 -g3 -fno-omit-frame-pointer main.cpp /opt/viz/flush_init.cpp -o main`
- [ ] Safety flags (default on, D21): `-D_GLIBCXX_DEBUG -fsanitize=undefined -fno-sanitize-recover=all`
- [ ] `--coverage` (for line hits, BE-11)
- [ ] Warnings: `-Wall -Wextra -Wshadow`
- [ ] Two precompiled headers `bits/stdc++.h.gch`: checks **on** and checks **off**, each built with the matching flags
- [ ] Option to switch checks off (matches the judge) — wire through `options` and cache key
- [ ] Build timeout 10 s → `compile_error` "Build timed out"
- [ ] Measure build time with PCH (target ≤ 3 s)

## 2. Runner image + diagnostics (M2-B02 · 2 d)

- [ ] `adapters/cpp/Dockerfile`: Debian slim, GCC 13 + GDB 14 pinned, both PCHs, `flush_init.cpp`, libstdc++ pretty printers
- [ ] `adapters/cpp/manifest.yaml` (§10.2) incl. `capabilities.pointers: true`
- [ ] Image ≤ 1.5 GB; Trivy scan; cosign sign
- [ ] Parse GCC output `main.cpp:L:C: error|warning: msg` → `{line, column, severity, message}`
- [ ] Keep `raw` compiler output in the response
- [ ] Warnings returned even when the build succeeds (warnings panel)
- [ ] Hide paths outside `main.cpp` from the user (or attach to the nearest user line)
- [ ] **Done:** the §8.3 failed-build example is reproduced exactly

## 3. Spike S7 — safety-check overhead (M2-B10 · 1.5 d)

- [ ] Collect 10 real CP solutions
- [ ] Compare compile time with PCH (target ≤ 3 s) and run time with checks + coverage vs unchecked (target ≤ 3×)
- [ ] Report for **G5**; record in spec §0.3

## Done when

A build takes ≤ 3 s, and the failed-build example in §8.3 is reproduced.
