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

- [Vendored agent skills](frontend/vendored-agent-skills.md): React, composition and web design skills live as plain copies in `web/.claude/skills`; `web/AGENTS.md` wins over them

## Backend

- [Lease rules](backend/lease-rules.md): what keeps a stale worker from writing, and the gap the lease leaves in object storage
