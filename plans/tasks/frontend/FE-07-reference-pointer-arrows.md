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

- [ ] Synthetic page: 500 object cards, 30 arrows, fixed stack/heap columns
- [ ] Overlay: one absolutely positioned SVG; positions from `ResizeObserver` + `getBoundingClientRect`
- [ ] Cubic Bézier from the right edge of `●` to the left edge of the card
- [ ] Measure per-step re-layout time (Chrome perf profile, mid-range laptop CPU throttle)
- [ ] Short write-up with numbers; if > 16 ms, propose fallback (labels-only above N)
- [ ] **Done:** ≤ 16 ms per step, or a documented fallback

## 2. Arrow overlay in the real UI (M1-17 · 2 d · M1 week 5)

- [ ] Arrows from frame `●` and from card fields to target cards
- [ ] Bundle arrows to the same card
- [ ] Hover a card → highlight its incoming arrows and every `●` pointing to it (and the reverse)
- [ ] More than 30 visible arrows → labels only, arrows on hover
- [ ] Recompute on step change, scroll, resize, divider drag (batched per frame)
- [ ] "Draw reference arrows" setting off → labels only
- [ ] Narrow screens: no arrows; tapping `●──▶ #id` scrolls to the card (§5.8, with FE-13)
- [ ] **Done:** meets the S3 numbers in the real UI

## 3. Pointer arrows for C++ (M2-F01 · 2 d)

- [ ] `ptr` values followed to their card (heap or global)
- [ ] `∅` for `nullptr`
- [ ] Raw address on hover/focus of `●`
- [ ] "Show memory addresses" setting: address inline
- [ ] Dangling / unknown targets shown as an address label, not an arrow
- [ ] Linked-list fixture (`Node* head` → #4 → #5)
- [ ] **Done:** matches the §5.4 mock

## Done when

500 objects and 30 arrows render in ≤ 16 ms per step, and the §5.4 pointer mock is matched.
