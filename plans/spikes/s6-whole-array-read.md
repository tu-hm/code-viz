# S6: whole-array read and diff in GDB

**Gate G5 (Fri 19 Feb) · run Sat 24 Oct 2026 · BE-09 §3 · recommendation: read every int array whole on each step and diff it block-wise; passes both targets for the common case; not decided**

## Question

Can the C++ tracer read a 200,005-int array with one `gdb.Inferior.read_memory` per step and diff it against the previous step to get exact dirty cells, within 2 ms per step, and 1,000 steps within 3 s in total (§18.7, §19.9.1)? If not, the fallback is window-only (§11: the tracer keeps its first N items).

This is a short, time-boxed run. It measures the read, one fast diff against a naive baseline, and the 1,000-step total. It doesn't measure p99, the 4 MB per-array or 16 MB per-step budgets, or other diff variants.

## Setup

- **Host:** Apple M5, Docker 29.8.2 on OrbStack (Linux arm64 VM, 10 vCPUs). Host load average 6–8 throughout, with other sessions running builds and spikes.
- **Image:** `viz-runner-cpp:13.5-gdb14-1`: GDB 14.2 with Python 3.11.2, GCC 13.5.0.
- **Box:** the dev sandbox's settings from `dockersandbox.go`: its seccomp profile (which allows GDB's `personality`), no capabilities, `no-new-privileges`, read-only root, 64 MiB `/work` tmpfs, uid 65534, no network, 1 CPU, 256 MiB, 32 PIDs, 256 MiB stack.
- **Program:** `programs/dfs`: a recursive DFS over the implicit binary tree `u → 2u, 2u+1` with n = 200,000. Each call writes one cell of a global `int a[200005]` (800,020 bytes). It's built with the manifest's `build.cmd`, without `safetyFlags`.
- **Diff methods**, both in `diff.py`. Both return the exact dirty indexes, and the bench asserts that they agree on every stop:
  - **fast:** `bytes ==` over the whole array first. If that differs, compare 4 KB blocks, then 64-byte chunks inside a dirty block, then single cells inside a dirty chunk.
  - **naive:** `struct.unpack` both arrays into tuples, then loop over `zip` comparing each int.
- **Live bench** (`bench.py`): GDB stops on the three lines of `dfs` 1,000 times. At each stop it times `read_memory`, `.tobytes()` (to get `bytes`, whose `==` is a `memcmp`), and the two diffs. 661 stops changed 0 cells and 338 changed 1.
- **Synthetic cases:** the same diffs on in-memory 800,020-byte buffers, with 0 cells changed, 2 cells, one cell in every 4 KB block (196 cells), and every cell.
- **End to end** (`trace_s6.py`): BE-08's `trace.py`, unchanged, with its `c_array` wrapped. Each time a step encodes an int array of 4 MB or less, the wrapper reads the array whole and runs the fast diff against the previous step. The wire output is unchanged: the tracer still sends 100 items. So the numbers are the tracer-side cost of read and diff only, not the cost of emitting sparse cells (S4 measured trace size). GDB time per 1,000-step run, 5 rounds, the two tracers alternating.

## Results

### Per step, 200,005 ints

Microseconds. The live rows are medians and p90s over 1,000 stops in two runs; the two runs' medians are given as a range.

| What | Median | p90 |
|---|---|---|
| `read_memory(addr, 800020)` | 60–77 | 80–100 |
| `.tobytes()` | 14–15 | 16–17 |
| **fast diff**, live (0 or 1 cell) | **21–23** | 75–84 |
| naive diff, live | 6,089–6,359 | 6,778–7,379 |
| GDB `continue` to the next stop (for scale) | 157–187 | 306–485 |

| Synthetic case (median, µs) | fast | naive |
|---|---|---|
| 0 cells changed | 13 | 5,511–5,727 |
| 2 cells | 63–68 | 5,535–5,815 |
| 196 cells, one per 4 KB block | 1,376–1,449 | 5,941–6,024 |
| every cell (200,005) | **22,191–22,344** | 6,298–6,376 |

- **Read, `tobytes` and the fast diff together cost about 0.1 ms per step**, a twentieth of the 2 ms budget. The read itself is under 0.1 ms; a single `bytes ==` over 800 KB costs 11–13 µs.
- **The naive loop fails the target by 3×:** about 6 ms per step whatever changed, because it boxes 400,010 Python ints.
- **A step that rewrites most of the array is the fast diff's worst case:** 22 ms when every cell changes, 3.5× slower than naive, because it falls through to one slice compare per cell. With one dirty cell per 4 KB block it's still 1.4 ms. Such steps come from a `sort`, `fill` or `memset` over non-zero data, or a one-line loop that writes every cell. They are rare in 1,000 steps, but each one costs 6–22 ms.

### 1,000 steps, end to end

GDB time per run, 1,000 steps (plus the 1,001st, which the core drops) and the untraced tail:

| Tracer | Round 1 | 2 | 3 | 4 | 5 | Median |
|---|---|---|---|---|---|---|
| `trace.py` (BE-08) | 0.648 s | 0.669 | 0.667 | 0.748 | 0.757 | 0.667 s |
| + whole-array read and fast diff | 0.828 s | 0.793 | 0.951 | 0.929 | 0.905 | **0.905 s** |
| Difference | +0.180 | +0.124 | +0.284 | +0.181 | +0.148 | **+0.18 s** |

- **1,000 steps take 0.79–0.95 s with the read and diff, well under 3 s.** The added cost is 0.12–0.28 s per 1,000 steps (0.12–0.28 ms a step). The per-step microbench predicts about 0.1 ms; the rest is noise from a loaded host.
- Every step read and diffed the array: 1,000 diffs, which found 209 dirty cells in total.
- BE-08's own tracer takes 0.65–0.76 s for this program, against its 0.27 s for the `long` loop. The difference is this program's recursion (up to 17 frames per step) and host load, not S6.

## Recommendation for G5

**Track big arrays whole (§19.9.1), with the block-wise diff; window-only is not needed for a 200k int array.** Read and fast diff cost about 0.1 ms per step against a 2 ms budget, and 1,000 steps take 0.9 s against 3 s. Recommended diff, for any array of fixed-size scalars (`size` = element size in bytes):

```python
BLOCK = 4096
CHUNK = 64


def dirty(old, new, size):
    if old == new:
        return []
    out = []
    n = len(new)
    for b in range(0, n, BLOCK):
        if old[b:b + BLOCK] == new[b:b + BLOCK]:
            continue
        for c in range(b, min(b + BLOCK, n), CHUNK):
            if old[c:c + CHUNK] == new[c:c + CHUNK]:
                continue
            out += [i // size for i in range(c, min(c + CHUNK, n), size) if old[i:i + size] != new[i:i + size]]
    return out
```

`old` and `new` are `bytes`: `gdb.selected_inferior().read_memory(addr, t.sizeof).tobytes()`. Keep the previous step's `bytes` per array address. Don't compare the `memoryview` that `read_memory` returns: in a first probe, `memoryview.cast('i') ==` took 138 µs on two equal arrays, against 11 µs for `bytes ==`.

**Fallback:** window-only, as §19.9.1 already says, for an array over 4 MB or a step over 16 MB. Those budgets weren't measured here. A linear extrapolation from 60–77 µs per 800 KB puts a 4 MB read near 0.4 ms and 16 MB near 1.5 ms before the diff; BE-09 §2 should check them.

**Worst case to settle in BE-09 §2:** a step that changes most cells costs up to 22 ms with this diff. A cheap guard is to count dirty 64-byte chunks first, and switch to the `struct.unpack` loop (6 ms flat) once most chunks are dirty. That caps the step near 6 ms. It isn't measured.

### Open questions

- **A step that changes more than 10,000 cells** (a `sort` of the whole array): §19.9.1 caps a keyframe at 10,000 non-default cells but says nothing about how many cells a delta's `patch` can carry. Recommended default: a patch over 10,000 cells is sent as the whole sparse form, or as `truncated` with the window if that is over the cap too, the same rule as a keyframe.
- **The whole-array diff on a loaded runner:** the spec has no per-step tracer budget beyond S6's 2 ms. Recommended default: no extra limit; the 15 s wall time (§11) already bounds a run of slow steps.

## Not covered

- **amd64 and nsjail.** arm64 in the Docker dev box only. GDB fails under emulation here.
- **p99** and **the 4 MB / 16 MB budgets** (1M ints per array, 16 MB per step). Cut for time.
- **Other diff methods** (`memoryview.cast('i')`, the `array` module, XOR with a regex scan). A first probe on two equal arrays, with no dirty indexes: 138 µs for `memoryview.cast('i') ==`, 28 µs for `array ==`, 11 µs for `bytes ==`.
- **Emitting the sparse form**: finding the default value, encoding the non-default cells and patches, and the core's cost to validate them. S4 measured 10 ms per 200k array per step for `collections.Counter` to find the most common value, so BE-09 §2 needs a cheaper way to pick the default.
- **The D21 build** (`safetyFlags`). It doesn't change how an `int[]` is laid out in memory.
- **A quiet machine.** Host load average was 6–8 throughout.

## How to rerun

```sh
plans/spikes/s6/run.sh [rounds]   # about 1 min for 5 rounds; needs viz-runner-cpp:13.5-gdb14-1 (make images)
```

`run.sh` starts one box with the dev sandbox's settings. `box.sh` builds `programs/dfs` with the manifest's `build.cmd`, runs `bench.py` under GDB (1,000 live stops, then the synthetic cases), then alternates `/opt/viz/trace.py` and `trace_s6.py` for the given number of rounds and prints the GDB time of each. `trace_s6.py` runs the image's `trace.py` with BE-08's `c_array(key, value, type_name, t, snap, depth)` wrapped, so it needs a runner image built from `1af86c0` (BE-08). BE-09's `trace.py` reads and diffs whole arrays itself.
