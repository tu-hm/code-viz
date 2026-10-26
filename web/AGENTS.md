# AGENTS.md (web)

The browser half of the code visualizer: `apps/ide`, `@viz/player`, `@viz/ui` and `@viz/fixtures`. Running it, the mock API and the fixtures: [README.md](README.md). Visual rules: [design system](../docs/frontend/design-system.md). Tasks: [plans/tasks/frontend/](../plans/tasks/frontend/).

The root [AGENTS.md](../AGENTS.md) applies here too: how to work, the S rules (none of them is Go-specific), comments default to zero, git. This file adds what is specific to TypeScript, React and the browser. Cite rules by ID in review (`R4`).

## Commands

Run from `web/`.

```bash
scripts/setup.sh                                # checks Node, pnpm, git and installed dependencies
pnpm check                                      # before pushing: gen drift, lint, typecheck, test, build; CI runs it
pnpm fmt                                        # Prettier, then ESLint --fix
pnpm exec vitest run <file>                     # one test file
pnpm exec vitest run <file> --reporter=default  # same, with console output from passing tests
```

- `pnpm lint` fails on any warning. Fix the code, or turn the rule off in `eslint.config.js` with a reason. An `eslint-disable` comment names the rule and gives a reason.
- `pnpm build` fails when React Compiler cannot compile a component (R3). The dev server shows the same error as an overlay.

## Files and names

- Files and directories are kebab-case: `error-boundary.tsx`. PascalCase is for component and type names, not file names.
- A hook lives in a file named for what it provides: `store.ts` exports `usePlayer`, `flags.ts` exports `useFlag`.
- Named exports and `export function`. No default exports outside config files. A class only for an error boundary, because React has no hook for one.
- Imports keep the `.ts` or `.tsx` extension.

## Write plain TypeScript

| #   | Slop                                                                                                         | Write instead                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | A closed set written twice: a union type plus the same strings in an array; or an `enum`                     | One `as const` array. The type and the guard derive from it (`flags.ts`, `scenarios` in `mocks/handlers.ts`). `erasableSyntaxOnly` rules out `enum` |
| T2  | A `switch` over `Value.t` or `HeapObject.kind` with no fallback                                              | A default branch that draws plain text or an `opaque` card. Those unions stay open with `(string & {})` (§9.7)                                      |
| T3  | `as` on data the app receives at runtime: an API response, `localStorage`, a URL parameter, a worker message | Narrow it with a guard or `instanceof`. API shapes come from `gen/`; never copy a contract type by hand (D14)                                       |
| T4  | `x?.id === y?.id` as a guard. Both sides are `undefined` when both are missing, so it is `true`              | `x != null && y != null && x.id === y.id`                                                                                                           |
| T5  | An invalid env var, flag or `?param` value quietly replaced by a default                                     | Throw at startup with the name and the allowed values (`config.ts`, `flags.ts`, `?scenario=`)                                                       |
| T6  | `catch {}`, `.catch(() => {})`, a rejected promise nobody awaits                                             | Rethrow, or show the failure to the user. The app has no error reporter, so a swallowed error is gone (S3)                                          |
| T7  | An export nobody imports; a barrel file inside a package                                                     | Export what another file uses. A package's `index.ts` is its public API and the only barrel                                                         |

## React

React Compiler is on (§18.1) and Strict Mode wraps the app.

| #   | Slop                                                                                                                       | Write instead                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `useMemo`, `useCallback` or `memo` added "for performance"                                                                 | Plain code; the compiler memoizes. Add one only when identity changes behavior (a library that resets on a new object, a value an effect subscribes with) or a profile shows the need. Say which in the PR                                                       |
| R2  | An effect that re-subscribes because a callback or a store action changed identity                                         | `useEffectEvent` for what the effect reads but must not re-run for. What decides which work runs (an id, a step) stays in the deps. Never pass an effect event to another component or put it in deps                                                            |
| R3  | Code the compiler cannot compile: `try` without `catch`, or `?:`, `&&`, `\|\|`, `??`, `?.` inside a `try` or `catch` block | Put only the throwing call in `try` and branch after it. A component the compiler can't compile fails the build. `"use no memo"` with an E5 TODO is the last resort                                                                                              |
| R4  | A view that fetches, reads the store or calls the worker to decide what to draw                                            | A view takes the step, the settings and callbacks as props. A container owns the query, the store and the worker. Every state (loading, empty, error, any fixture step) renders from props alone, so a story or a test needs no backend and no worker (FE-01 §4) |
| R5  | Subscribing to the whole store, or to `step`, high in the tree                                                             | Select the narrowest slice in the leaf that draws it: `usePlayer((s) => s.step)`. A custom hook's `useState` re-renders the component that calls the hook, so per-step state lives in the store. A step has 16 ms (§13)                                          |
| R6  | Server data copied into Zustand or `useState`                                                                              | TanStack Query owns server state, Zustand owns UI state (§18.1). Derive the rest during render                                                                                                                                                                   |
| R7  | An effect that works once and breaks under Strict Mode's setup, cleanup, setup                                             | Every effect cleans up what it started: listener, interval, request, worker. A "done once" ref is set after the result arrives, not before the request; otherwise the first cleanup aborts the request and the ref blocks the retry                              |
| R8  | `localStorage` read into the store as is                                                                                   | Persisted state comes from an older build or a hand edit. Validate it in `persist`'s `merge` and fall back per field; `onRehydrateStorage` runs after the bad value is already in the store. A shape change bumps `version` and adds a `migrate`                 |

## Tests

The [testing cheat sheet](../docs/backend/conventions/testing-cheat-sheet.md) applies. Rules 1–3, 6, 7, 10 and 11 carry over as written; rule 11 is `test.each([{ name: '…' }])('$name', …)` here.

- Vitest everywhere, `jsdom` in `apps/ide`. A package gets a DOM environment with its first component test: copy the `test` block of `apps/ide/vite.config.ts`, setup file included.
- After every test, Testing Library unmounts what it rendered and spies are restored (`src/test-setup.ts`, `restoreMocks`). Vitest globals are off, so Testing Library's built-in cleanup never registers. Without the setup file the second test in a file sees the first test's DOM.
- Find elements by role and accessible name: `getByRole('button', { name: 'Next step' })`, then by label, then by text. No `data-testid`. A control a test can't find by role is an accessibility bug; fix the control.
- Reset a store in `beforeEach` (`usePlayer.setState(initial)`), never in `afterEach`. An `afterEach` in a test file runs before the setup file's cleanup, so the reset re-renders a mounted component outside `act`.
- The network goes through the MSW handlers in `apps/ide/src/mocks`, which are built from the OpenAPI examples. Don't stub `fetch` (test 4).
- Engine, view and navigation tests loop over `fixtureNames` from `@viz/fixtures`, not a hand-picked list (test 7).
- Type a mock from the module, `vi.fn<typeof loadTrace>()`, never from a signature written by hand.
- In an agent session Vitest hides console output from passing tests, so a React warning in a green run never prints. Run the file with `--reporter=default` when a test drives a portal, a ref or a Radix primitive.

## Dependencies

- Versions are exact; `saveExact` writes them that way. `peerDependencies` take ranges.
- A version installs only once it is 7 days old (`minimumReleaseAge`). Every install checks the lockfile against that, CI included. On `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, pin the newest version that is old enough (`pnpm view <pkg> time`) or wait. A security fix that can't wait goes in `minimumReleaseAgeExclude`, with the advisory and a removal date in a comment. Delete the entry by that date.
- Transitive dependencies from git URLs or tarballs are refused (`blockExoticSubdeps`).
- Install scripts don't run; that is pnpm's default. A dependency that breaks without its script gets an `allowBuilds` entry with a one-line reason.
- A package that uses `react-dom`, directly or through Radix, declares `react` and `react-dom` as peer and dev dependencies at the same version. `react`, `react-dom`, `@types/react` and `@types/react-dom` move together in every package.
- The stack is picked in §18.1. A library that does a job one there already does (state, data fetching, animation, layout) is a spec change first.

## Agent skills

`.claude/skills/` vendors three skills from vercel-labs (README, "Agent skills"). They are written for Next.js, so this file wins where they disagree:

- Memoize only under R1, even where `rerender-memo` or `rendering-hoist-jsx` suggests it.
- An effect reads changing callbacks through `useEffectEvent` (R2), not the ref pattern in `advanced-event-handler-refs`.
- Server data goes through TanStack Query (R6), never SWR (`client-swr-dedup`).
- Skip the `server-` rules, `next/dynamic` and anything about RSC or hydration. The IDE is a Vite app without SSR.
- A library a rule suggests, such as `better-all`, is a spec change first (Dependencies).

Don't edit the copies; a fix that matters here goes into this file.

## Traps

Code that looks right and isn't. When you hit a new one, add it here in the same commit: symptom, cause, fix.

- **A worker's `error` event doesn't mean the worker is dead.** It fires when the script fails to load, and the worker then never replies. It also fires for an uncaught error inside a running worker, which keeps serving. Through Comlink, a throw inside an exposed function rejects the call, but a worker that failed to load leaves every call pending. Clear loading state on every path, and treat only a worker that has never replied as dead.
- **React Compiler fails the build on a BigInt literal.** `1n` anywhere in a component stops the build with `Todo: (BuildHIR::lowerExpression) Handle BigIntLiteral expressions`. Do the BigInt math in a module-level function, which the compiler doesn't touch (`bitsOf` in `bits-view.tsx`).
- **React Compiler fails the build on a logical assignment.** `last.on ||= item.on` (and `&&=`, `??=`) inside a component or hook stops `pnpm build` and the dev server with `Todo: (BuildHIR::lowerExpression) Handle ||= operators`. Write it out: `last.on = last.on || item.on` (`SetCard` in `cards.tsx`).
- **React Compiler fails the build on a default in a destructured parameter.** `function Button({ asChild = false })` stops `pnpm build` with `Todo: (BuildHIR::lowerAssignment)`, but only once the app imports the component. Drop the default (`undefined` is falsy) or set it in the body.
- **React Compiler fails the build on a nested destructure in a `for…of` head, or on `import()`.** `for (const [key, [from, to]] of …)` stops the dev server with `Todo: Support non-trivial for..of inits`, and `import('./x.ts')` inside a component or its effect with `Todo: (BuildHIR::lowerExpression) Handle ImportExpression expressions`. Put both in module-level functions (`graphOf` and `loadCanvas` in `graph-view.tsx`).
- **sigma 4 imports fail outside a browser.** `sigma/rendering` reads `WebGL2RenderingContext` when it loads, so any test that imports it, even through `@viz/player`, fails with `ReferenceError` before a test runs. Only `graph-canvas.ts` imports sigma's runtime, and `graph-view.tsx` loads it with `import()`; other files take its types with `import type`, since an inline `type` specifier keeps the import.
- **Comlink drops what it can't clone.** A thrown error reaches the caller as a plain `Error` with only `name`, `message` and `stack`, so `instanceof` on a custom class fails; tell errors apart by `name` (`isTraceError` in `load.ts`). `proxy()` works only on a top-level argument, so a callback inside an object fails with `DataCloneError`; pass it as its own argument (`openManifest(manifest, refresh)`).
- **jsdom drives `requestAnimationFrame` from `setInterval`.** `vi.useFakeTimers({ toFake: ['setInterval'] })` also freezes animation frames, so a frame-throttled handler never runs. Advance the fake clock by a frame (`vi.advanceTimersByTimeAsync(16)`).
- **A persisted store writes storage on every `setState`.** Resetting `usePlayer` and then calling `persist.rehydrate()` reads back the defaults the reset just saved. To test a reload, `vi.resetModules()` and import the store again (`settings.test.tsx`).
- **A disabled button never opens its Radix tooltip.** Browsers send no pointer events to a disabled control, so `TooltipTrigger asChild` around `<Button disabled>` stays silent in exactly the state it should explain, such as Prev on the first step. Make a `<span className="inline-flex">` the trigger and put the button inside it.
- **CodeMirror under jsdom has no layout.** It measures text through `Range.getClientRects`, which jsdom lacks, so `@viz/player`'s `src/test-setup.ts` stubs it. Its gutter `domEventHandlers` find the line from the element's position, so in jsdom every click lands on line 1; listen on the marker's own DOM instead (`LineNumber` in `code-view.ts`). To put the caret on a line, collapse the selection into that `.cm-line` and fire `selectionchange` (`putCaret` in `code-pane.test.tsx`).
- **CodeMirror keeps its old line heights when `--code-font-size` changes.** `.cm-content` fills the pane (`min-height: 100%`), so its height doesn't change and `requestMeasure()` measures nothing new; the gutters stay a row height out of line with the text until the next step redraws. CodeMirror re-measures on a theme change, so the font size setting swaps a theme (`setFontSize` in `code-view.ts`).
- **`vi.waitFor` moves fake timers.** Under `vi.useFakeTimers`, each poll calls `vi.advanceTimersByTime(interval)`, so a countdown that started before the wait has already run part of its time when the wait returns. To test a timeout, start it inside `act` by setting the state that starts it, then advance by exact amounts (`the notice goes away…` in `goto.test.tsx`).
- **openapi-fetch keeps the `fetch` it was created with.** MSW in Node patches `globalThis.fetch` when `server.listen()` runs, which is after `api.ts` was imported, so the client's requests miss every handler. Create the client with `fetch: (request) => fetch(request)` (`api.ts`).
- **openapi-fetch's response types turn tuples into arrays.** Its `Readable<T>` maps every array, so the trace's `captureRanges` pairs come back as `number[][]` and don't fit the player's `[number, number][]`. Check them back into pairs (`toManifest` in `visualizer.tsx`); `--array-length` in codegen doesn't help.
- **TanStack Query keeps `isError` after a failed background refetch, with the old data.** A screen that checks `isError` first swaps a working page for an error when a refetch on focus fails, and unmounts what it held. Check `data === undefined` first (`Ide` in `ide.tsx`).
- **A new fixture directory doesn't reach the tests.** Vitest keeps transformed modules in `node_modules/.vitest-cache` (`fsModuleCache`), keyed by the module's own source, so `fixtures/index.ts` keeps the `import.meta.glob` file list it had and `fixtureNames` misses the new trace while every test passes. Run `pnpm exec vitest --clearCache` after adding or removing a fixture.
- **MSW's `delay()` barely waits in Node.** With no argument it waits 100–400 ms in the browser but 5 ms under Vitest, so `slow-tracing` runs its long-polls back to back and a test waiting for "Tracing…" can miss it. Prepend a handler that delays and falls through (`slowPolls` in `ide.test.tsx`).
- **React's dev build makes step timings meaningless.** It logs every component render for the Performance panel and diffs each changed prop deeply (`addObjectDiffToProperties`). 500 heap cards that each got the step's heap took 1 s a step under `pnpm dev` and 16 ms in a production build. Time steps on a production build; `?fixture=` is dev-only, so the measuring build swaps `main.tsx`'s `import.meta.env.DEV` check for one on `?fixture=` locally, with `VITE_FLAGS=visualize`.
- **Testing Library drops a space at the edge of an inline element in an accessible name.** `<span className="sr-only">points to </span>#o4` is named `points to#o4`, so `getByRole('button', { name: 'points to #o4' })` finds nothing. Put the space outside the span: `<span className="sr-only">points to</span> #o4` (`RefLabel` in `value-view.tsx`).
- **Prettier run inside a package ignores `web/.prettierignore`.** `prettier --write src` from `apps/ide` reformats `src/gen/`. Run it from `web/` (`pnpm fmt`).

## Before you hand back

1. `pnpm check` passed. Say so.
2. Contract touched => `make gen` ran and the generated code is in the diff.
3. A new view or state renders from a fixture in a test or a story.
4. A UI change went through the design system's [checklist](../docs/frontend/design-system.md#11-checklist-for-a-ui-change).
5. Re-read the diff as its reviewer: no memo hook without its reason (R1), no export nobody imports (T7), every comment has an E number.
