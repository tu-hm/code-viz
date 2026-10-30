# M5 usability test: moderator script

FE-14 §9. A moderated test with 8 CP students of mixed levels, in English, against the targets in spec §19.11. DS and the Lead run it; this page holds what they need: the build, the programs, the six tasks with their answers, and the SUS form.

## Setup

- **Build:** the IDE at `main` from 26 Oct 2026 or later, which has the FE-14 views (call tree, graph, containers, bits, conditional jumps, loop chips, badges).
- **Programs:** every task opens a fixture trace, so each student sees the same steps and no one waits for a build. Start the dev server and open `http://localhost:5173/?fixture=<name>`:

  ```bash
  cd web && pnpm dev
  ```

  To test the full flow instead, run `make dev` in `backend/`, start the IDE with `VITE_USE_MSW=false`, and paste each fixture's `main.cpp` and `stdin` from `web/fixtures/<name>/` before pressing **Visualize**.
- **Before each student:** reload the page, so pins, views and breakpoints from the previous student are gone. Settings persist in `localStorage`; clear it if a student changed them.
- **Timing:** start when you finish reading the task aloud, stop when the student says the answer. Give no hints. A wrong answer, or no answer by twice the target time, is a miss.

## Tasks

| # | Fixture | Read aloud | Answer | Target (§19.11) |
|---|---|---|---|---|
| 1 | `cpp-prefix-sum` | "This program should print `3 4 8 9 14`. Find the first step where its output goes wrong." | Step 17: it printed `0` where `3` was expected. The bug is `a[i - 1]` on line 9. | 7 of 8 within 60 s |
| 2 | `cpp-binary-search` | "Which line runs most often?" | Line 6, 9 times (`for (auto &v : a) cin >> v;`) | 8 of 8 within 15 s |
| 3 | `cpp-binary-search` | "What are `l`, `mid` and `r` after the 3rd pass of the `while` loop?" | `l = 6`, `mid = 6`, `r = 5` (step 16 has `mid = 6`; step 17 sets `r = 5`) | 7 of 8 within 45 s |
| 4 | `cpp-dp-grid` | "Find the step where `dp[3][4]` is first set, and which cells it came from." | Step 34 sets `dp[3][4] = 35`, from `dp[2][4] = 15` and `dp[3][3] = 20` | 6 of 8 within 90 s |
| 5 | `cpp-fib` | "Using the call tree, explain why this recursive solution is slow." | `fib(6)` makes 25 calls; most are ↺ repeated, e.g. `fib(2)` five times. Any answer naming the repeated calls counts. | 6 of 8 (untimed) |
| 6 | `cpp-check-index` | "The program crashes. Find the cause." | Step 15, line 8: `a[5]` on a vector of size 5; the loop bound `i <= 5` should be `i < 5` | 7 of 8 within 60 s |

What each task leans on, for the debrief:

1. Compare with expected output and **D** (first difference).
2. The `×n` hit counts in the gutter, and their hover.
3. The loop-pass chips on the `while` line, the WATCH panel, Go to… "next step where `l > r`".
4. Go to… "next change of `dp[3][4]`" or "next step where `dp[3][4] > 0`", and the matrix's `[x]` and `(x)` marks.
5. The CALLS panel: ↺ repeated, Collapse repeated calls, the "calls so far" footer.
6. The friendly error banner and **E** (error step).

## After the tasks: SUS

Ask the 10 standard System Usability Scale statements, each from 1 (strongly disagree) to 5 (strongly agree):

1. I think that I would like to use this tool frequently.
2. I found the tool unnecessarily complex.
3. I thought the tool was easy to use.
4. I think that I would need the support of a technical person to be able to use this tool.
5. I found the various functions in this tool were well integrated.
6. I thought there was too much inconsistency in this tool.
7. I would imagine that most people would learn to use this tool very quickly.
8. I found the tool very cumbersome to use.
9. I felt very confident using the tool.
10. I needed to learn a lot of things before I could get going with this tool.

Score: for odd items take the answer minus 1, for even items 5 minus the answer; add them up and multiply by 2.5. The target is a mean of at least 75.

## Recording sheet

One row per student; times in seconds, `✗` for a miss.

| Student | Level | T1 | T2 | T3 | T4 | T5 | T6 | SUS | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | |
| 2 | | | | | | | | | |
| 3 | | | | | | | | | |
| 4 | | | | | | | | | |
| 5 | | | | | | | | | |
| 6 | | | | | | | | | |
| 7 | | | | | | | | | |
| 8 | | | | | | | | | |

Note where students hesitated or looked in the wrong pane; those notes drive the fixes in FE-14 §9's second item.
