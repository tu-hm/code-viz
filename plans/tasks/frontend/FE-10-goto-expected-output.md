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

- [ ] Search module in the worker: scan steps forward/backward from the current one; early exit
- [ ] Step over (`Shift + →`): next step in the same frame (or the caller after return)
- [ ] Step out (`Shift + ↑`): first step back in the caller
- [ ] Next time line *L* runs (`L`); uses breakpoints when no line is given
- [ ] Next change of a variable, one cell (`dp[2][3]`) or a whole array (any cell) (`C`)
- [ ] Next call of function *f* (`F`)
- [ ] Next print to output (`P`)
- [ ] Error step (`E`)
- [ ] First difference from expected output (`D`, from §2)
- [ ] Go to… menu with the shortcuts listed; disabled entries when nothing matches
- [ ] "Not found after step N" toast instead of a silent no-op
- [ ] Unit test per jump on fixtures
- [ ] **Done:** every §19.8 jump has a unit test

## 2. Expected-output compare (M1-F04 · 1.5 d)

- [ ] EXPECTED column next to OUTPUT; paste box; prefilled from the problem sample when opened from a problem page (`context`)
- [ ] Compare ignoring trailing whitespace and line endings; **Exact** toggle
- [ ] First difference: line + char, "expected "6", got "7""
- [ ] Map the first wrong char to the step that printed it (per-step `stdout`) → **Jump to step N**
- [ ] Output too short: "Output ended early: 3 more lines expected" + jump to last print / exit
- [ ] Includes untraced tail output when present (mark that it has no step)
- [ ] **Done:** matches the §19.7 mock

## Done when

Each jump has a unit test, and compare matches the §19.7 mock.
