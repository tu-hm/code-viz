# Web

The browser half of the code visualizer: the IDE app, the `@viz/player` package it embeds, the design system, and the trace fixtures every view is built against. Tasks: [plans/tasks/frontend/](../plans/tasks/frontend/). Visual rules: [docs/frontend/design-system.md](../docs/frontend/design-system.md). Rules for the code, tests and dependencies: [AGENTS.md](AGENTS.md).

## Layout

```text
apps/ide/          IDE app: editor, Visualize and the API client; Vite 8, React 19.3 with React Compiler, Tailwind v4
packages/player/   @viz/player: trace types (generated), loader, engine in a Web Worker, the player shell, code pane, controls and state pane
packages/ui/       @viz/ui: design tokens, Tailwind theme, fonts, primitives such as Button
fixtures/          @viz/fixtures: traces in the API's shape (header + chunks), their loader and a synthetic generator
scripts/           setup check, codegen
.claude/skills/    agent skills for this workspace, vendored
```

Packages export their TypeScript source directly. Nothing but `apps/ide` has a build step.

## Getting started

You need Node 24, pnpm 12 and git. The setup script checks each one, and that dependencies are installed, and prints what to run for anything missing:

```bash
cd web
scripts/setup.sh
pnpm install
pnpm dev        # http://localhost:5173 with the API mocked in the browser
```

## Commands

```bash
pnpm dev          # IDE dev server
pnpm test         # Vitest, every package
pnpm lint         # ESLint (a warning fails it), then Prettier --check
pnpm fmt          # Prettier --write, then ESLint --fix
pnpm typecheck    # tsc in every package
pnpm build        # production build of apps/ide; fails if React Compiler can't compile a component
pnpm gen          # TS types from backend/api/openapi.yaml and backend/schema/trace.v1.schema.json
pnpm check        # gen + drift check, lint, typecheck, test, build; CI runs this
```

## Configuration

| Variable            | Default                                  | Meaning                                                                                               |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8080/api/v1`           | API base when the mocks are off                                                                       |
| `VITE_USE_MSW`      | `true` under `pnpm dev`, else `false`    | Answer API calls in the browser with MSW. Dev server only; production builds never include the mocks. |
| `VITE_FLAGS`        | `visualize` under `pnpm dev`, else empty | Comma-separated feature flags. An unknown name stops the app at startup. Read them with `useFlag()`.  |

`pnpm dev` loads `apps/ide/.env.development`. Put your own overrides in `apps/ide/.env.development.local`, which git ignores. [`.env.example`](apps/ide/.env.example) lists every variable.

**Against the local stack:** start the backend with `make dev` in `backend/`, copy `apps/ide/.env.example` to `apps/ide/.env.development.local`, then run `pnpm dev`.

## Mock API

The handlers in [apps/ide/src/mocks](apps/ide/src/mocks/) answer every endpoint from the examples in `backend/api/openapi.yaml`, so they move with the contract. Pick a case with a query parameter:

| `?scenario=`           | What happens                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `completed` (default)  | `POST /visualizations` returns a completed visualization. Its chunks are the `cpp-binary-search` fixture, served at the manifest URLs with the right `sha256` and `sizeBytes`. |
| `slow-tracing`         | `queued`, `building`, then `tracing` with progress and `version` rising on each long-poll, then `completed`.                                                                   |
| `failed-build`         | The create call returns `failed` with a compile error: the contract's §8.3 example.                                                                                            |
| `unsupported-module`   | `failed` with `unsupported_module`: the `import numpy` diagnostic `make dev` gave.                                                                                             |
| `internal-error`       | `failed` with `sandbox_error`.                                                                                                                                                 |
| `canceled`             | The visualization reads `canceled`, as after a third POST.                                                                                                                     |
| `busy`                 | `503 capacity` with `Retry-After: 5`, on every call.                                                                                                                           |
| `rate-limited`         | `429 rate_limited` with `Retry-After: 20`: the contract's example.                                                                                                             |
| `server-error`         | `500 internal_error` on the create.                                                                                                                                            |
| `expired`, `not-found` | The create works; the first long-poll answers `410 expired` or `404 not_found`.                                                                                                |
| `runtime-error`        | Completed with `cpp-check-index`: a friendly index-out-of-range error.                                                                                                         |
| `step-limit`           | Completed with `python-step-limit`, whose untraced tail is served as `trace.tail`.                                                                                             |
| `timeout`              | Completed with `python-timeout`.                                                                                                                                               |
| `output-limit`         | Completed with `python-output-limit`.                                                                                                                                          |
| `build-warnings`       | Completed with two compiler warnings in `build.diagnostics`, as `make dev` gave for a shadowed and an unused variable.                                                         |
| `nothing-traced`       | Completed with no steps: `startAtLines: [3]` on a line that never runs (the backend's `start-never` golden); the output is in the tail.                                        |

## Fixtures

`loadFixture(name)` from `@viz/fixtures` returns `{ header, chunks, source, stdin, tail }`: the trace header, the chunk step arrays as the API serves them, the program's source and stdin, and the output printed after the last step (`tail.txt`, served as `tail.txt.gz`; `''` when there is none). `fixtureNames` lists them all.

| Fixture               | Steps | Spec moment it reproduces                                                                               |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `python-aliasing`     | 19    | §5.3: step 9 is `call square(x=5)`; `a` and `b` share `#o2`                                             |
| `python-exception`    | 9     | §5.6: `IndexError` raised in `f`, unwound through `<module>`                                            |
| `cpp-binary-search`   | 20    | §19.3: step 11 has `l = 4`, `mid = 5`, `r = 7`; 10 of 10 input tokens read; gcov line hits              |
| `cpp-dp-grid`         | 38    | §19.4.3: step 22 writes `dp[2][3] = 10`                                                                 |
| `cpp-fib-memo`        | 32    | §19.4.4: step 26 enters the repeated `fib(3)`: 9 calls, depth 2                                         |
| `python-error-index`  | 10    | §19.6: `grid[r][c]` with `c = 2` on a 2-item row; `index_out_of_range`, `name: grid[r]`                 |
| `python-error-divide` | 4     | §19.6: `total // count` with `count = 0`; `division_by_zero` with `expr` and `divisor`                  |
| `python-error-other`  | 7     | §19.6, anything else: a `ValueError` with no `kind`, shown by its own message                           |
| `python-recursion`    | 26    | §19.6: `RecursionError` at a recursion limit of 25; `recursion_too_deep` with `depth` and `limit`       |
| `python-step-limit`   | 30    | §19.8 (D25): stopped at `maxSteps: 30`, then finished untraced; the tail holds the last print           |
| `python-timeout`      | 4     | §5.6: `time.sleep(60)` hits the 15 s wall time; `exit.kind: timeout`, `truncation.reason: time_limit`   |
| `python-output-limit` | 20    | §5.6: ten 7,000-character lines, cut at 64 KB in the tenth; `exit.kind: output_limit`                   |
| `cpp-check-index`     | 15    | §19.6: `_GLIBCXX_DEBUG` stops `a[5]` on a 5-item `vector`; exit `SIGABRT`                               |
| `cpp-check-overflow`  | 7     | §19.6: UBSan stops `int` overflow in `sum += x`; exit code 1                                            |
| `cpp-check-divide`    | 5     | §19.6: UBSan stops an integer division by zero, with no `values`                                        |
| `cpp-check-empty`     | 5     | §19.6: `q.front()` on an empty `queue`                                                                  |
| `cpp-stack-overflow`  | 16    | §19.6: unbounded recursion ends in `SIGSEGV`, read as `recursion_too_deep`                              |
| `cpp-segfault`        | 9     | §5.6: a write far past an array ends in `SIGSEGV`, with no `kind`                                       |
| `cpp-pointers`        | 10    | §5.4: step 6 has `head` → `#o4` → `#o5` and a sparse `depth[200005]`                                    |
| `cpp-edge-list`       | 14    | §19.4 edge lists: `vector<pair<int,int>>`, `vector<Edge>`; steps 9–11 have internals                    |
| `cpp-sparse-dfs`      | 81    | §19.4.2: a DFS writes `depth_[u]` and `tin[u]` in two sparse `int[200005]`; step 30 writes `depth_[32]` |
| `synthetic-1000`      | 1,000 | Generated: every heap kind, sparse patches, calls, removed objects                                      |
| `synthetic-5000`      | 5,000 | Generated: 500 heap objects, for FE-02 performance work                                                 |

The C++ sources start with `#include` and `using namespace std;`, so their line numbers sit 2 below the §19.3 mock's.

To step through a fixture in the player, open `http://localhost:5173/?fixture=python-aliasing` under `pnpm dev`; add `&step=9` to open at a step. This works in the dev server only.

The first five traces are hand-written. The `cpp-check-*`, `cpp-stack-overflow`, `cpp-segfault`, `cpp-pointers`, `cpp-sparse-dfs`, `python-error-index` and `python-error-divide` traces are the backend's goldens (`backend/fixtures`) split into chunks; the other `python-*` ones, and `cpp-edge-list` with `showInternals` on, were recorded from `make dev` on 24 Oct 2026. All are plain JSON. Edit the hand-written ones directly; for the others, redo the copy rather than editing them by hand. `fixtures.test.ts` checks each one against `trace.v1.schema.json`, and checks the rules the schema can't express: 250-step chunks that start with a keyframe, lines inside the source, call ids on calls and returns, and a replayed heap that holds exactly what the stack reaches. The synthetic traces are generated at load time and never committed.

## Generated code

`pnpm gen` writes `packages/player/src/gen/trace.ts` and `apps/ide/src/gen/api.ts`. `make gen` in `backend/` runs it as well, so one command regenerates Go and TypeScript after a contract change. Never edit these files. CI fails when they drift from the contract. In the trace types, `Value.t` and `HeapObject.kind` stay open (`| (string & {})`), so a `switch` over them always needs a fallback branch (§9.7).

## Agent skills

`.claude/skills/` holds skills that Claude Code loads while it works on files under `web/`. They are plain copies from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), so a fresh clone needs no `npx` and no network. Why they're vendored: [memory](../memory/frontend/vendored-agent-skills.md).

| Skill                         | For                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| `vercel-react-best-practices` | Re-render, bundle and rendering performance rules                      |
| `vercel-composition-patterns` | Compound components and React 19 APIs, for `@viz/ui` and the player    |
| `web-design-guidelines`       | Accessibility and UX review; it fetches the current rules when it runs |

[AGENTS.md](AGENTS.md#agent-skills) wins where a skill disagrees with it. Don't edit the copies. To refresh one, install a fresh copy in a scratch directory, copy it over the vendored folder and read the diff:

```bash
cd "$(mktemp -d)" && npx skills add vercel-labs/agent-skills --skill vercel-composition-patterns -a claude-code --copy -y
```

## Common problems

- **You see mock data while expecting the real backend:** MSW is still on. Run `VITE_USE_MSW=false pnpm dev`.
- **`Failed to fetch` or connection refused on port 8080:** the backend isn't running. Start Docker, then run `make dev` in `backend/`.
- **A CORS error on API calls or chunk downloads:** the API, or the presigned SeaweedFS URLs (`S3_PUBLIC_ENDPOINT`), don't allow the dev origin `http://localhost:5173`. Both allow it under `make dev` (checked 24 Oct); look at `CORS_ORIGINS` in `backend/.env`, and rerun `make seed` after changing it.
- **`make gen` says `pnpm: command not found`:** install pnpm and run `pnpm install` in `web/` first.
- **`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` on install:** a version you asked for is less than 7 days old. Pin the newest version that is older, or wait. See [Dependencies](AGENTS.md#dependencies).
- **`Port 5173 is already in use`:** another `pnpm dev` is running; use that one. Vite stops instead of moving to 5174, because `http://localhost:5173` is the dev origin the API is meant to allow.
