import { syntaxHighlighting, type LanguageSupport } from '@codemirror/language'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type StateEffectType,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  keymap,
  showTooltip,
  type Tooltip,
} from '@codemirror/view'
import { tagHighlighter, tags } from '@lezer/highlight'
import { cn } from '@viz/ui'
import { fontSizes, type Settings } from './store.ts'

const markKinds = ['executed', 'next', 'error'] as const
type Mark = (typeof markKinds)[number]
export type LineMarks = Record<Mark, number | null>
export type Lines = { marks: LineMarks; breakpoints: readonly number[] }
type LineHits = { counts: Record<string, number>; recordedOnly: boolean }

const markStyle: Record<Mark, { glyph: string; label: string; glyphClass: string; line: string }> =
  {
    executed: {
      glyph: '▶',
      label: 'just ran',
      glyphClass: 'text-trace-executed-mark',
      line: 'bg-trace-executed',
    },
    next: {
      glyph: '▷',
      label: 'runs next',
      glyphClass: 'text-trace-next',
      line: 'outline -outline-offset-1 outline-trace-next',
    },
    error: {
      glyph: '!',
      label: 'error',
      glyphClass: 'font-semibold text-trace-error-mark',
      line: 'bg-trace-error',
    },
  }

const heatLevels = [
  [0.75, 'bg-trace-heat/40'],
  [0.5, 'bg-trace-heat/25'],
  [0.25, 'bg-trace-heat/15'],
] as const

const languages = new Map<string, () => Promise<LanguageSupport>>([
  ['python', () => import('@codemirror/lang-python').then((m) => m.python())],
  ['c_cpp', () => import('@codemirror/lang-cpp').then((m) => m.cpp())],
])

export function loadLanguage(editorMode: string): Promise<Extension> {
  return languages.get(editorMode)?.() ?? Promise.resolve([])
}

const language = new Compartment()

export function setLanguage(view: EditorView, extension: Extension) {
  view.dispatch({ effects: language.reconfigure(extension) })
}

// codemirror re-measures line heights on a theme change, not when --code-font-size changes
const sizeThemes = new Map(
  fontSizes.map((size) => [size, EditorView.theme({ '&': { fontSize: 'var(--code-font-size)' } })]),
)
const size = new Compartment()

export function setFontSize(view: EditorView, fontSize: Settings['fontSize']) {
  view.dispatch({ effects: size.reconfigure(sizeThemes.get(fontSize)!) })
}

const highlighter = tagHighlighter([
  {
    tag: [
      tags.keyword,
      tags.processingInstruction,
      tags.standard(tags.typeName),
      tags.bool,
      tags.null,
      tags.self,
    ],
    class: 'text-syntax-keyword',
  },
  { tag: [tags.string, tags.escape], class: 'text-syntax-string' },
  { tag: tags.comment, class: 'text-syntax-comment' },
])

function latest<T>(effect: StateEffectType<T>, initial: T) {
  return StateField.define<T>({
    create: () => initial,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(effect)) value = e.value
      return value
    },
  })
}

export const setLines = StateEffect.define<Lines>()
const showHits = StateEffect.define<number | null>()
const setFocused = StateEffect.define<boolean>()
const lines = latest<Lines>(setLines, {
  marks: { executed: null, next: null, error: null },
  breakpoints: [],
})
const hovered = latest(showHits, null)
const focused = latest(setFocused, false)

function markAt(marks: LineMarks, line: number) {
  return markKinds.find((kind) => marks[kind] === line)
}

export function focusLine({ next, error, executed }: LineMarks) {
  return next ?? error ?? executed
}

function hitText(count: number, total: number, recordedOnly: boolean) {
  const share = (count / total) * 100
  return [
    count === 1 ? 'ran once' : `ran ${count.toLocaleString('en')} times`,
    `${share < 1 ? 'under 1' : Math.round(share)}% of all lines run`,
    ...(recordedOnly ? ['recorded steps only'] : []),
  ].join(' · ')
}

class Label extends WidgetType {
  text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  override eq(other: Label) {
    return other.text === this.text
  }
  override toDOM() {
    const el = document.createElement('span')
    el.className = 'sr-only'
    el.textContent = this.text
    return el
  }
}

function decorate(state: EditorState) {
  const { marks, breakpoints } = state.field(lines)
  const notes = new Map<number, string[]>()
  for (const kind of markKinds) {
    const n = marks[kind]
    if (n !== null) notes.set(n, [markStyle[kind].label])
  }
  for (const n of breakpoints) notes.set(n, [...(notes.get(n) ?? []), 'breakpoint'])

  const ranges: Range<Decoration>[] = []
  for (const [n, texts] of notes) {
    const { from } = state.doc.line(n)
    const label = new Label(`Line ${n}, ${texts.join(', ')}: `)
    ranges.push(Decoration.widget({ widget: label, side: -1 }).range(from))
    const kind = markAt(marks, n)
    if (kind) ranges.push(Decoration.line({ class: markStyle[kind].line }).range(from))
  }
  return Decoration.set(ranges, true)
}

class Glyph extends GutterMarker {
  kind: Mark
  constructor(kind: Mark) {
    super()
    this.kind = kind
  }
  override eq(other: Glyph) {
    return other.kind === this.kind
  }
  override toDOM() {
    const el = document.createElement('span')
    el.className = markStyle[this.kind].glyphClass
    el.textContent = markStyle[this.kind].glyph
    return el
  }
}

class LineNumber extends GutterMarker {
  line: number
  breakpoint: boolean
  toggle: (line: number) => void
  constructor(line: number, breakpoint: boolean, toggle: (line: number) => void) {
    super()
    this.line = line
    this.breakpoint = breakpoint
    this.toggle = toggle
  }
  override eq(other: LineNumber) {
    return other.line === this.line && other.breakpoint === this.breakpoint
  }
  override toDOM() {
    const el = document.createElement('span')
    el.className = 'flex cursor-pointer justify-end gap-1'
    const dot = document.createElement('span')
    dot.className = 'w-[1ch] text-foreground'
    dot.textContent = this.breakpoint ? '●' : ''
    el.append(dot, String(this.line))
    el.addEventListener('click', () => this.toggle(this.line))
    return el
  }
}

class HitCount extends GutterMarker {
  line: number
  count: number
  heat: string | undefined
  constructor(line: number, count: number, heat: string | undefined) {
    super()
    this.line = line
    this.count = count
    this.heat = heat
  }
  override eq(other: HitCount) {
    return other.line === this.line && other.count === this.count
  }
  override toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = cn(
      'rounded-sm px-1',
      this.heat === undefined ? 'text-muted-foreground' : [this.heat, 'text-foreground'],
    )
    el.textContent = `×${this.count.toLocaleString('en')}`
    el.addEventListener('mouseenter', () => view.dispatch({ effects: showHits.of(this.line) }))
    el.addEventListener('click', () => view.dispatch({ effects: showHits.of(this.line) }))
    el.addEventListener('mouseleave', () => view.dispatch({ effects: showHits.of(null) }))
    return el
  }
}

class Spacer extends GutterMarker {
  text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  override toDOM() {
    return document.createTextNode(this.text)
  }
}

function lineAt(view: EditorView, pos: number) {
  return view.state.doc.lineAt(pos).number
}

function hitCounts({ counts, recordedOnly }: LineHits): Extension {
  const values = Object.values(counts)
  const total = values.reduce((sum, n) => sum + n, 0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const heat = (count: number) =>
    max === min ? undefined : heatLevels.find(([at]) => (count - min) / (max - min) >= at)?.[1]
  const tooltip = showTooltip.compute([hovered, focused, 'selection'], (state): Tooltip | null => {
    const n =
      state.field(hovered) ??
      (state.field(focused) ? state.doc.lineAt(state.selection.main.head).number : null)
    const count = n === null ? undefined : counts[n]
    if (n === null || count === undefined) return null
    return {
      pos: state.doc.line(n).from,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'px-2 py-1 font-mono text-xs'
        dom.textContent = hitText(count, total, recordedOnly)
        return { dom }
      },
    }
  })
  return [
    gutter({
      class: 'cm-hits',
      lineMarker(view, block) {
        const n = lineAt(view, block.from)
        const count = counts[n]
        return count === undefined ? null : new HitCount(n, count, heat(count))
      },
      initialSpacer: () => new Spacer(`×${max.toLocaleString('en')}`),
    }),
    hovered,
    focused,
    EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing)),
    tooltip,
  ]
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--code-font-size)',
    color: 'var(--content-primary)',
    backgroundColor: 'var(--bg-surface)',
  },
  '&.cm-focused': { outline: 'none' },
  '&:has(.cm-content:focus-visible)': {
    outline: '2px solid var(--border-focus)',
    outlineOffset: '-2px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
    lineHeight: 'var(--code-line-height)',
  },
  '.cm-content': { caretColor: 'var(--content-primary)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--content-secondary)',
    border: 'none',
  },
  '.cm-marks .cm-gutterElement': { paddingLeft: 'var(--pane-padding)', textAlign: 'center' },
  '.cm-hits .cm-gutterElement': { padding: '0 4px', textAlign: 'right' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-raised)',
    color: 'var(--content-primary)',
    border: 'none',
    borderRadius: '12px',
    boxShadow: 'var(--elevation-popover)',
  },
})

export function createCodeView(
  parent: HTMLElement,
  options: {
    code: string
    lines: Lines
    hits: LineHits | null
    onToggle: (line: number) => void
  },
) {
  const { code, hits, onToggle } = options
  const state = EditorState.create({
    doc: code,
    extensions: [
      EditorState.readOnly.of(true),
      EditorView.contentAttributes.of({ 'aria-label': 'Code' }),
      language.of([]),
      size.of([]),
      syntaxHighlighting(highlighter),
      lines.init(() => options.lines),
      EditorView.decorations.compute([lines], decorate),
      gutter({
        class: 'cm-marks',
        lineMarker(view, block) {
          const kind = markAt(view.state.field(lines).marks, lineAt(view, block.from))
          return kind ? new Glyph(kind) : null
        },
        lineMarkerChange: (u) => u.startState.field(lines) !== u.state.field(lines),
        initialSpacer: () => new Glyph('executed'),
      }),
      gutter({
        class: 'cm-lineNumbers',
        lineMarker(view, block) {
          const n = lineAt(view, block.from)
          return new LineNumber(n, view.state.field(lines).breakpoints.includes(n), onToggle)
        },
        lineMarkerChange: (u) =>
          u.startState.field(lines).breakpoints !== u.state.field(lines).breakpoints,
        initialSpacer: (view) => new LineNumber(view.state.doc.lines, true, onToggle),
      }),
      hits === null ? [] : hitCounts(hits),
      keymap.of([
        {
          key: 'Enter',
          run: (view) => {
            onToggle(lineAt(view, view.state.selection.main.head))
            return true
          },
        },
      ]),
      theme,
    ],
  })
  const focus = focusLine(options.lines.marks)
  return new EditorView({
    parent,
    state,
    scrollTo: focus === null ? undefined : EditorView.scrollIntoView(state.doc.line(focus).from),
  })
}

export function scrollToLine(view: EditorView, line: number) {
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from) })
}
