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

- [ ] `loadTrace(source)`: header + chunk list from a file (fixtures) or an API response (§8.3)
- [ ] Fetch chunks in order, gunzip if not done by the browser, **verify `sha256`** before use (§8.4)
- [ ] Unknown fields ignored; unknown `kind` → `opaque`, unknown `t` → plain text (§9.7)
- [ ] Refresh expired chunk URLs: if `urlsExpireAt` has passed, re-`GET /visualizations/{id}` before fetching (§8.4)
- [ ] Typed errors: checksum mismatch, network, schema version too new
- [ ] **Done:** loads every fixture

## 2. Trace engine in a Web Worker (M0-16 · 3 d · weeks 2–3)

- [ ] Worker via Comlink; main thread only receives materialized steps
- [ ] Rebuild step `k`: nearest keyframe ≤ `k`, then apply deltas (frames/objects replaced whole, `removedObjects` dropped, `stack` from step `k`) (§9.6)
- [ ] 200-step LRU of materialized states
- [ ] Prefetch neighbours (k ± 2) so Next/Prev hit the cache
- [ ] Apply v1.1 sparse `patch` onto sparse sequences (§19.9.1) — fixtures until BE-09
- [ ] Per-step derived data the views need: changed values vs previous step, new objects, stdout up to step `k`
- [ ] Unit tests: random-access equals sequential replay on every fixture
- [ ] **Done:** ≤ 16 ms per step on the 1,000-step fixture (mid-range laptop profile)

## 3. Controls, slider, keyboard (M0-18 · 1.5 d · week 3)

- [ ] Step counter "Step N of M · <event> <detail>"
- [ ] Start `|◀`, Prev, Next, End `▶|`, slider (scrub, throttled to animation frames)
- [ ] Shortcuts (§5.9): `←` `→` `Home` `End` `Esc`; `Shift+→` / `Shift+↑` wired once FE-10 lands
- [ ] Shortcuts disabled while typing in inputs
- [ ] Current step in Zustand; URL `?step=` kept in sync (used by FE-12)
- [ ] **Done:** all §5.9 shortcuts work

## 4. Visualizer shell & settings (new · 2 d · M1 weeks 4–6)

**Layout (§5.2, §19.3)**
- [ ] Header: language, file name, "Safety checks: on/off" (C++), Settings, Share (slot for FE-12), Open in new tab, Close (`Esc`)
- [ ] Left: code pane (FE-03) + controls; right: state pane (FE-06 / FE-08 / FE-11 slots)
- [ ] Bottom row: STDIN (read-only) and STDOUT/STDERR **up to the current step**, stderr in red, current step's text highlighted
- [ ] Status bar: exit status, step count, banner slot (FE-05)
- [ ] Draggable divider, width saved in `localStorage`

**Settings (§5.7, §19.3 display options)**
- [ ] Max steps, autoplay speed, draw arrows, highlight changes, show unreachable objects, matrix view, show memory addresses, show compiler internals, safety checks (C++)
- [ ] Display: density (Compact / Comfortable), font size S/M/L, theme light/dark/system
- [ ] Hide settings the language can't support, from manifest `capabilities` (FR-24)
- [ ] Persist in `localStorage` (anonymous); profile storage hook for signed-in users
- [ ] "Max steps" and "safety checks" apply on the next run (say so in the UI)

- [ ] **Done:** the §5.3 layout renders around the fixture views; settings survive a reload

## 5. Autoplay (M3-F06 · 1.5 d)

- [ ] Play/pause button and `Space`
- [ ] Speeds 0.5×, 1×, 2×, 4× (1× = 2 steps/s)
- [ ] Stops at error steps and at breakpoints (FE-03 gutter)
- [ ] Stops at the last step; any manual navigation pauses
- [ ] Respects `prefers-reduced-motion` for highlight fades only (stepping still works)
- [ ] **Done:** §5.9 rules pass as unit tests

## 6. Performance (M3-F12 · 2 d)

- [ ] Profile on the 5,000-step fixture with 500 heap objects
- [ ] Memory under 300 MB (heap snapshot in CI perf job)
- [ ] Virtualize long heap columns / containers (TanStack Virtual)
- [ ] No layout shift between steps (§19.10)
- [ ] Perf budget test in CI: fail if stepping on the 1,000-step fixture goes over 16 ms
- [ ] **Done:** §13 step-navigation target met on 5,000 steps

## Done when

Stepping takes ≤ 16 ms on 1,000 steps and works on 5,000 steps with memory under 300 MB, inside the full §5.2 shell.
