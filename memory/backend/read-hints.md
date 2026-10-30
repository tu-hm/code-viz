# Read hints come from instrumentation

Decided 2026-10-25.

**Decision:** Both tracers record the sequence cells each step reads, and the core turns them into `access` (BE-11 §5, spec v1.17). C++ builds with `-fsanitize=kernel-address` and every check made a call; `/opt/viz/reads.o` supplies the hooks and records load addresses, which `trace.py` maps onto the buffers it records. Python uses a `sys.monitoring` INSTRUCTION callback on `main.py`'s code objects, beside `sys.settrace`. A read names the sequence holding the cell and one index. The player's matrix maps row objects back to `[r, c]` (`exactReads` in `marks.ts`).

**Why:**
- **Spike S8:** tree-sitter inference got 77.6% of subscript lines right in contest-style code ([S8 report](../../plans/spikes/s8-tree-sitter.md)).
- **What was ruled out, and why:**
  - *Python `f_trace_opcodes`:* 3.12 gives no opcode events when it's set in the call hook. Setting it before `settrace` sends every instruction of every module through the legacy layer, the untraced tail's included.
  - *Filtering C++ loads by PC to keep only `main.cpp`'s:* this drops `std::max(dp[c], …)`, which loads through its reference inside library code.
  - *Lifting 2-D reads to `[r, c]` in the core:* this would put the player's matrix rule in Go and leave row cards with nothing.
- **Cost:** 12–18% run time with the safety checks on, 1.3–2.3× with them off. Python's cost is within noise.

**How to apply:**
- **Keep `reads.o` uninstrumented.** Instrumented, each hook would call itself.
- **Keep the PCH flags equal to `build.cmd`.** `-fsanitize=kernel-address` defines `__SANITIZE_ADDRESS__`, so a PCH built without it is skipped and every build parses the whole header.
- **Tag `buffer` on any new contiguous reader in `trace.py`,** or its reads disappear.
- **If G2 moves the step hooks to `sys.monitoring`,** keep the reads callback on its own tool id, or fold it into the new one. Don't move it to `f_trace_opcodes`.
- **Known gap:** GCC leaves out the call for a constant index into a named C array (`a[0]`). The player infers when a step's `access` is empty, which covers a line with only such reads.
