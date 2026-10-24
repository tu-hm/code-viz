# FE-02 · Trace player, shell & step controls

| | |
|---|---|
| **Milestone** | M0 (weeks 2–3) → M1 (weeks 4–6, shell) → M3 (autoplay, perf) |
| **Estimate** | 11 days |
| **Depends on** | FE-01 (codegen, fixtures); FE-04 §2 for real API loading |
| **Blocks** | Every view (FE-03, FE-06–FE-11) |
| **Covers** | M0-15, M0-16, M0-18, M3-F06, M3-F12, + new: visualizer shell & settings |
| **Spec** | §5.2, §5.7, §5.9, §8.4, §9.6, §13, §19.3 |

Load a trace and move to any step instantly. Includes the visualizer frame (header, panes, status bar, settings) that every view sits in.

## 1. `@viz/player` skeleton (M0-15 · 1 d · week 2)

- [x] `loadTrace(source)`: header + chunk list from a file (fixtures) or an API response (§8.3) — `@viz/player` `load.ts`; the API source takes the manifest plus a `refresh` callback the host wires to its client (FE-04)
- [x] Fetch chunks in order, gunzip if not done by the browser, **verify `sha256`** before use (§8.4) — hash over the unzipped JSON (§8.4), checked against `make dev`
- [x] Unknown fields ignored; unknown `kind` → `opaque`, unknown `t` → plain text (§9.7)
- [x] Refresh expired chunk URLs: if `urlsExpireAt` has passed, re-`GET /visualizations/{id}` before fetching (§8.4) — checked before every chunk; seen against the real API
- [x] Typed errors: checksum mismatch, network, schema version too new — `ChecksumError`, `NetworkError`, `VersionError` by `name`, so they survive Comlink
- [x] **Done:** loads every fixture — and the eight real Python traces in `backend/fixtures/python`

## 2. Trace engine in a Web Worker (M0-16 · 3 d · weeks 2–3)

- [x] Worker via Comlink; main thread only receives materialized steps — the worker also fetches and parses the chunks
- [x] Rebuild step `k`: nearest keyframe ≤ `k`, then apply deltas (frames/objects replaced whole, `removedObjects` dropped, `stack` from step `k`) (§9.6) — starts from a cached step `k − 1` when there is one
- [x] 200-step LRU of materialized states
- [x] Prefetch neighbours (k ± 2) so Next/Prev hit the cache
- [x] Apply v1.1 sparse `patch` onto sparse sequences (§19.9.1) — fixtures until BE-09
- [x] Per-step derived data the views need: changed values vs previous step, new objects, stdout up to step `k` — `StepState.changed` (locals by frame, cells by object), `newObjects`, `output` segments with the current step marked
- [x] Unit tests: random-access equals sequential replay on every fixture
- [x] **Done:** ≤ 16 ms per step on the 1,000-step fixture (mid-range laptop profile) — worst step 1.4 ms (engine + copy out, median of 3 cold runs); keydown to DOM in Chrome p50 0.4 ms, max 2 ms

## 3. Controls, slider, keyboard (M0-18 · 1.5 d · week 3)

- [x] Step counter "Step N of M · <event> <detail>"
- [x] Start `|◀`, Prev, Next, End `▶|`, slider (scrub, throttled to animation frames)
- [x] Shortcuts (§5.9): `←` `→` `Home` `End` `Esc`; `Shift+→` / `Shift+↑` wired once FE-10 lands — the Shift pair came with FE-10's Go to…
- [x] Shortcuts disabled while typing in inputs — also inside dialogs, and for the keys a focused slider, divider or button uses itself
- [x] Current step in Zustand; URL `?step=` kept in sync (used by FE-12) — 1-based, as shown; written 300 ms after stepping stops (Safari's `replaceState` limit)
- [x] **Done:** all §5.9 shortcuts work

## 4. Visualizer shell & settings (new · 2 d · M1 weeks 4–6)

**Layout (§5.2, §19.3)**
- [ ] Header: language, file name, "Safety checks: on/off" (C++), Settings, Share (slot for FE-12), Open in new tab, Close (`Esc`) — all in; Share is a `share` slot and Open in new tab shows once FE-12 passes a `permalink`
- [x] Left: code pane (FE-03) + controls; right: state pane (FE-06 / FE-08 / FE-11 slots) — the player draws FE-06's state pane itself (`StateBox`), so the `statePane` slot is gone; FE-08 and FE-11 add their views inside it
- [x] Bottom row: STDIN (read-only) and STDOUT/STDERR **up to the current step**, stderr in red, current step's text highlighted
- [x] Status bar: exit status, step count, banner slot (FE-05) — FE-05's error, limit and untraced-tail banners are in the status bar; the `banner` slot carries the IDE's build warnings
- [x] Draggable divider, width saved in `localStorage` — also ← / → when focused

**Settings (§5.7, §19.3 display options)**
- [x] Max steps, autoplay speed, draw arrows, highlight changes, show unreachable objects, matrix view, show memory addresses, show compiler internals, safety checks (C++)
- [x] Display: density (Compact / Comfortable), font size S/M/L, theme light/dark/system
- [x] Hide settings the language can't support, from manifest `capabilities` (FR-24) — memory addresses follow `pointers`; the manifest has no safety-checks capability, so that setting shows when the trace's `options.safetyChecks` is set
- [ ] Persist in `localStorage` (anonymous); profile storage hook for signed-in users — `localStorage` done, each field validated on load; profile storage waits on the API auth decision (`usePlayer.persist.setOptions({ storage })` is where it plugs in)
- [x] "Max steps" and "safety checks" apply on the next run (say so in the UI)

- [x] **Done:** the §5.3 layout renders around the fixture views; settings survive a reload — with FE-06's state pane; checked in Chrome against `make dev` (25 Oct). `?fixture=<name>` under `pnpm dev` shows it

## 5. Autoplay (M3-F06 · 1.5 d)

- [x] Play/pause button and `Space`
- [x] Speeds 0.5×, 1×, 2×, 4× (1× = 2 steps/s)
- [x] Stops at error steps and at breakpoints (FE-03 gutter) — the gutter fills `usePlayer` `breakpoints`
- [x] Stops at the last step; any manual navigation pauses — Play on the last step starts over
- [x] Respects `prefers-reduced-motion` for highlight fades only (stepping still works)
- [x] **Done:** §5.9 rules pass as unit tests

## 6. Performance (M3-F12 · 2 d)

- [x] Profile on the 5,000-step fixture with 500 heap objects — rebuild 0.08 ms on average; the copy to the main thread (175 KB, 1.6 ms) is the cost; p99 4.5 ms
- [x] Memory under 300 MB (heap snapshot in CI perf job) — a forced-GC heap check in `pnpm test`: 53 MB for the trace plus a full cache; the main thread used 75 MB in Chrome
- [ ] Virtualize long heap columns / containers (TanStack Virtual) — not needed yet: FE-06's cards skip unchanged objects and use `content-visibility: auto` (4.0 ms p50 on 500 cards); revisit with FE-08's containers
- [x] No layout shift between steps (§19.10) — for the shell: no box moved over 325 steps in Chrome; the views bring their own (FE-06)
- [x] Perf budget test in CI: fail if stepping on the 1,000-step fixture goes over 16 ms — `engine.perf.test.ts`
- [x] **Done:** §13 step-navigation target met on 5,000 steps — keydown to DOM with FE-06's state pane on `synthetic-5000` (500 objects): 4.0 ms p50, 7.0 ms p95, 11.6 ms max in a production build in Chrome; `synthetic-1000` 1.9 ms p50

## Done when

Stepping takes ≤ 16 ms on 1,000 steps and works on 5,000 steps with memory under 300 MB, inside the full §5.2 shell.
