# Backend Tasks (BE)

14 feature-level tasks, one file each in [`backend/`](backend/). Every file has a header (milestone, estimate, dependencies, covered work-plan IDs, spec §), a checklist grouped by sub-part, and a **Done when** line. § = section in `../code-visualizer-spec_2.md`.

| # | Task | Milestone | Est (d) | Depends on |
|---|---|---|---|---|
| [BE-01](backend/BE-01-foundation-contracts.md) | Foundation, contracts & dev workflow | M0–M1 | 7 | — |
| [BE-02](backend/BE-02-sandbox.md) ⚠ | Sandbox (incl. Docker dev adapter) | M0–M1, M3 | 7.5 | BE-01, BE-08 §1 |
| [BE-03](backend/BE-03-python-tracer.md) | Python tracer | M0–M1 | 7 | BE-01, BE-02 §2, BE-04 |
| [BE-04](backend/BE-04-trace-processing.md) | Trace processing (`tracecore`) | M0–M1, M2 | 6.5 | BE-01 |
| [BE-05](backend/BE-05-job-queue-worker.md) | Job queue & worker | M1 | 4.5 | BE-02, BE-04, BE-06 §2 |
| [BE-06](backend/BE-06-visualization-api.md) | Visualization API | M0–M1 | 7.5 | BE-01, BE-13 §1 |
| [BE-07](backend/BE-07-cpp-build.md) | C++ build & compile errors | M2 | 6.5 | BE-02, BE-05 |
| [BE-08](backend/BE-08-cpp-tracer.md) ⚠ | C++ tracer | M0, M2 | 12 | BE-01, BE-07 |
| [BE-09](backend/BE-09-cpp-stl-big-arrays.md) | C++ STL & big arrays | M2 | 10.5 | BE-08 |
| [BE-10](backend/BE-10-friendly-errors.md) | Friendly errors | M3 | 3 | BE-03, BE-07, BE-08 |
| [BE-11](backend/BE-11-whole-run-trace-options.md) | Whole-run data & trace options | M3 (M5) | 6.5 (+3) | BE-03, BE-07–09 |
| [BE-12](backend/BE-12-share-permalinks.md) | Share & permalinks | M3 | 1.5 | BE-06 |
| [BE-13](backend/BE-13-environments-launch.md) | Environments & launch readiness | M1–M5 | 19.5 | BE-01 §6, BE-02, BE-05, BE-06 |
| [BE-14](backend/BE-14-c-language.md) | C language support | M4 | 5 | BE-07–09 |
| | **Total** | | **104.5** (+3) | |

Estimates are the sum of each file's sub-items. The M0 GDB prototype (M0-09) is counted under BE-08, not BE-02.

## Suggested order

1. **M0:** BE-01 → BE-08 §1 (GDB prototype) → BE-02 §1 (G1) → BE-03 §1 (G2) + BE-04 §1 (G3) → BE-06 §1 (stretch)
2. **M1:** BE-01 §5 (OpenAPI) → BE-02 §2 (Docker dev sandbox) → BE-01 §6 (images, `make dev`) → BE-13 §1 → BE-06 §2 → BE-04 §2 → BE-03 §2–3 → BE-02 §3 → BE-05 → BE-06 §3–4 → BE-13 §2–3
3. **M2:** BE-07 → BE-08 §2–5 → BE-09 → BE-04 §3
4. **M3:** BE-10, BE-11, BE-12, BE-02 §5, BE-13 §4–6
5. **M4–M5:** BE-14, BE-13 §7

## Every task

- Tests, plus golden traces when trace output changes (addresses and timings masked).
- Schemas, OpenAPI and generated types updated in the same PR; CI drift check passes.
- New limits and failure paths added to spec §11 and §7.8.
- Metrics or logs for anything that can fail in production.
- Behind a feature flag until M3.
