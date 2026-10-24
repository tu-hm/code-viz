# Vendor agent skills under web/.claude/skills

Decided 2026-10-24.

**Decision:** Three third-party skills from `vercel-labs/agent-skills` live in the repo as plain copies: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`. They sit in `web/.claude/skills`, not at the root, and `web/AGENTS.md` wins where they disagree with it.

**Why:** The web workspace treats installs as a supply-chain risk: exact versions, a 7-day release age, no git or tarball dependencies (web/AGENTS.md, "Dependencies"). `npx skills add` fetches upstream HEAD on every machine, which skips all three checks, so the copies are reviewed once and committed. Claude Code loads a nested `.claude/skills` only while it works on files under that directory, so backend sessions don't get React rules. The React skill targets Next.js: it recommends SWR, memo hooks, handler refs and server-only rules, which §18.1 and R1, R2 and R6 rule out.

**How to apply:** Don't edit the copies; refresh one by copying a fresh upstream folder over it and reading the diff (web/README.md, "Agent skills"). A new skill gets the same review: it can't contradict `web/AGENTS.md` without a precedence line there. Skipped on purpose: `vercel-react-view-transitions`, because §18.1 picks no animation approach yet, and `frontend-design`, because the design system decides the visuals.
