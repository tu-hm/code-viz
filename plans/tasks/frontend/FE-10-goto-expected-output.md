# FE-10 · Go to… & expected-output compare

| | |
|---|---|
| **Milestone** | M1 (week 8) |
| **Estimate** | 4 days |
| **Depends on** | FE-02 §2 (engine), FE-03 (breakpoints); M1-21 designs by **Fri 4 Dec** (DS) |
| **Blocks** | FE-11 §2 (timeline jumps), FE-14 §6–7 (conditional jumps, loop chips) |
| **Covers** | M1-F03, M1-F04 |
| **Spec** | §5.9, §19.7, §19.8 |

All searches run in the browser over the loaded trace.

## 1. Go to… (M1-F03 · 2.5 d)

- [x] Search module in the worker: scan steps forward/backward from the current one; early exit — forward, in the worker (`search.ts`), stopping at the first match; the worst full walk takes 8 ms on the 5,000-step fixture. Backward finds the previous change for FE-11's "Prev change"
- [x] Step over (`Shift + →`): next step in the same frame (or the caller after return) — also Shift-click on Next (§5.9)
- [x] Step out (`Shift + ↑`): first step back in the caller — the first step without the current frame, which can be the caller's next call; nothing from the outermost frame
- [x] Next time line *L* runs (`L`); uses breakpoints when no line is given — a `line` or `call` step whose next line is *L*; a return or exception step repeats its line and doesn't count
- [x] Next change of a variable, one cell (`dp[2][3]`) or a whole array (any cell) (`C`) — rules in [memory](../../../memory/frontend/goto-search.md)
- [x] Next call of function *f* (`F`) — the menu lists every function the run calls
- [x] Next print to output (`P`) — stdout or stderr
- [x] Error step (`E`) — the next error step; a Python exception that's caught counts
- [x] First difference from expected output (`D`, from §2)
- [x] Go to… menu with the shortcuts listed; disabled entries when nothing matches — a popover from the controls row; each entry is checked from the current step while it's open
- [x] "Not found after step N" toast instead of a silent no-op — names the jump ("Next print to output: not found after step 20"), and a jump missing its line or variable says what to enter; gone on the next step or after 4 s
- [x] Unit test per jump on fixtures — `search.test.ts`, plus every fixture's "next change" checked against replaying each step
- [x] **Done:** every §19.8 jump has a unit test

## 2. Expected-output compare (M1-F04 · 1.5 d)

- [x] EXPECTED column next to OUTPUT; paste box; prefilled from the problem sample when opened from a problem page (`context`) — behind the mock's **Compare** box; `Player`'s `expected` prop fills it and ticks Compare. No problem page passes it yet
- [x] Compare ignoring trailing whitespace and line endings; **Exact** toggle — also blank lines at the end; stdout only
- [x] First difference: line + char, "expected "6", got "7"" — "end of line" and "end of output" when one side has none
- [x] Map the first wrong char to the step that printed it (per-step `stdout`) → **Jump to step N** — and `◀ differs at char 5` after that line in the output once it's printed
- [x] Output too short: "Output ended early: 3 more lines expected" + jump to last print / exit
- [x] Includes untraced tail output when present (mark that it has no step) — `loadTrace` fetches `trace.tail` and checks it like a chunk. The backend keeps the tail's stdout and stderr in arrival order, so stderr printed after the step limit is compared too
- [x] **Done:** matches the §19.7 mock — checked in Chrome, light and dark, font sizes M and L

## Done when

Each jump has a unit test, and compare matches the §19.7 mock.
