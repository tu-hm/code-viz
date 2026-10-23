# FE-13 · Mobile, accessibility & analytics

| | |
|---|---|
| **Milestone** | M3 |
| **Estimate** | 6.5 days |
| **Depends on** | FE-02 §4 (shell), FE-06, FE-07 §2; DS accessibility pass (M3) |
| **Blocks** | Launch |
| **Covers** | M3-F09, M3-F10, M3-F11, M3-F13 |
| **Spec** | §5.8, §5.10, §13, §14, §19.10, §19.11 |

## 1. Narrow layout (M3-F09 · 2 d)

- [ ] Under 768 px: tabs **Code**, **State**, **Output**; controls pinned at the bottom of every tab
- [ ] No arrows; `●──▶ #id` tap scrolls to the card
- [ ] Touch: swipe-free; buttons ≥ 44 px
- [ ] Data views (matrix, big array) scroll horizontally inside their card
- [ ] Test on iOS Safari 17+ and Android Chrome (Playwright device profiles)
- [ ] **Done:** matches the §5.8 mock

## 2. Accessibility (M3-F10 · 2 d)

- [ ] Every control reachable by keyboard; visible focus everywhere
- [ ] `aria-live="polite"` step announcement: "Step 9 of 19, call square, line 2" (+ narration)
- [ ] Colour never the only cue (`▶ ▷ ! * · [x] (x)` marks present) (§19.10)
- [ ] WCAG 2.2 AA contrast in light and dark; Okabe–Ito palette checked with deuteranopia/protanopia simulation
- [ ] `prefers-reduced-motion` turns off fades
- [ ] Radix dialogs/menus: focus trap and restore
- [ ] Keyboard-only Playwright test of the main flow
- [ ] **Done:** axe-core clean on every story; §5.10 checklist passes

## 3. Analytics (M3-F11 · 1 d)

- [ ] Analytics client behind an interface (tool picked by Lead); no PII, no source code
- [ ] `viz_open` (language, entry point, stdin present)
- [ ] `viz_ready` (stepCount, truncated, truncation reason, exit kind, queue/build/trace ms, sizeBytes)
- [ ] `viz_failed` (language, failure kind)
- [ ] `viz_nav` (action, sampled 10%)
- [ ] `viz_feature` (`show_range`, `start_at_line`, `matrix_view`, `settings_change`)
- [ ] `viz_goto` (jump type) for §19.11; `viz_share`
- [ ] **Done:** events visible in the analytics tool from staging

## 4. Launch fixes buffer (M3-F13 · 1.5 d)

- [ ] Triage DS design QA and beta feedback; fix top issues
- [ ] Remove feature flags that ship at launch

## Done when

axe-core is clean, the §5.8 mock works on mobile, and events show up in the analytics tool.
