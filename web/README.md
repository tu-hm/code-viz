# Web

The browser half of the code visualizer: the IDE app, the `@viz/player` package it embeds, the design system, and the trace fixtures every view is built against. Tasks: [plans/tasks/frontend/](../plans/tasks/frontend/). Visual rules: [docs/frontend/design-system.md](../docs/frontend/design-system.md). Rules for the code, tests and dependencies: [AGENTS.md](AGENTS.md).

## Layout

```text
apps/ide/          IDE app: Vite 8, React 19.3 with React Compiler, Tailwind v4
packages/player/   @viz/player: trace types (generated), loader, engine in a Web Worker, the player shell and controls
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

**Against the local stack:** start the backend with `make dev` in `backend/`, then run `VITE_USE_MSW=false pnpm dev`.

## Mock API

The handlers in [apps/ide/src/mocks](apps/ide/src/mocks/) answer every endpoint from the examples in `backend/api/openapi.yaml`, so they move with the contract. Pick a case with a query parameter:

| `?scenario=`          | What happens                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `completed` (default) | `POST /visualizations` returns a completed visualization. Its chunks are the `cpp-binary-search` fixture, served at the manifest URLs with the right `sha256` and `sizeBytes`. |
| `failed-build`        | The create call returns `failed` with a compile error.                                                                                                                         |
| `busy`                | `503 capacity` with `Retry-After: 5`.                                                                                                                                          |
| `slow-tracing`        | `tracing`, with progress and `version` rising on each long-poll, then `completed`.                                                                                             |

## Fixtures

`loadFixture(name)` from `@viz/fixtures` returns `{ header, chunks, source, stdin }`: the trace header, the chunk step arrays as the API serves them, and the program's source and stdin. `fixtureNames` lists them all.

| Fixture             | Steps | Spec moment it reproduces                                                                  |
| ------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `python-aliasing`   | 19    | §5.3: step 9 is `call square(x=5)`; `a` and `b` share `#o2`                                |
| `python-exception`  | 9     | §5.6: `IndexError` raised in `f`, unwound through `<module>`                               |
| `cpp-binary-search` | 20    | §19.3: step 11 has `l = 4`, `mid = 5`, `r = 7`; 10 of 10 input tokens read; gcov line hits |
| `cpp-dp-grid`       | 38    | §19.4.3: step 22 writes `dp[2][3] = 10`                                                    |
| `cpp-fib-memo`      | 32    | §19.4.4: step 26 enters the repeated `fib(3)`: 9 calls, depth 2                            |
| `synthetic-1000`    | 1,000 | Generated: every heap kind, sparse patches, calls, removed objects                         |
| `synthetic-5000`    | 5,000 | Generated: 500 heap objects, for FE-02 performance work                                    |

The C++ sources start with `#include` and `using namespace std;`, so their line numbers sit 2 below the §19.3 mock's.

To step through a fixture in the player, open `http://localhost:5173/?fixture=python-aliasing` under `pnpm dev`; add `&step=9` to open at a step. This works in the dev server only.

The hand-written traces are plain JSON. Edit them directly. `fixtures.test.ts` checks each one against `trace.v1.schema.json`, and checks the rules the schema can't express: 250-step chunks that start with a keyframe, lines inside the source, call ids on calls and returns, and a replayed heap that holds exactly what the stack reaches. The synthetic traces are generated at load time and never committed.

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
