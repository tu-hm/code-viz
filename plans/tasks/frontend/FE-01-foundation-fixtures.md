# FE-01 · Foundation, fixtures & dev workflow

| | |
|---|---|
| **Milestone** | M0 (weeks 1–2) → M1 (weeks 4, 6) → M2 (week 1) |
| **Estimate** | 6 days |
| **Depends on** | BE-01 §3 (trace schema, Wed 28 Oct), BE-01 §5 (OpenAPI, Tue 17 Nov), BE-13 §1 (local stack), BE-13 §3 (staging, Mon 28 Dec) |
| **Blocks** | Every other FE task |
| **Covers** | M0-02, M0-07, M0-08, M1-19, M1-20, + new: dev workflow & app plumbing |
| **Spec** | §9, §13 (i18n), §15, §18.1, D14 |

The web workspace, generated types, fixture traces, and the test harness every view is built on.

🔁 **Needs from BE:** `trace.v1.schema.json` by **Wed 28 Oct** (fallback: draft types from §9) · `openapi.yaml` by **Tue 17 Nov** (fallback: MSW mocks from §8 examples).

## 1. Web workspace (M0-02 · 0.5 d · week 1)

- [x] pnpm workspace with `apps/ide` and `packages/player` (`@viz/player`, no IDE dependency) — in `web/`, plus `packages/ui` (design system) and `fixtures`
- [x] Vite 8 + `@vitejs/plugin-react` v6, React 19.3 + React Compiler 1.0 — the compiler runs through `@rolldown/plugin-babel`; the plugin's Rust compiler is still experimental
- [x] Strict TypeScript (`strict`, `noUncheckedIndexedAccess`), shared `tsconfig` base — TypeScript 6.0: typescript-eslint and openapi-typescript don't support 7 yet
- [x] Tailwind v4 + Radix UI / shadcn/ui primitives; design tokens as CSS variables (light/dark), placeholders until DS tokens land (Fri 30 Oct) — `@viz/ui`: three-layer tokens with a contrast test, shadcn-compatible theme, `Button`; guide in `docs/guides/design-system.md`
- [x] Zustand store skeleton (current step, settings, panel sizes) — `usePlayer` in `@viz/player`
- [x] Vitest + Testing Library; ESLint + Prettier
- [x] Fill the web checks job in CI (BE-01 §2): lint, typecheck, test, build — `web` job runs `pnpm check`, which also checks codegen drift
- [ ] **Done:** `pnpm test` and `pnpm build` pass in CI — both pass locally; CI runs them on the first push

## 2. Codegen (M0-07 · 1 d · week 1, after the schema on Wed)

- [x] `json-schema-to-typescript` → `packages/player/src/gen/trace.ts` from `schema/trace.v1.schema.json`
- [x] `openapi-typescript` → `apps/ide/src/gen/api.ts` from `api/openapi.yaml` (stub until Tue 17 Nov) — the real contract, already on `main`
- [x] Hook both into `make gen` (shared with BE) — `make gen` runs `pnpm gen`; `make check` checks Go drift only, so the backend job needs no Node
- [x] Generated files committed; CI drift check (`make gen` → `git diff --exit-code`) covers them — `pnpm check:gen` in the `web` job
- [x] Unknown `kind` / `t` typed as a fallback branch, so the UI can render `opaque` / plain text (§9.7) — both unions end in `(string & {})`
- [ ] **Done:** a hand edit to a generated file fails CI

## 3. Fixture traces (M0-08 · 1.5 d · weeks 1–2)

Hand-written until real traces arrive (C++ from S1 on Fri 6 Nov, Python on Fri 4 Dec).

- [x] `fixtures/web/` loader: header + chunk files, same shape as the API (§8.3, §8.4) — `web/fixtures`, `loadFixture(name)`
- [x] Python aliasing (§5.3 mock, 19 steps)
- [x] Binary search (§19.3 mock: 20 steps, stdin `8 13 / 1 3 … 15`, `lineHits`) — with `#include` lines, so line numbers sit 2 below the mock's
- [x] DP grid (§19.4.3 mock, `vector<vector<long long>>` 4 × 5)
- [x] Fib with memo (§19.4.4, `callId` / `parentCallId`)
- [x] Exception (§5.6 Python `IndexError` mock)
- [x] Synthetic 1,000-step trace (keyframes every 50, mixed heap kinds) and a 5,000-step one for FE-02 perf — generated at load time, 500 heap objects in the 5,000-step one
- [x] All fixtures validate against the schema in a unit test — plus chunk layout, line ranges, call ids and heap reachability
- [ ] Later fixtures are added by the task that needs them (C++ STL, `ptr`, sparse 200,005-element array, build error, step limit…)
- [x] **Done:** every fixture passes the schema

## 4. Storybook & visual regression (M1-19 · 1 d · week 6)

- [ ] Storybook (React + Vite) for `@viz/player` and `apps/ide`
- [ ] Fixture decorator: pick a fixture + step from story args
- [ ] Playwright visual snapshots of every story, light and dark
- [ ] axe-core addon on every story
- [ ] Baselines updated only on purpose (separate `pnpm test:visual:update`)
- [ ] **Done:** CI flags an unintended visual change

## 5. End-to-end on staging (M1-20 · 1 d · M2 week 1)

- [ ] Playwright suite: open IDE → Visualize Python fixture code → step to the end → check output
- [ ] Same flow for C++ once BE-07/BE-08 land (skipped until then)
- [ ] Nightly GitHub Actions run against staging; failures post to the team channel
- [ ] Same suite runs against MSW in PR CI (fast mode)
- [ ] **Done:** E2E runs nightly on staging

## 6. Dev workflow & app plumbing (new · 1 d · M1 week 4)

**Config**
- [x] `VITE_API_BASE_URL` (default `http://localhost:8080/api/v1`) and `VITE_USE_MSW=true|false`; `.env.example` in `apps/ide`
- [x] MSW handlers built from the OpenAPI `examples` (§8), with a scenario switch (completed, failed build, busy, slow tracing) — `?scenario=`
- [ ] `pnpm dev` works with MSW only (no backend) and against `make dev` (BE-13 §1) — MSW half done (the default under `pnpm dev`); the `make dev` half waits on the API (BE-06)

**Against the local stack**
- [ ] Load seeded traces from `make seed` (Python + C++) without running jobs
- [ ] Verify CORS for the API and for presigned SeaweedFS chunk URLs (`S3_PUBLIC_ENDPOINT`, BE-06 §3) from the Vite dev origin
- [ ] Note common problems in the web README (CORS origin missing, MSW still on, Docker not running)

**App plumbing**
- [x] i18next + react-i18next with `en.json`; lint rule against hard-coded UI strings (§13, D20)
- [x] Feature-flag client: read flags (env or API), `useFlag()` hook; everything behind a flag until M3 — env only (`VITE_FLAGS`); the API has no flags endpoint
- [x] Error boundary around the player with a "Something went wrong" fallback and the trace ID

- [ ] **Done:** a new developer goes from clone to stepping a seeded trace from the local stack using the README only

## Done when

Every fixture loads in Storybook, visual regression and E2E run (PR + nightly), and FE works against MSW or `make dev` with one env switch.
