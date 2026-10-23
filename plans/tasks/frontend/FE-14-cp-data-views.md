# FE-14 · CP data views

| | |
|---|---|
| **Milestone** | M5 (option A: §1, §4, §5 start in M2 slack) |
| **Estimate** | 19 days |
| **Depends on** | FE-06, FE-08, FE-10; BE-03/BE-08 `callId` + `parentCallId` (§19.9.6); usability test recruited (M0-21, DS) |
| **Blocks** | — |
| **Covers** | M5-F01–F05, M5-F07–F10 |
| **Spec** | §19.4, §19.4.4–§19.4.6, §19.8, §19.11 |

✂ **Cut first if late:** §3 tree view, §8 constant badges & matrix labels.

## 1. Call tree (M5-F01 · 3 d)

- [ ] Build in one pass from `callId` / `parentCallId`; args + return value per node; `…` still running
- [ ] `↺ repeated`: exact same arguments as an earlier call
- [ ] Collapse: > 8 siblings → "+N calls"; > 50 levels → first/last 10; "Collapse repeated calls"
- [ ] Click → call step; Shift-click → return step
- [ ] Tree ↔ Stack toggle; stack collapses the middle above 20 frames
- [ ] Footer: depth now · max depth · calls so far
- [ ] **Done:** matches the §19.4.4 mock on the fib fixture

## 2. Graph view (M5-F02 · 5 d)

- [ ] Detect sources: `vector<int> adj[N]`, `vector<vector<int>>` (values in `[0, N)`), weighted `vector<pair<int,int>> adj[N]`, edge lists; names `adj`, `g`, `graph`
- [ ] "View as Graph?" suggestion chip; choice remembered per variable name
- [ ] elkjs layered layout in a worker; positions stable between steps
- [ ] Current node from the `adj[u]` subscript; edge being checked `(u, v)`
- [ ] Colour / label nodes by another size-N array (`dist`, `depth`, `vis`, `color`, `low`)
- [ ] Undirected detection (edges in both directions drawn once)
- [ ] > 200 nodes: 2-hop neighbourhood of the current node + hidden count
- [ ] **Done:** matches the §19.4.5 BFS mock

## 3. Tree view (M5-F03 · 2 d) ✂

- [ ] From parent arrays (`par`, `parent`, `p`, `fa`, values in `[-1, N)`)
- [ ] DFS tree from first-visit edges
- [ ] Same layout engine and highlights as §2

## 4. Container widgets (M5-F04 · 2 d)

- [ ] `stack` vertical, top first; `queue`/`deque` horizontal with front/back
- [ ] `priority_queue` sorted with top first; heap order on hover
- [ ] `set`/`map` sorted table; `multiset` repeats as `5 ×3`
- [ ] Auto-switch on (§19.4 table); Cells as alternative

## 5. Bits view (M5-F05 · 1 d)

- [ ] Suggested for `mask` / `bits` / `state` or `<<`, `&`, `|` on the current line
- [ ] Bit indices, value, set bits list, popcount; width 8/16/32/64/*n*

## 6. Conditional jumps (M5-F07 · 2 d)

- [ ] Small expression evaluator over step state: identifiers, subscripts, `== != < <= > >= && || !`, arithmetic
- [ ] "Next step where `i == 5`" / "where `dp[i][j] > 100`" in Go to…
- [ ] Safe: no `eval`, parse errors shown inline

## 7. Loop-pass chips (M5-F08 · 1 d)

- [ ] On a loop header line: chips `1 2 3 … 8` jumping between passes (FE-08 §3 line facts)

## 8. Constant badges & matrix labels (M5-F09 · 1 d) ✂

- [ ] Badges: `INT_MAX`, `LLONG_MAX`, `0x3f3f3f3f`; **∞ INF** when equal to a variable named `INF`/`inf`; **MOD** for `1e9+7`, `998244353`
- [ ] Matrix: "Label rows by `s`, columns by `t`" for string DP

## 9. Usability fixes (M5-F10 · 2 d)

- [ ] Support DS + Lead running the 8-student test (build, fixtures, tasks scripted)
- [ ] Fix the top issues; re-check §19.11 targets and SUS ≥ 75

## Done when

The usability test meets §19.11.
