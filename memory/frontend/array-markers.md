# Where index markers, inferred reads and the big-array window come from

Decided 2026-10-25.

**Decision:** `marksFor` in `marks.ts` builds every card's marks from the step and the parsed source (`source-facts.ts`):

- **Markers** use the variables' values at this step, from subscripts of the array on the current line and the line that just ran (`line`, `prevLine`). One marker per variable and axis; `i` wins over `i+1` from the same line. Up to 4 per axis, then "+N".
- **Inferred reads** and the matrix narration use the values from *before* the line ran: `StepState.before.scope` (the previous step's innermost and global frames) and `before.cells` (old values of the sequence cells that changed). Only the line that ran (`prevLine`) is read. A step with `access[]` uses it and infers nothing (§19.9.2).
- **Ranges:** a known pair (`l`/`r`, `lo`/`hi`, `L`/`R`, `left`/`right`, `i`/`j`) joins a 1-D array only when the line already puts a marker on it. That is how §19.3's `a` gets `l` and `r` at step 11: line 10 indexes `a[mid]`, and nothing in the program ever writes `a[l]`.
- **Big arrays** (longer than 64): the window is the card's own state. It jumps to the page of the first marker, else of the first cell written this step, when that target changes, and otherwise stays where it was. `[`, `]`, the buttons, the minimap and Go to index… move it.
- Parsing runs in the worker after the trace opens, without awaiting it; until `facts` arrives, cards draw no markers, reads or narration. The exact writes (`[x]`, `*`) come from the diff and never wait.

**Why:** A marker shows where `mid` points now; a read shows what the line used, which `i++` on the same line would otherwise shift. Pairs on every array would put `i..j` on unrelated arrays in a nested loop. A window computed from the step alone would snap back to the start on every step whose line doesn't index the array, which §19.10 rules out ("the layout never moves").

**How to apply:** A card that starts drawing something new from `marks` needs nothing else: `sameCard` compares `marks` deeply. Because the window has history, the "stepping in place draws what a fresh render draws" test empties big-array windows before comparing; test the window itself in `data-views.test.tsx`. S8 found the inference wrong on about a quarter of contest-style subscript lines ([report](../../plans/spikes/s8-tree-sitter.md)); when a tracer sends `access[]`, keep it winning.
