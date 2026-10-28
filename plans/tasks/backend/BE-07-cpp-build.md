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

- [x] `adapters/cpp/flush_init.cpp` (unbuffered stdout + `std::unitbuf` before `main`)
- [x] Base flags: `g++ -std=gnu++17 -O0 -g3 -fno-omit-frame-pointer main.cpp /opt/viz/flush_init.cpp -o main`
- [x] Safety flags (default on, D21): `-D_GLIBCXX_DEBUG -fsanitize=undefined -fno-sanitize-recover=all`
- [x] `--coverage` (for line hits, BE-11)
- [x] Warnings: `-Wall -Wextra -Wshadow`
- [x] Two precompiled headers `bits/stdc++.h.gch`: checks **on** and checks **off**, each built with the matching flags
- [x] Option to switch checks off (matches the judge) — wire through `options` and cache key
- [x] Build timeout 10 s → `compile_error` "Build timed out"
- [x] Measure build time with PCH (target ≤ 3 s)

## 2. Runner image + diagnostics (M2-B02 · 2 d)

- [x] `adapters/cpp/Dockerfile`: Debian slim, GCC 13 + GDB 14 pinned, both PCHs, `flush_init.cpp`, libstdc++ pretty printers
- [x] `adapters/cpp/manifest.yaml` (§10.2) incl. `capabilities.pointers: true`
- [x] Image ≤ 1.5 GB
- [ ] cosign sign
- [x] Parse GCC output `main.cpp:L:C: error|warning: msg` → `{line, column, severity, message}`
- [x] Keep `raw` compiler output in the response
- [x] Warnings returned even when the build succeeds (warnings panel)
- [x] Hide paths outside `main.cpp` from the user (or attach to the nearest user line)
- [x] **Done:** the §8.3 failed-build example is reproduced exactly

**Status (24 Oct):**
- **Image:** `viz-runner-cpp:13.5-gdb14-1` is GCC 13.5.0 copied from the official `gcc` image onto `debian:bookworm-slim`, plus GDB 14.2 built from source (no distro ships 14). It is about 870 MB unpacked.
- **PCHs:** both sit in one `bits/stdc++.h.gch/` directory, and GCC picks one by `_GLIBCXX_DEBUG`.
- **Manifest:** `enabled: false` until BE-08, so the API refuses `cpp17-gcc`. `vizctl` and the fixture tests trace it.
- **Switch:** `options.safetyChecks: false` drops `build.safetyFlags` and gets its own cache key. Python rejects it.
- **Diagnostics:** errors in system headers take the user line GCC printed as their context. `fatal error` becomes `error`, notes are dropped, and a linker `undefined reference` gets its line.
- **§8.3:** the program gives exactly the example's diagnostics. Its `raw` also has GCC's `main.cpp: In function 'int main()':` line, so the spec example now shows that (v1.8).
- **viz-shim:** turning on the C++ goldens showed that it forwarded the program's stdout and the tracer's fd 3 out of order. Output landed a step late about 1 run in 4. It now forwards fd 1/2 output written before a wire line ahead of it.
- **Left:** cosign signing needs the registry (BE-13).

## 3. Spike S7 — safety-check overhead (M2-B10 · 1.5 d)

- [x] Collect 10 real CP solutions
- [x] Compare compile time with PCH (target ≤ 3 s) and run time with checks + coverage vs unchecked (target ≤ 3×)
- [x] Report for **G5**; record in spec §0.3

**Status (24 Oct):** the report is [S7](../../spikes/s7-safety-checks.md), and the harness is `plans/spikes/s7/`.
- **Builds pass:** 0.3–0.8 s with the PCH. Builds that skip the PCH fit in 256 MB once `build.cmd` has `--param ggc-min-heapsize=32768 --param ggc-min-expand=30`, now in the manifest.
- **Run time fails with `_GLIBCXX_DEBUG`:** 6 of 9 programs ran over 3×, and 3 never finished in 60 s (heap operations, `lower_bound` and pb_ds check the whole container).
- **Lighter flags pass:** `-D_GLIBCXX_ASSERTIONS -fsanitize=undefined -fno-sanitize=null,alignment,pointer-overflow` stays within 3× everywhere measured.
- **G5 decides:** D21 is unchanged until then.
- **Caveat:** the numbers come from a loaded machine, and the run-time data is thin. `plans/spikes/s7/run.sh` measures everything in one pass (about 70 min on a quiet machine).

## Done when

A build takes ≤ 3 s, and the failed-build example in §8.3 is reproduced.
