# FE-04 · Visualize from the IDE

| | |
|---|---|
| **Milestone** | M1 (week 4) |
| **Estimate** | 3.5 days |
| **Depends on** | BE-01 §5 (OpenAPI, Tue 17 Nov), FE-01 §5 (MSW, config); BE-06 + BE-13 §1 for the real API |
| **Blocks** | FE-05 (states), FE-12 (permalink loading) |
| **Covers** | M1-13, M1-14 |
| **Spec** | §5.1, §8.1–§8.5, §8.7 |

🔁 Uses MSW until `openapi.yaml` lands Tue 17 Nov and the local stack Wed 18 Nov.

## 1. IDE entry point (M1-13 · 2 d)

- [ ] CodeMirror 6 editor (editable) with the language picker
- [ ] Language list from `GET /languages` (cached 5 min client-side)
- [ ] **Visualize** button shown only when `visualize.enabled = true` for the selected language
- [ ] Shortcut `Ctrl/Cmd + Shift + Enter`
- [ ] Sends the current code + stdin + settings (`maxSteps`, `showInternals`, breakpoints → `startAtLines` when asked) and `context` (entry point)
- [ ] Opens the visualizer at once in its Loading state
- [ ] Does **not** touch the Run output panel
- [ ] Client-side size checks (source 64 KB, stdin limit) before sending, matching `413`
- [ ] **Done:** matches the §5.1 mock

## 2. API client & long-poll (M1-14 · 1.5 d)

- [ ] `openapi-fetch` client from generated types; TanStack Query wrappers
- [ ] `POST /visualizations` with an `Idempotency-Key` (UUID per click; reused on network retry)
- [ ] Long-poll loop: `GET /visualizations/{id}?wait=20&since=<version>` until status is final (`completed`, `failed`, `canceled`)
- [ ] Retry with backoff on network errors / `503`, honouring `Retry-After`; resume with the last `version`
- [ ] Map the error envelope (§8.7) → typed errors (`rate_limited`, `capacity`, `payload_too_large`, `unsupported_language`, `not_found`, `expired`, `internal_error`) for FE-05
- [ ] Cancel: `DELETE /visualizations/{id}` and stop polling; also on Close / new Visualize
- [ ] Hand the completed response to the player loader (FE-02 §1)
- [ ] Unit tests with MSW: normal, slow, API restart mid-poll, 429, 503, cancel
- [ ] **Done:** survives an API restart mid-poll

## Done when

Clicking Visualize on Python code opens the player; a mid-run API restart doesn't break it.
