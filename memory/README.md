# Memory

Decisions made while building the code visualizer that neither the spec nor the code records. Each entry says what was chosen, why, and what a later change must not quietly undo. Agents and people read it the same way.

## What goes here

A choice between options that both work, where the reason isn't visible in the code, the spec or the git log, and where a later change could reverse it without noticing. Examples: why a tool is vendored instead of installed, why a check lives in one layer and not another, a workaround that only makes sense with its cause.

Not here:

- Product behavior a user sees. The spec decides it; when the spec is silent, ask (AGENTS.md, "How to work").
- Changes to a locked decision (D1–D25). Those go in the spec change log (§0.3) with evidence.
- What the code, a doc or a commit message already says. Link to it instead.
- Task status. That's [plans/tasks/STATUS.md](../plans/tasks/STATUS.md).

## How to use it

- Before a task, read the index below for its side.
- When you make a decision that belongs here, add the entry in the same commit as the change it explains, and add its line to the index.
- When a decision changes, edit its entry and its date. When the code no longer depends on it, delete the entry; git keeps the history.
- Commit type `docs`, scope `memory` when the commit only touches this folder: `docs(memory): record why the player skips view transitions`.

## Entry format

One decision per file, kebab-case name, in `frontend/` or `backend/`. A decision that spans both goes on the side whose code carries it.

```markdown
# Vendor agent skills under web/.claude/skills

Decided 2026-10-24.

**Decision:** one or two sentences.

**Why:** the reason and the evidence: a spike, a measurement, an incident, a spec section.

**How to apply:** what a later change must keep doing, or check first.
```

Write it the way AGENTS.md asks for prose: short, plain, no hedging.

## Frontend

- [Arrow overlay](frontend/arrow-overlay.md): arrows find cards and `●` through data attributes and highlight with `data-active`, so hover never re-renders a card; only the on-screen slice is measured
- [Code pane keyboard](frontend/code-pane-keyboard.md): the code pane takes focus for the caret and Enter, but ← → Home End Space Esc stay the player's
- [Empty trace](frontend/empty-trace.md): a trace with no steps gets the IDE's own screen with the tail, never the player
- [Go to… search rules](frontend/goto-search.md): "next change" reads the innermost frame that declares the name and follows refs, not pointers; a line jump skips return steps
- [Run error banner](frontend/run-error-banner.md): the status bar explains only the error the program died of, found by walking back over its unwinding; a caught error gets no banner
- [Array markers and windows](frontend/array-markers.md): markers read the current values, inferred reads the previous step's; `access[]` wins; a known pair joins only an array the line already indexes; a big array's window keeps its place between steps
- [State pane folding](frontend/state-pane-folding.md): internals' objects hide with them; pairs read inline, C++ by-value structs nest, table and matrix rows fold; "Show range…" only on truncated sequences
- [State pane skips unchanged](frontend/state-pane-skips-unchanged.md): unchanged objects keep their identity across steps, and cards and frames compare what they draw; measure on a production build
- [Visualize run](frontend/visualize-run.md): the create keeps its promise so Close can delete an unanswered run; the long-poll is one `queryFn` loop that resumes from the cached version; only unfinished runs are deleted; Retry keeps the `Idempotency-Key`, a re-run gets a new one
- [Vendored agent skills](frontend/vendored-agent-skills.md): React, composition and web design skills live as plain copies in `web/.claude/skills`; `web/AGENTS.md` wins over them

## Backend

- [Lease rules](backend/lease-rules.md): what keeps a stale worker from writing, and the gap the lease leaves in object storage
- [Read hints](backend/read-hints.md): C++ reads from kernel-address call hooks in `reads.o`, Python's from a `sys.monitoring` callback, one index per sequence; keep `reads.o` uninstrumented and the PCH flags equal to `build.cmd`
- [Share links](backend/share-links.md): a link is its own row, never found by "owned" lookups, expiring with the owner's row; `t7/` stays until the cleanup
- [Seed through the queue](backend/seed-through-the-queue.md): `vizd seed` uses Create, Claim and Complete, never seed-only SQL
- [Telemetry off by default](backend/telemetry-off-by-default.md): `/metrics` needs `VIZ_METRICS=true`, spans need `OTEL_EXPORTER_OTLP_ENDPOINT`, Jaeger is a compose profile
