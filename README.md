# Code Visualizer

Run a Python or C++ program once in a sandbox, record every step as a trace, and replay it in the browser: the stack, the heap, pointers, and big arrays. Built for competitive-programming and olympiad students.

The product and technical spec is [plans/code-visualizer-spec_2.md](plans/code-visualizer-spec_2.md). Section numbers (`§7.13`) and decision IDs (`D16`) throughout the repo point into it.

## Layout

```text
backend/        Go: vizd (API and worker roles), vizctl, schemas, OpenAPI contract
  api/          openapi.yaml, the HTTP contract (source of truth, D14)
  schema/       trace and wire JSON Schemas (source of truth, D14)
  cmd/          vizd and vizctl entrypoints
  internal/     domain, tracecore, app, ports, adapters, transport; gen/ is generated
  fixtures/     golden traces per language
web/            TypeScript: pnpm workspace for the browser app
  apps/ide/     IDE app (Vite, React)
  packages/     @viz/player, @viz/ui (design system)
  fixtures/     traces every view is built against
docs/guides/    how we write code here: comments, tests, migrations, the sandbox, tracing, the design system
plans/          spec, work plans, one file per backend and frontend task
```

## Getting started

You need Go, Docker with Compose v2, make and git, on macOS or Linux. The setup script checks each one and prints the install command for your system (Homebrew on macOS, apt or dnf on Linux):

```bash
cd backend
scripts/setup.sh
make test
```

Go comes from the version in `backend/go.mod`. Any Go 1.21 or newer downloads it automatically, unless `GOTOOLCHAIN=local` is set (Fedora's Go package sets it). The script tells you if that is the problem.

The local stack (MySQL 8.4 and SeaweedFS in Docker), `make dev`, and fixes for common problems are in [backend/README.md](backend/README.md).

The web app needs Node 24 and pnpm 12. `make gen` needs them too, because it regenerates the TypeScript types:

```bash
cd web
pnpm install
pnpm dev
```

The mock API, fixtures and configuration are in [web/README.md](web/README.md).

## Where to read

| Read | For |
|---|---|
| [Spec](plans/code-visualizer-spec_2.md) | Behavior, locked decisions (§0.1), API (§8), trace format (§9), limits (§11), security (§12), tests (§15) |
| [Backend tasks](plans/tasks/backend/) | What to build, BE-01 to BE-14, each with its spec sections and done criteria |
| [Frontend tasks](plans/tasks/frontend/) | FE-01 to FE-14, the same shape |
| [Web README](web/README.md) | Running the web app, the mock API, fixtures, generated types |
| [Design system](docs/guides/design-system.md) | Tokens, the trace palette, type, frame, components, contrast rules |
| [Task tracking](plans/tasks/README.md) | Milestones, decision gates, handoffs between backend and frontend |
| [AGENTS.md](AGENTS.md) | Backend rules: plain Go (S1 to S12), architecture, trust boundary, MySQL, errors and logs, git |
| [web/AGENTS.md](web/AGENTS.md) | Frontend rules: plain TypeScript (T1 to T7), React with the compiler (R1 to R8), tests, dependencies, known traps |
| [Comments cheat sheet](docs/guides/comments-cheat-sheet.md) | Default zero comments; the eight kinds that earn one |
| [Testing cheat sheet](docs/guides/testing-cheat-sheet.md) | 11 rules for tests that catch regressions |
| [Database migrations](docs/guides/db-migrations.md) | goose on MySQL 8.4: online DDL, expand and contract, safe patterns |
| [Sandbox](docs/guides/sandbox.md) | The `Sandbox` port, `viz-shim`, the Docker dev sandbox, what a runner image needs |
| [Tracing](docs/guides/tracing.md) | Program to trace: the Python tracer, the wire contract, `tracecore`, `vizctl`, the golden fixtures |

## Working rules

- **Contracts first.** Change `backend/api/openapi.yaml` or `backend/schema/*.json`, run `make gen`, and commit the contract, the generated code and its callers together. CI fails when generated code drifts.
- **Locked decisions stay locked.** Changing one of D1 to D25 needs a row in the spec change log (§0.3) with the evidence.
- **Commits** are one line in Conventional Commits form: `fix(mysql): stop job writes after the lease is lost`. Details in [AGENTS.md](AGENTS.md#git-and-prs).
