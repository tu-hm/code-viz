# What "next change of" and "next time a line runs" match

Decided 2026-10-24.

**Decision:** "Next change of `x`" (`search.ts`) reads `x` from the innermost frame on the stack that declares it, not from the top frame and the globals. A step counts when `x` has a value there that differs from the last value it had. A step where `x` is out of scope doesn't count, and neither does coming back into scope unchanged; the first value after being undefined does count. Values are compared deeply through `ref`s, so `dp` changes when any row changes, and `b = a` changes when `a.append` runs. A `ptr` is compared by itself: its value is the address, not what it points at. "Next time line L runs" matches only `line` and `call` steps whose next line is L.

**Why:** with top frame plus globals, `a` in `main` vanishes while a function that takes it by reference runs. The change would then show on the first step back in `main`, not on the step that made it, and every return would look like a change. A Python return or exception step repeats the line it left (`return 2 → 2`), so counting it would report the same run of a line twice.

**How to apply:** keep these rules when FE-11 adds "Prev change" and the timeline lanes, so the lanes, the watch history and Go to… agree. Autoplay's breakpoint stop (`autoplay.ts`) still stops on a return step at a breakpoint line; make the two agree if that matters to someone.
