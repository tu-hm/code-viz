# The code pane takes focus but leaves the step keys to the player

Decided 2026-10-24.

**Decision:** The CodeMirror code pane is editable but read-only (`EditorState.readOnly`, default `editable`), so Tab reaches it and ↑ ↓ move a caret through the lines. `ownsKey` in `keys.ts` treats a `contenteditable` with `aria-readonly="true"` as not typing, so ← → Home End Space Esc still step, play and close while the code has focus. Enter toggles the breakpoint on the caret's line.

**Why:** CodeMirror's gutters are `aria-hidden`, so clicking a line number is mouse-only; the caret is the keyboard and screen-reader way to a line (§5.10). With `editable: false` the pane can't take focus at all. Without the `aria-readonly` exclusion, a click in the code swallows the step keys until the student clicks elsewhere.

**How to apply:** Keep both halves together. A key the pane needs for itself goes in its CodeMirror keymap, which runs on the content element before the window listener and calls `preventDefault`, so `useStepKeys` skips it.
