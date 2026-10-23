# Task Tracking — Code Visualizer

Work lists split by role, for tracking (not implementation detail). Source docs: `../code-visualizer-spec_2.md` (spec v1.2), `../code-visualizer-workplan.md`, `../workplan-backend.md`, `../workplan-frontend.md`.

| File | Covers | Tasks |
|---|---|---|
| [backend-tasks.md](backend-tasks.md) | Go services, tracers, sandbox, MySQL queue, storage, infra, contracts | 14 (BE-01…BE-14), one file each in [backend/](backend/) |
| [frontend-tasks.md](frontend-tasks.md) | IDE integration, `@viz/player`, views, narration, navigation, tests, a11y | 14 (FE-01…FE-14), one file each in [frontend/](frontend/) |
| This file | Milestones, gates, cross-team handoffs, Lead/Design tasks | — |

Each BE/FE task lists the fine-grained work-plan IDs it covers (`M0-05`, `M2-B04`…). The handoff and gate tables below still use those IDs.

## Milestones

| Milestone | Dates | Goal | BE load | FE load |
|---|---|---|---|---|
| **M0** Foundations & spikes | 26 Oct – 13 Nov 2026 | Contracts, spikes S1–S5, player scrubs a 1,000-step fixture | 13 d | 13.5 d |
| **M1** Python beta | 16 Nov – 25 Dec 2026 | Python works end to end on staging; internal beta | 27.5 d | 27 d |
| **M2** C++ | 28 Dec 2026 – 19 Feb 2027 | C++ with STL, pointers, globals, compile errors | 29 d | 15.5 d (+ M5 work) |
| **M3** Launch + student UX | 22 Feb – 26 Mar 2027 | All P0 items; load + security tests; **public launch** | 20.5 d | 21.5 d |
| **M4** Extensibility | 29 Mar – 9 Apr 2027 | Add C with no UI changes | 5 d | 1 d |
| **M5** CP data views | 12 Apr – 7 May 2027 | All P1 views; usability test passes | 8 d | 22 d |

⚠ Backend is the bottleneck in M1–M2. Decide **option A** (keep 1 BE, launch ~26 Mar) or **option B** (add a 2nd BE from 16 Nov, launch ~19 Feb) **before 16 Nov**.

## Decision gates

- [ ] **G1 · Fri 6 Nov** — Sandbox: gVisor or nsjail (input: M0-10)
- [ ] **G2 · Fri 13 Nov** — Python hook: `settrace` or `sys.monitoring` (input: M0-11)
- [ ] **G3 · Fri 13 Nov** — Freeze trace format (input: M0-12, fixtures)
- [ ] **G4 · Fri 25 Dec** — Python beta go/no-go; team size for M2–M3
- [ ] **G5 · Fri 19 Feb** — Safety checks default, tree-sitter, big-array tracking (input: M2-B09, M2-B10, M1-F01)

Record every gate result in the spec change log (§0.3).

## Cross-team handoffs (BE → FE)

| BE delivers | Task | Due | FE fallback until then |
|---|---|---|---|
| Trace schema | M0-05 | Wed 28 Oct | Draft types from §9 |
| Real C++ traces (S1) | M0-09/10 | Fri 6 Nov | Hand-written fixtures |
| Format frozen | G3 | Fri 13 Nov | — |
| OpenAPI | M1-01 | Tue 17 Nov | MSW mocks |
| Local stack | M1-02 | Wed 18 Nov | MSW |
| Real Python traces | M1-05/06 | Fri 4 Dec | Fixtures |
| Staging | M1-12 | Mon 28 Dec | Local stack |
| C++ pointer values | M2-B04 | M2 week 3 | Fixtures with `ptr` |
| Sparse arrays | M2-B08 | End of M2 | Sparse fixtures |
| Friendly errors, line hits, untraced tail | M3-B01–B03 | M3 week 2 | Fixtures |

## Lead & Design tasks (not in the BE/FE lists)

- [ ] **M0-04 · Lead** — Import tasks into the tracker; set Friday demos and gate meetings. *0.5 d*
- [ ] **Lead** — Confirm MySQL version and hosting (8.4 LTS wanted; must have `SKIP LOCKED`). *Week 1*
- [ ] **Lead** — Decide option A vs B (team size). *Before 16 Nov*
- [ ] **Lead + BE** — One deploy path for the M1 beta: Kubernetes staging (recommended) vs the VMs option in spec §18.4; log it in §0.3. *Before M1 week 9* (BE-13 §3)
- [ ] **M0-20 · DS** — Hi-fi designs: tokens (light/dark), layout v1.1, all §5.6 states, array markers, matrix. Tokens by 30 Oct, M1 handoff by 13 Nov. *8 d*
- [ ] **M0-21 · DS** — Usability test plan; recruit 8 CP students for M5. *2 d*
- [ ] **M0-22 · Lead** — Run G1–G3 and log results in spec §0.3. *1 d*
- [ ] **M1-21 · DS** — Designs for student views: big array, index markers, matrix, expected output, friendly errors, Go to… (matrix, Go to…, compare by **Fri 4 Dec**). *6 d*
- [ ] **M1-22 · DS** — Design QA of the M1 build. *2 d*
- [ ] **M1-23 · Lead** — Internal beta with 10–20 students/teachers; collect feedback before G4. *1 d*
- [ ] **M3 · DS + Lead** — Accessibility pass, design QA, launch checklist.
- [ ] **M5 · DS + Lead** — Usability test with 8 CP students; triage top issues.
