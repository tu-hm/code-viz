# Frontend Tasks (FE)

14 feature-level tasks, one file each in [`frontend/`](frontend/). Every file has a header (milestone, estimate, dependencies, covered work-plan IDs, spec §), a checklist grouped by sub-part, and a **Done when** line. § = section in `../code-visualizer-spec_2.md`.

**Fixtures first:** build every view on fixture traces in Storybook before real backend data exists.

| # | Task | Milestone | Est (d) | Depends on |
|---|---|---|---|---|
| [FE-01](frontend/FE-01-foundation-fixtures.md) | Foundation, fixtures & dev workflow | M0–M2 | 6 | BE-01 §3, §5; BE-13 §1, §3 |
| [FE-02](frontend/FE-02-trace-player-controls.md) | Trace player, shell & step controls | M0–M1, M3 | 11 | FE-01 |
| [FE-03](frontend/FE-03-code-pane.md) | Code pane | M0, M3 | 3 | FE-01; BE-11 §1 |
| [FE-04](frontend/FE-04-visualize-from-ide.md) | Visualize from the IDE | M1 | 3.5 | BE-01 §5, FE-01 §6; BE-06 |
| [FE-05](frontend/FE-05-run-states-errors.md) | Run states & error screens | M1–M3 | 7 | FE-04; BE-07 §2, BE-10, BE-11 |
| [FE-06](frontend/FE-06-stack-heap-view.md) | Stack & heap view | M0–M2, M4 | 8 | FE-02 §2; BE-09 §1 |
| [FE-07](frontend/FE-07-reference-pointer-arrows.md) | Reference & pointer arrows | M0–M2 | 6 | FE-06 §2; BE-08 §3 |
| [FE-08](frontend/FE-08-array-matrix-views.md) | Array & matrix views | M1–M2 | 14.5 | FE-03, FE-06; BE-09 §2 |
| [FE-09](frontend/FE-09-narration-input-cursor.md) | Narration & input cursor | M1, M3 | 5.5 | FE-02 §2, FE-08 §3 |
| [FE-10](frontend/FE-10-goto-expected-output.md) | Go to… & expected-output compare | M1 | 4 | FE-02 §2, FE-03 |
| [FE-11](frontend/FE-11-watch-timeline.md) | Watch panel & timeline | M3, M5 | 5 | FE-08 §3, FE-10 §1 |
| [FE-12](frontend/FE-12-share-permalinks.md) | Share & permalinks | M3 | 1.5 | BE-12, FE-02 §3 |
| [FE-13](frontend/FE-13-mobile-a11y-analytics.md) | Mobile, accessibility & analytics | M3 | 6.5 | FE-02 §4, FE-06, FE-07 |
| [FE-14](frontend/FE-14-cp-data-views.md) | CP data views | M5 | 19 | FE-06, FE-08, FE-10 |
| | **Total** | | **100.5** | |

Estimates are the sum of each file's sub-items. New since the work plan (+3 d): FE-01 §6 dev workflow & app plumbing (1 d) and FE-02 §4 visualizer shell & settings (2 d) — the §5.2 layout, I/O panes, status bar and §5.7 settings had no owner. To keep M1 at 27 d, M2-F02 and M2-F03 (FE-06 §3–4, 3 d) move back from M1 week 9 to M2.

## Suggested order

1. **M0:** FE-01 §1 → FE-03 §1 → FE-01 §2 (after schema Wed 28 Oct) → FE-01 §3 → FE-07 §1 (S3) → FE-02 §1 → FE-02 §2 → FE-02 §3 → FE-06 §1 → M0 demo
2. **M1:** FE-04 §1 + FE-01 §6 (MSW until OpenAPI Tue 17 Nov) → FE-04 §2 → FE-06 §2 → FE-07 §2 → FE-02 §4 → FE-05 §1 → FE-09 §1 → FE-01 §4 → FE-08 §1 (S8) → FE-08 §2 → FE-10 §1–2 → FE-08 §3
3. **M2:** FE-01 §5 (staging) → FE-06 §3–4 → FE-05 §2 → FE-07 §3 → FE-08 §4–6; option A slack → FE-14 §1, §4, §5, FE-11 §2
4. **M3:** FE-03 §2, FE-05 §3–4, FE-02 §5–6, FE-09 §2–3, FE-11 §1, FE-12, FE-13
5. **M4–M5:** FE-06 §5, FE-14

## Every task

- Fixture plus Storybook story for every view and state; visual baseline updated on purpose only.
- Unit tests for logic (engine, searches, narration rules, formatters).
- Usable by keyboard alone; nothing shown by colour only (§19.10).
- Stepping stays ≤ 16 ms on the 1,000-step fixture.
- All UI strings in i18n files.
- Behind a feature flag until M3.
