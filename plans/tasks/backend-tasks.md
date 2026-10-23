# Backend Tasks (BE)

14 feature-level tasks. Each one is a piece of functionality you can demo when it's done. The old fine-grained IDs from `workplan-backend.md` are listed under **Covers**, so you can still trace each task back to the plan. § = section in `code-visualizer-spec_2.md`.

| # | Task | Milestone | Est (days) |
|---|---|---|---|
| BE-01 | Foundation & contracts | M0–M1 | 6 |
| BE-02 | Sandbox | M0–M1 | 8 |
| BE-03 | Python tracer | M0–M1 | 7 |
| BE-04 | Trace processing | M0–M1 | 6.5 |
| BE-05 | Job queue & worker | M1 | 4.5 |
| BE-06 | Visualization API | M1 | 7 |
| BE-07 | C++ build & compile errors | M2 | 6.5 |
| BE-08 | C++ tracer | M2 | 10 |
| BE-09 | C++ STL & big arrays | M2 | 10.5 |
| BE-10 | Friendly errors | M3 | 3 |
| BE-11 | Whole-run data & trace options | M3 | 6.5 |
| BE-12 | Share & permalinks | M3 | 1.5 |
| BE-13 | Environments & launch readiness | M1–M5 | 17 |
| BE-14 | C language support | M4–M5 | 8 |

---

## M0–M1 · Python end to end

- [ ] **BE-01 · Foundation & contracts**
  Go repo and CI, plus the three contracts every other task builds on: the trace schema, the tracer wire schema, and the OpenAPI spec for the public API. 🔁 FE needs the trace schema by **Wed 28 Oct** and OpenAPI by **Tue 17 Nov**.
  *Done when:* FE can generate types from the schemas and API; CI fails if they drift. · *Covers:* M0-01, M0-03, M0-05, M0-06, M1-01 · §8, §9, §10.1

- [ ] **BE-02 · Sandbox** ⚠
  Run untrusted user code safely with CPU, memory, time and output limits, and no network. Start with the spike that picks gVisor or nsjail (gate **G1**, Fri 6 Nov).
  *Done when:* fork bombs, network access and filesystem escapes are blocked, and the attack tests run in CI. · *Covers:* M0-09, M0-10, M1-07, M3-B08 · §11, §12

- [ ] **BE-03 · Python tracer**
  Record a Python program step by step: user frames only, variables, stdout, stdin position, return values, call IDs, line counts, blocked modules (numpy etc.), and keep running after the step limit. Includes the Python runner image and the `vizctl trace` CLI.
  *Done when:* every Python fixture can be reproduced from real code. · *Covers:* M0-11, M1-05, M1-06 · §7.11.1, §19.9

- [ ] **BE-04 · Trace processing**
  Turn raw tracer output into the stored trace: validate it, give objects stable IDs, store keyframes plus deltas, split it into chunks, and apply limits and truncation. Includes sparse arrays for C++. Freezes the trace format (gate **G3**).
  *Done when:* golden tests pass, and a 1,000-step trace over a 200k-element array is ≤ 2 MB gzipped. · *Covers:* M0-12, M1-04, M2-B08 · §9

- [ ] **BE-05 · Job queue & worker**
  A MySQL-backed job queue, and workers that build and trace code: leases, retries (infrastructure errors only), cancel, 30 s deadline, graceful shutdown.
  *Done when:* no job is lost or run twice when workers are killed at random. · *Covers:* M1-08 · §7.7, §7.8, §7.13.2

- [ ] **BE-06 · Visualization API**
  Create, get and delete a visualization. Covers quotas, idempotency, single-flight (identical requests share one run), long-poll status updates, the database tables, trace storage with 7-day and 90-day expiry, and signed download URLs.
  *Done when:* contract tests pass for every §8 example, and a status change reaches the browser in ≤ 400 ms. · *Covers:* M0-14, M1-03, M1-09, M1-10 · §7.5, §7.12, §8

## M2 · C++

- [ ] **BE-07 · C++ build & compile errors**
  Compile user C++ quickly (precompiled headers) with output always flushed, safety checks on by default, coverage and warnings. Turn compiler errors and warnings into structured diagnostics with line numbers. Includes the safety-check overhead spike (S7, gate **G5**). 🔁 FE needs diagnostics for the error panel.
  *Done when:* a build takes ≤ 3 s, and the failed-build example in §8.3 is reproduced. · *Covers:* M2-B01, M2-B02, M2-B10 · §7.11.2, §19.6

- [ ] **BE-08 · C++ tracer** ⚠
  Step through C++ with GDB: frames (outermost first), a separate globals frame, variables hidden until declared, compiler internals hidden, pointers followed to their objects, return values, and crashes (segfault etc.) recorded as error steps. 🔁 FE needs pointer values for arrows.
  *Done when:* the loop, recursion, pointer, fib and segfault programs all trace correctly. · *Covers:* M2-B03, M2-B04, M2-B05 · §7.11.2, §9.4

- [ ] **BE-09 · C++ STL & big arrays**
  Show STL containers (vector, map, set, pair, stack, queue, priority_queue, bitset, string) as normal values. Record big CP arrays efficiently by storing only the changed cells. Includes the C++ conformance tests and the array-cost spike (S6). 🔁 FE needs sparse arrays for the big-array view.
  *Done when:* each STL type has a test, and a 200k-array DFS stays within the size and time targets. · *Covers:* M2-B06, M2-B07, M2-B09, M2-B11 · §10.3, §19.9.1

## M3 · Student features & launch

- [ ] **BE-10 · Friendly errors**
  When a program fails (out of bounds, overflow, exception), send the error kind, the values involved and a message key, so the UI can show a plain-English message and a hint.
  *Done when:* the §19.6 error table works for both C++ and Python. · *Covers:* M3-B01 · §19.6

- [ ] **BE-11 · Whole-run data & trace options**
  Line hit counts for the whole run; keep running C++ untraced after the step limit so output is complete; "start tracing from line N"; and "show range" for arrays larger than the recorded window. (If the frontend source-parsing spike S8 misses its accuracy target, also send exact read/write hints, +3 days.)
  *Done when:* a 2,000-iteration loop gives complete output, and binary-search hit counts match the §19.3 mock. · *Covers:* M3-B02–B05, (M5-B01) · §5.6, §19.9

- [ ] **BE-12 · Share & permalinks**
  Share a visualization: keep it for 90 days, create a permalink, and allow revoking it.
  *Done when:* a shared link opens for another user and stops working after it's revoked. · *Covers:* M3-B06 · §8.6

- [ ] **BE-13 · Environments & launch readiness**
  Local dev stack (one command), staging and production on Kubernetes with autoscaling, logs, metrics and tracing, alerts and runbooks, a load test at 2× expected peak, and post-launch tuning.
  *Done when:* staging autoscales, §13 latency targets pass under load, and on-call has runbooks. · *Covers:* M1-02, M1-11, M1-12, M3-B07, M3-B09, M3-B10, M5-B02, M5-B03 · §7.8, §13, §18.4

## M4–M5 · Extensibility

- [ ] **BE-14 · C language support**
  Add C by reusing the C++ adapter, to prove a new language needs no UI changes. Released behind a feature flag.
  *Done when:* the conformance suite passes for C. · *Covers:* M4-B01, M4-B02 · §10.4

---

**Every task:** tests (golden traces when trace output changes), schemas and generated types updated in the same PR, and a feature flag until M3.
