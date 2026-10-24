# Design system

The visual rules for the web app: what each token means, which one to reach for, and how a trace step is drawn. The code lives in [web/packages/ui](../../web/packages/ui/). The look: fill instead of stroke, ruled panes with gapped crossings, mono uppercase labels, an electric-blue accent, a white canvas in light mode and a black one in dark.

Spec anchors: §5.10 (accessibility), §19.3 (display options), §19.10 (visual language), §13 (browser support).

## 1. Principles

**Fill, not stroke.** Surfaces separate by background. Cards, the code pane and the input and output panels sit on `bg-card` or `bg-muted`, with no border. A bordered panel inside a white canvas is two lines doing one tone's job.

**One declaration, both themes.** Semantic tokens flip with the theme. A component written in them follows the theme by itself. If you need a dark-mode rule, a token is missing; add it to the semantic layer instead.

**Colour is never the only cue (§19.10).** Every trace state has a mark as well as a colour: `▶ ▷ ! * · [x] (x) ▼`. Changed values are also bold. A student with deuteranopia reads the same step you do.

**The layout never moves between steps.** Values change; positions don't. The only step animation is a 150 ms highlight fade.

**The frame is the layout.** Panes are split by 1px rules that stop short of each other where they cross, with a small square in the gap. The rules are pseudo-elements, never borders, because a border can't be segmented.

## 2. Tokens

Three layers, one file each in `web/packages/ui/src/styles/`:

| Layer | File | Holds | Use in a component? |
|---|---|---|---|
| Primitives | `primitives.css` | Raw values: Radix slate, the brand blue, Okabe–Ito hues per theme, font stacks | Never |
| Semantic | `semantic.css` | Named by job, flips with the theme: `--bg-*`, `--content-*`, `--border-*`, `--trace-*`, `--elevation-*` | Through Tailwind |
| Component | `components.css` | Frame, code pane, density, motion | Yes |

`theme.css` maps the semantic layer onto Tailwind utilities. Tailwind's default palette and shadows are switched off (`--color-*: initial`), so `bg-blue-500` doesn't exist and every colour comes from a token that flips with the theme. A colour that only works in one theme can't be written.

The generic names follow shadcn/ui, so a component added with `shadcn add` renders on-system unchanged:

| Utility | Token | For |
|---|---|---|
| `bg-background` | `--bg-canvas` | The page |
| `bg-card`, `bg-muted` | `--bg-surface` | Recessed panels: heap cards, code pane, input and output |
| `bg-accent` | `--bg-surface-alt` | Hover on a surface row |
| `bg-popover` | `--bg-raised` | Menus, dialogs, tooltips |
| `bg-primary` (+ `-hover`, `-press`) | `--bg-fill-brand` | Primary buttons |
| `bg-secondary` (+ `-hover`, `-press`) | `--bg-fill-subtle` | Secondary buttons, chips |
| `bg-destructive` (+ `-hover`, `-press`) | `--bg-fill-danger` | Destructive buttons |
| `text-foreground`, `text-muted-foreground`, `text-faint` | `--content-primary`, `-secondary`, `-tertiary` | Reading order. `faint` is for marks and placeholders, never for text a student must read. |
| `text-primary-foreground` | `--content-on-fill` | Text on a filled button |
| `text-brand`, `text-danger`, `text-warning`, `text-success` | `--content-*` | Status text. Use these for text, not the fill utilities. |
| `bg-brand-subtle`, `bg-danger-subtle`, `bg-warning-subtle`, `bg-success-subtle` | `--bg-*-subtle` | Selected rows, banners |
| `border-border`, `border-border-strong`, `border-input` | `--border-subtle`, `-default`, `-control` | Rules, the table header rule, form controls |
| `ring-ring`, `outline-ring` | `--border-focus` | Focus |
| `shadow-raised`, `shadow-popover` | `--elevation-*` | Only for things that lift |

**Fill and text are separate tokens.** `bg-primary` is the button fill. `text-brand` is brand-coloured text. In dark mode they differ, because the fill blue is too dark to read as text on black.

**Check that a token exists before you use it.** `var(--name, fallback)` fails silently: the fallback becomes the value in both themes. Grep `semantic.css` for the name first.

## 3. Colour

**Neutrals** are Radix Colors slate: a grey with a slight blue bias that sits with the accent. The canvas is pure white in light mode and pure black in dark.

**Brand** is an electric blue: `#1f3dff` light, `#2f52ff` dark (fill) and `#7090ff` dark (text). It marks the current step: the executed line, changed values and the primary action.

**Trace marks** (§19.10) take their hues from Okabe–Ito, the colour-blind-safe palette the spec asks for. Light values are darkened until marks reach 3:1 against their own tint and text reaches 4.5:1.

| Meaning | Utility | Mark | Light | Dark |
|---|---|---|---|---|
| Line just executed | `bg-trace-executed`, `text-trace-executed-mark` | `▶` | band `#e1ebff`, mark `#1f3dff` | band `#050f42`, mark `#7090ff` |
| Next line | `outline-trace-next`, `text-trace-next` | `▷` | `#c28500` | `#e69f00` |
| Written this step | `bg-trace-write`, `text-trace-write-mark` | `[x]`, bold | fill `#fae0d3`, mark `#d55e00` | fill `#361200`, mark `#e0691c` |
| Read this step (inferred) | `outline-trace-read` | `(x)` | `#009e73` | `#14a97e` |
| Changed since the previous step | `bg-trace-changed`, bold | `*` | `#e1ebff` | `#050f42` |
| Error | `bg-trace-error`, `text-trace-error-mark` | `!` | band `#ffe8e6`, text `#cb2936` | band `#370508`, text `#e95a5b` |
| Index marker | `text-trace-index` | `▼` | `#9f5d81` | `#cc79a7` |
| Not set, or default | `text-trace-unset` | `·` | slate 9 | slate dark 9 |
| Reference arrow / highlighted | `stroke-trace-arrow`, `stroke-trace-arrow-active` | `●──▶` | slate 9, brand | slate dark 9, brand |
| Hit-count heat | `bg-trace-heat/15` … `/40` | `×n` | `#c28500` | `#e69f00` |

**Syntax** colours stay off the trace hues the code pane already uses (blue, amber, red). Keywords, strings and comments get a colour; everything else is `text-foreground`.

| Meaning | Utility | Light | Dark |
|---|---|---|---|
| Keyword, also `#include`, `int`, `True`, `None`, `nullptr` | `text-syntax-keyword` | `#8d4b70` | `#cc79a7` |
| String, with its escapes | `text-syntax-string` | `#006c4f` | `#1fae84` |
| Comment | `text-syntax-comment` | slate 11 | slate dark 11 |

**Contrast is tested.** [tokens.test.ts](../../web/packages/ui/src/tokens.test.ts) resolves every token in both themes and asserts the pairs: 4.5:1 for text, 3:1 for marks, outlines and form controls (WCAG 2.2 AA, 1.4.3 and 1.4.11). Change a value, run `pnpm test`. When a pair fails, change the value. Don't drop the pair.

## 4. Typography

| Family | Role | Weights loaded |
|---|---|---|
| **Albert Sans** (SIL OFL) | UI text: buttons, narration, banners, dialogs | Variable, 100–900 |
| **IBM Plex Mono** (SIL OFL) | Code, values, pane labels, step counters, status bar | 400, 500, 600 |

Fonts load from npm (`@fontsource`), so nothing calls a font CDN and only the subsets a page uses are downloaded. Plex Mono's 600 is loaded because changed values are bold. Never style mono above 600: the browser would fake it.

| Role | Size / line | Weight | Family | Utility |
|---|---|---|---|---|
| Pane label (`STACK`, `HEAP`, `WATCH`, `STDIN`) | 12 / 16, uppercase, 0.04em | 500 | Mono | `mono-label text-muted-foreground` |
| UI body (default) | 14 / 20 | 400 | Sans | `text-sm` (body default) |
| Code pane and values | `--code-font-size` / `--code-line-height` | 400; changed 600 | Mono | `font-mono text-(length:--code-font-size)` |
| Narration line | 14 / 20 | 400 | Sans | `text-sm` |
| Dialog title | 20 / 28 | 500 | Sans | `text-xl font-medium` |
| State screen headline | 24 / 32 | 500 | Sans | `text-2xl font-medium` |
| Status bar, metadata | 12 / 16 | 400 | Mono | `font-mono text-xs` |

Digits in mono already line up. In sans tables, add `tabular-nums`.

## 5. Layout, frame and density

```css
--frame-rule: var(--border-subtle); /* the pane rules */
--frame-gap: 6px;                    /* how far rules stop short of each other */
--frame-mark: 3px;                   /* the square in the gap */
```

Rules between panes (code | state, controls, input | output, status bar) are 1px pseudo-elements in `--frame-rule`. Where two rules cross, both stop `--frame-gap` short and a `--frame-mark` square sits in the gap. A hidden pane takes its crossing with it: put the mark on the pane it belongs to.

The display options (§19.3) are data attributes on `<html>`, and the component tokens follow them:

| Attribute | Values | Changes |
|---|---|---|
| `data-theme` | `light` (default), `dark` | Every semantic token |
| `data-density` | `compact` (default), `comfortable` | `--row-height` 24 → 30px, `--cell-size` 32 → 40px, `--pane-padding` 12 → 16px |
| `data-font-size` | `s`, `m` (default), `l` | `--code-font-size` 13 / 14 / 16px, `--code-line-height` 20 / 22 / 24px |

FE-02 §4 owns the settings that set these attributes, including the system theme option.

The app shell takes its height from `dvh` (`h-dvh`, `min-h-dvh`), never `vh` or `h-screen`. On a phone, `100vh` includes the strip under the browser's address bar, so anything pinned to the bottom, such as the step controls, sits behind it.

## 6. Shape and elevation

| Radius | Utility | Where |
|---|---|---|
| Full | `rounded-full` | Buttons, icon buttons, chips, the step slider thumb |
| 24px | `rounded-3xl` | Dialog panels |
| 16px | `rounded-2xl` | Large panels |
| 12px | `rounded-xl` | Heap cards, frame tables, popovers, rows |
| 4px | `rounded-sm` | Array and matrix cells |

Shadows only for things that lift: `shadow-raised` for a card on hover, `shadow-popover` for menus and dialogs. In dark mode both become a 1px ring, because a black shadow vanishes on a black canvas.

## 7. Components

**Button** (`@viz/ui`): pill-shaped, colour-only transitions.

```tsx
<Button variant="primary">Visualize</Button>
<Button size="icon" variant="ghost" aria-label="Next step"><ArrowRight /></Button>
<Button asChild variant="secondary"><a href={permalink}>Open in new tab</a></Button>
```

- Variants: `primary`, `secondary` (default), `ghost`, `danger`. Sizes: `sm`, `md` (default), `lg`, `icon` (a 36px circle with an 18px glyph).
- States are `:hover`, `:active` and `:focus-visible`. Never style `:focus`: it fires on click.
- Icon-only buttons need an `aria-label`.

**Stack frames** are tables ruled by row, with no filled header. The header row takes `border-border-strong` and body rows `border-border`. The active frame gets a 2px brand outline as well as being last in the stack.

**Code pane** (`code-view.ts`, CodeMirror 6) sits on `bg-muted`. Gutters, left to right: the step mark (`▶ ▷ !`), the breakpoint `●` with the line number, and `×n` hits. The line just run gets `bg-trace-executed`, the next line `outline-trace-next`, the error line `bg-trace-error`. A `×n` cell is tinted `bg-trace-heat/15`, `/25` or `/40` by where its count sits between the run's lowest and highest, and its text turns `text-foreground` on a tint; when every line ran equally often, nothing is tinted. A marked line starts with a screen-reader label such as "Line 9, just ran:".

**Heap cards** sit on `bg-card` with no border, `rounded-xl`. The title is `#id kind · len n` in mono.

**Adding a shadcn component:** `shadcn add` output works as is. Keep its structure, and swap any colour it hard-codes for a token.

## 8. Motion

| What | Duration | Token |
|---|---|---|
| Highlight fade on changed values and lines | 150 ms | `--duration-fade` |
| Button and control colour | 200 ms | `--duration-control` |

Use the tokens (`duration-(--duration-fade)`), not literals. Under `prefers-reduced-motion: reduce` both are 0 ms, so a component that uses them needs no extra rule. Nothing changes width or position between steps.

Transition colour and opacity only, and name the property: `transition-colors`, `transition-opacity`. Never `transition-all`: it also animates width, height and position, and a cell easing to its new width is the movement this section rules out. Students step, scrub and press shortcuts hundreds of times a session, so those actions get the 150 ms fade and nothing else.

## 9. Dark mode

- `semantic.css` defines light values on `:root` and `[data-theme='light']`, and dark values on `[data-theme='dark']`. The app sets the attribute on `<html>`; any element can set it to force a theme for its subtree, as a Storybook side-by-side does.
- Don't use Tailwind's `dark:` variant. Write the rule once with a token.
- `light-dark()` would avoid the attribute, but it needs Safari 17.5, and §13 supports iOS Safari 17.0.
- Check contrast on the black canvas specifically. The dark ramp is not a mirror of the light one; `tokens.test.ts` covers the pairs we know about.

## 10. Accessibility

- Contrast: 4.5:1 for text, 3:1 for marks, outlines and control borders, in both themes. It's tested.
- Every control is reachable by keyboard. Focus shows as a 2px `--border-focus` outline with a 2px offset, from the base layer.
- Every trace colour has its mark (§19.10). Every icon-only control has a label.
- Motion follows `prefers-reduced-motion` through the duration tokens.
- Touch screens can't hover, and Tailwind v4 applies `hover:` only on devices that can. Anything revealed on hover, such as a pointer's address (§5.4) or a line's share of all hits (§19.3), also opens on focus and on tap.
- Zoom stays on: the viewport tag never sets `maximum-scale` or `user-scalable=no`. Text inputs on touch screens use 16px text or larger, or iOS Safari zooms in when they take focus.

## 11. Checklist for a UI change

- [ ] Colours come from utilities or semantic tokens; no hex, no primitives, no `dark:`.
- [ ] Any new colour pair is in `tokens.test.ts`, and `pnpm test` passes.
- [ ] Every trace state shows its mark as well as its colour.
- [ ] Checked in light and dark, compact and comfortable, font sizes S and L.
- [ ] Nothing moves between steps; any animation uses the duration tokens and names its property (no `transition-all`).
- [ ] Focus is visible on every new control; icon-only controls have an `aria-label`.
- [ ] Anything shown on hover also shows on focus and on tap.
- [ ] At phone width: the shell uses `dvh`, text inputs are 16px or larger, and zoom still works.
