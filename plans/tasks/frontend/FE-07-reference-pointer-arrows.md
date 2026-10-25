# FE-07 · Reference & pointer arrows

| | |
|---|---|
| **Milestone** | M0 (week 2, spike S3) → M1 (week 5) → M2 (pointers) |
| **Estimate** | 6 days |
| **Depends on** | FE-01 §1, FE-06 §2 (cards); BE-08 §3 (`ptr` values, M2 week 3) |
| **Blocks** | — |
| **Covers** | M0-13, M1-17, M2-F01 |
| **Spec** | §5.3, §5.4, §5.8, §5.9, §9.4, §18.1, §18.7 S3 |

## 1. Spike S3 — SVG arrow overlay (M0-13 · 2 d · M0 week 2)

- [x] Synthetic page: 500 object cards, 30 arrows, fixed stack/heap columns: `synthetic-5000` in the real player, up to 30 arrows on screen
- [x] Overlay: one absolutely positioned SVG; positions from `ResizeObserver` + `getBoundingClientRect` (`arrow-overlay.tsx`)
- [x] Cubic Bézier from the right edge of `●` to the left edge of the card (`route` in `arrows.ts`)
- [x] Measure per-step re-layout time (Chrome perf profile, mid-range laptop CPU throttle): keydown to DOM over the DevTools protocol, 4× throttle, `plans/spikes/s3/run.mjs`
- [x] Short write-up with numbers; if > 16 ms, propose fallback (labels-only above N): [S3 report](../../spikes/s3-arrow-overlay.md)
- [x] **Done:** ≤ 16 ms per step, or a documented fallback: 4.6 ms p50 unthrottled; at 4× the pane is over 16 ms without arrows too, fallback in the report

## 2. Arrow overlay in the real UI (M1-17 · 2 d · M1 week 5)

- [x] Arrows from frame `●` and from card fields to target cards
- [x] Bundle arrows to the same card
- [x] Hover a card → highlight its incoming arrows and every `●` pointing to it (and the reverse)
- [x] More than 30 visible arrows → labels only, arrows on hover
- [x] Recompute on step change, scroll, resize, divider drag (batched per frame)
- [x] "Draw reference arrows" setting off → labels only
- [x] Narrow screens: no arrows; tapping `●──▶ #id` scrolls to the card (§5.8, with FE-13): under 768 px; the tabbed layout itself is FE-13's
- [ ] **Done:** meets the S3 numbers in the real UI: measured in the real UI, 16 ms holds unthrottled (8.1 ms p95) but not at 4× (16.6–17.2 ms p50), where the pane is 15.2 ms p50 without arrows; needs the pane faster first

## 3. Pointer arrows for C++ (M2-F01 · 2 d)

- [x] `ptr` values followed to their card (heap or global)
- [x] `∅` for `nullptr`
- [x] Raw address on hover/focus of `●`, and on tap
- [x] "Show memory addresses" setting: address inline
- [x] Dangling / unknown targets shown as an address label, not an arrow
- [x] Linked-list fixture (`Node* head` → #4 → #5): `cpp-pointers` step 6
- [x] **Done:** matches the §5.4 mock: checked in Chrome, light and dark, compact/M and comfortable/L

## Done when

500 objects and 30 arrows render in ≤ 16 ms per step, and the §5.4 pointer mock is matched.
