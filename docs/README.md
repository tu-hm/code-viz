# Docs

How the code is built and how to work on it. What the product does, and why, is in the [spec](../plans/code-visualizer-spec_2.md). What to build next is in the [tasks](../plans/tasks/). Spike reports, the evidence behind decisions, are in [plans/spikes/](../plans/spikes/).

```text
docs/
  backend/
    architecture/   how the backend is built and why: read before you change a part
    guides/         step by step for one task: add a language, run the tests, write a migration
    conventions/    rules for writing code and tests, cited by ID in review
  frontend/         the design system
```

## Backend

| Doc | Kind | For |
|---|---|---|
| [Overview](backend/architecture/overview.md) | Architecture | Binaries, packages and their status, one visualization end to end |
| [Sandbox](backend/architecture/sandbox.md) | Architecture | The `Sandbox` port, `viz-shim` and its frames, nsjail, the Docker dev sandbox |
| [Tracing](backend/architecture/tracing.md) | Architecture | Manifest to trace: the Python tracer, the C++ build and its diagnostics, the wire contract, `tracecore`, `vizctl` |
| [Adding or changing a language adapter](backend/guides/language-adapter.md) | Guide | Manifest, runner image requirements, the C++ runner image, tracer, fixtures, wire contract changes, the G2 hook switch |
| [Running the backend tests](backend/guides/testing.md) | Guide | What each test package covers and needs, golden traces, captured GCC output, fuzzing |
| [Database migrations](backend/guides/db-migrations.md) | Guide | goose on MySQL 8.4: online DDL, expand and contract, safe patterns |
| [Comments cheat sheet](backend/conventions/comments-cheat-sheet.md) | Convention | Default zero comments; the eight kinds that earn one (E1–E8) |
| [Testing cheat sheet](backend/conventions/testing-cheat-sheet.md) | Convention | 11 rules for tests that catch regressions |

The backend's working rules (plain Go, S1–S12, the trust boundary, MySQL, git) are in [AGENTS.md](../AGENTS.md). Running it is in the [backend README](../backend/README.md).

## Frontend

| Doc | For |
|---|---|
| [Design system](frontend/design-system.md) | Tokens, the trace palette, type, frame, components, contrast rules, the UI change checklist |

The frontend's working rules are in [web/AGENTS.md](../web/AGENTS.md); running it is in the [web README](../web/README.md). The testing cheat sheet applies to the web code as well, with the changes web/AGENTS.md lists.

## Where a new doc goes

- **Architecture:** a part of the system, how it works and why. It names the spec sections and decisions it builds on, and lists what isn't built yet.
- **Guide:** one task, as steps a reader follows. It links to the architecture doc for the why, instead of repeating it.
- **Convention:** a rule with an ID that review can cite, with BAD and GOOD examples.
- **Spike report or decision:** `plans/spikes/`, and a row in spec §0.3 once a gate decides it.
