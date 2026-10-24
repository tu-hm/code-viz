# FE-04 · Visualize from the IDE

| | |
|---|---|
| **Milestone** | M1 (week 4) |
| **Estimate** | 3.5 days |
| **Depends on** | BE-01 §5 (OpenAPI, Tue 17 Nov), FE-01 §5 (MSW, config); BE-06 + BE-13 §1 for the real API |
| **Blocks** | FE-05 (states), FE-12 (permalink loading) |
| **Covers** | M1-13, M1-14 |
| **Spec** | §5.1, §8.1–§8.5, §8.7 |

🔁 Uses MSW until `openapi.yaml` lands Tue 17 Nov and the local stack Wed 18 Nov. Both landed early: built against the real API under `make dev` (24 Oct), with MSW for the unit tests.

## 1. IDE entry point (M1-13 · 2 d)

- [x] CodeMirror 6 editor (editable) with the language picker — `editor.tsx`, highlighting shared with the code pane; one draft per language, starting from a sample program
- [x] Language list from `GET /languages` (cached 5 min client-side) — `staleTime` 5 min
- [x] **Visualize** button shown only when `visualize.enabled = true` for the selected language — and behind the `visualize` flag (FE-01 §5)
- [x] Shortcut `Ctrl/Cmd + Shift + Enter` — anywhere in the IDE, the editor included
- [x] Sends the current code + stdin + settings (`maxSteps`, `showInternals`, breakpoints → `startAtLines` when asked) and `context` (entry point) — `startAtLines` is `[]` until FE-05 §4's dialog asks; `safetyChecks` isn't sent, since `GET /languages` doesn't say which languages have them
- [x] Opens the visualizer at once in its Loading state — a plain status line and Cancel; FE-05 §1 draws the stepper
- [x] Does **not** touch the Run output panel — the IDE has no Run (the host IDE owns it), so the panel only says where results go
- [x] Client-side size checks (source 64 KB, stdin limit) before sending, matching `413` — the same `ApiError` as the server's, UTF-8 bytes
- [x] **Done:** matches the §5.1 mock — checked in headless Chrome against `make dev`, Python and C++; no Save or Settings, which are the host IDE's

## 2. API client & long-poll (M1-14 · 1.5 d)

- [x] `openapi-fetch` client from generated types; TanStack Query wrappers — `api.ts`, `visualize.ts`
- [x] `POST /visualizations` with an `Idempotency-Key` (UUID per click; reused on network retry)
- [x] Long-poll loop: `GET /visualizations/{id}?wait=20&since=<version>` until status is final (`completed`, `failed`, `canceled`)
- [x] Retry with backoff on network errors / `503`, honouring `Retry-After`; resume with the last `version` — the poll also retries `502` and `504`, a proxy's answer while the API restarts; a POST retries network errors only, so `429` and `503` reach FE-05's screens
- [x] Map the error envelope (§8.7) → typed errors (`rate_limited`, `capacity`, `payload_too_large`, `unsupported_language`, `not_found`, `expired`, `internal_error`) for FE-05 — `ApiError` with `code`, `status`, `retryAfterSec` and `requestId`; `code` is `null` for a body that isn't the envelope
- [x] Cancel: `DELETE /visualizations/{id}` and stop polling; also on Close / new Visualize — only while the status isn't final, also when Cancel comes before the create answers
- [x] Hand the completed response to the player loader (FE-02 §1) — `{ manifest, refresh }`, `refresh` signing fresh chunk URLs
- [x] Unit tests with MSW: normal, slow, API restart mid-poll, 429, 503, cancel — `ide.test.tsx`
- [x] **Done:** survives an API restart mid-poll — also against `make dev`: `vizd` killed mid-poll, back 6 s later; the poll retried and followed the requeued job to `completed`

## Done when

Clicking Visualize on Python code opens the player; a mid-run API restart doesn't break it.
