# S3: SVG arrow overlay

**M0-13 · run Sun 25 Oct 2026 · FE-07 §1 · recommendation: keep the custom SVG overlay; at no throttle it adds 0.4–0.6 ms p50 to a step; at 4× throttle the step misses 16 ms with or without arrows, so the fallback is the state pane's, not the overlay's**

## Question

Can one absolutely positioned SVG, measured with `ResizeObserver` and `getBoundingClientRect` and drawn as cubic Béziers from each `●` to its card, redraw on every step with 500 heap cards and 30 arrows within 16 ms on a mid-range laptop (§18.1, §18.7 S3)? If not, what is the fallback?

This is a short, time-boxed run (40 minutes). It measures keydown to DOM with arrows on and off, at no throttle and at 4× CPU throttle. It doesn't measure paint, scroll or resize redraws, or Safari and Firefox.

## Setup

- **Host:** Apple M5 (10 cores), macOS. Load average 4.4–6.3 throughout, with another agent's builds and tests running.
- **Browser:** Chrome 155.0.8059.85, headless (`--headless=new`), window 1440 × 900 and 1440 × 1200, driven over the DevTools protocol. "Mid-range laptop" is `Emulation.setCPUThrottlingRate` 4×, the DevTools preset.
- **Build:** a production build of `apps/ide` with `VITE_FLAGS=visualize`. `?fixture=` is dev-only, so the harness swaps `main.tsx`'s `import.meta.env.DEV` fixture check for one on `?fixture=` at build time (web/AGENTS.md trap: React's dev build makes step timings meaningless).
- **Page:** the real player on `synthetic-5000`, not a synthetic page: 500 heap cards in the heap column, a globals frame of 500 references in the stack column, so every card has an arrow. A step rewrites 1–3 cards and moves `i`. The overlay draws only arrows with an end on screen; that was 11–20 at the median and 26–30 at most (the >30 fallback never triggered).
- **What a sample is:** dispatch `keydown ArrowRight` on `window`, wait for the state pane's next DOM mutation (the step comes back from the worker, React commits, the overlay's layout effect measures and redraws), force a layout, stop the clock. Two animation frames between samples. 200 steps per row, one run per window size, no reruns. `drawArrows` is set through the persisted settings before load.
- **Overlay as measured:** the version in this commit. Cards and stack labels are each one column in document order, so a binary search finds the on-screen slice; labels inside an offscreen card are skipped, because `content-visibility: auto` left them unlaid and measuring them forces a layout.

## Results

Keydown to DOM, ms, 200 steps per row.

| Window | Throttle | Arrows | p50 | p95 | max | Arrows drawn, median / max |
|---|---|---|---|---|---|---|
| 1440 × 900 | none | on | **4.6** | 7.5 | 11.8 | 11 / 26 |
| 1440 × 900 | none | off | 4.0 | 6.4 | 8.9 | — |
| 1440 × 900 | 4× | on | **16.6** | 30.8 | 37.1 | 11 / 26 |
| 1440 × 900 | 4× | off | 15.2 | 26.4 | 35.6 | — |
| 1440 × 1200 | none | on | **4.5** | 8.1 | 11.5 | 20 / 30 |
| 1440 × 1200 | none | off | 4.1 | 7.2 | 8.9 | — |
| 1440 × 1200 | 4× | on | **17.2** | 32.4 | 39.3 | 20 / 30 |
| 1440 × 1200 | 4× | off | 15.5 | 27.9 | 34.9 | — |

- **The overlay costs 0.4–0.6 ms p50 at no throttle and 1.4–1.7 ms p50 at 4×** (on minus off). Its p95 cost is 1–4 ms at 4×. Without throttle every step is within 16 ms with arrows on: 8.1 ms p95, 11.8 ms worst.
- **At 4× the state pane misses 16 ms without arrows:** 15.2–15.5 ms p50 and 26–28 ms p95 with the overlay off. The overlay pushes the p50 just over 16 ms. The budget is spent in FE-06's render and in the worker round trip, not in the arrows.
- **Measuring everything was the first version, and it was 8× more expensive.** Querying and measuring all 500 labels and 500 cards each step added 1.8 ms p50 at no throttle and 11.8 ms at 4× (60-step runs, 1440 × 900); one query for both added 9.6 ms at 4×. A probe at 4× put the parts at about 3 ms for a `querySelectorAll` over the pane, 2.6 ms for 500 card rects, 2.2 ms for 500 label rects and 1.1 ms for toggling a highlight attribute on 1,000 elements. The slice version above measures O(log n) elements plus what is on screen.

How solid:

- One run per row on a loaded host. The 1440 × 900 and 1440 × 1200 runs agree within 0.6 ms at p50, and an earlier 100-step run of the same build gave 4.6 / 4.0 and 17.7 / 16.4 ms p50: the on-minus-off deltas are stable to about ±1 ms, the p95s less so.
- Headless Chrome on an M5 with 4× throttle stands in for a mid-range laptop; no real one was used.
- The sample ends at a forced layout after the commit, so paint and compositing aren't in it. The SVG holds at most 30 paths plus bundles; a paint profile would settle whether that matters.
- The arrows drawn are 11–20 at the median, not a steady 30: which arrows are on screen depends on where the active frame scrolls the pane. The worst rows (26–30 arrows) are inside the max column.

## Recommendation

- **Keep the custom SVG overlay** (§18.1). It meets 16 ms per step at no throttle with room to spare, and its own cost at 4× is about 1.5 ms.
- **Keep the §5.9 fallback, labels only above 30 visible arrows,** as built. It bounds the paths drawn, not the measuring, which is already limited to the screen.
- **If a step must fit 16 ms at 4×, fix the pane first.** Without arrows it is 15 ms p50 there. Options, cheapest first: move the overlay's redraw out of the step's critical path (draw it in the next animation frame, so arrows trail the cards by one frame), then virtualize the heap column (FE-02's open item).

## Rerun

```bash
cd web && pnpm install
node ../plans/spikes/s3/run.mjs                  # builds to $TMPDIR/s3-dist, serves it on :4181, runs Chrome headless
node ../plans/spikes/s3/run.mjs --no-build --height 1200 --steps 200
```

Flags: `--steps` (200), `--fixture` (`synthetic-5000`), `--width`/`--height` (1440 × 900), `--out` (build directory), `--no-build`, `--chrome` (path to the Chrome binary; macOS default). The script prints one row per throttle and setting.
