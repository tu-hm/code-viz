# FE-09 · Narration & input cursor

| | |
|---|---|
| **Milestone** | M1 (week 6) → M3 |
| **Estimate** | 5.5 days |
| **Depends on** | FE-02 §2 (engine diff); FE-08 §3 (tree-sitter line facts) for §2–3; BE-03 (`stdinPos` for Python) |
| **Blocks** | FE-05 §3 (error narration), FE-13 (`aria-live` text) |
| **Covers** | M1-18, M3-F01, M3-F03 |
| **Spec** | §19.3, §19.5, §19.9.4, D22, D23 |

Deterministic, template-based narration built in the browser (no AI, D22).

## 1. Narration v0 (M1-18 · 1.5 d · M1 week 6)

- [x] Rules engine: first matching rule wins (§19.5 order)
- [x] Rules: Call `f(args)`, Return `f returns v`, Output `Printed "…"`, Other changes `x = v (was w)` up to 3 then "+N more", fallback `Line L ran`
- [x] Error rule hooks into FE-05 §3 message when present
- [x] Shown under the step counter as `» …`
- [x] **Done:** every fixture step has a line

## 2. Full narration (M3-F01 · 2 d)

- [x] Input read: `Read 13 from input (token 2 of 10)` (from §3 below)
- [x] Assignment with inferred reads: `dp[2][3] = 10 (was ·), from dp[1][3] = 4 and dp[2][2] = 6`
- [x] Loop header re-entered: `Loop at line 6: pass 3`
- [x] Branch taken: `Condition on line 8 was false → else` (next line matched against parsed structure)
- [x] Story panel: last 20 narrations, click to jump
- [x] Hover on the timeline (FE-11) shows any step's narration
- [x] One unit test per §19.5 rule, plus rule-priority tests
- [x] **Done:** every rule in the §19.5 table has a test

## 3. Input cursor (M3-F03 · 2 d)

- [x] INPUT panel: stdin text, tokens read so far dimmed, token read at this step highlighted, "N of M tokens read"
- [x] Python: exact from `stdinPos` (§19.9.4)
- [x] C++: inferred — count `>>` operands on `cin` lines and `%` conversions in `scanf`; `getline` consumes to newline; mark as inferred
- [x] `◆` input-read markers feed the timeline strip (FE-11)
- [x] **Done:** binary-search fixture shows 10 of 10 tokens read

## Done when

Every narration rule has a test, and the binary-search fixture shows 10 of 10 tokens read.
