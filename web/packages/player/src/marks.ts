import type { StepState } from './engine.ts'
import type { Formatter } from './format.ts'
import type { HeapObject, Value } from './gen/trace.ts'
import type { GraphShape } from './graph.ts'
import {
  evaluate,
  indexText,
  lineFacts,
  type LineFacts,
  type SourceFacts,
  type Subscript,
} from './source-facts.ts'
import type { CardView } from './state-layout.ts'

export type Marker = { label: string; at: number; axis: number; outside: boolean }
export type Range = { from: number; to: number; label: string; empty: boolean }

// arrays: the int or bool arrays in scope at least as long as the graph, to colour and label nodes by
export type GraphMarks = {
  current: { name: string; at: number } | null
  checking: { name: string; from: number; to: number } | null
  arrays: { name: string; object: HeapObject }[]
  // the array nodes are coloured by until the student picks one
  colour: string | null
}

export type CardMarks = {
  graph: GraphMarks | null
  indexed: boolean
  markers: Marker[]
  hidden: number
  range: Range | null
  reads: string[]
  inferred: boolean
  narration: string | null
}

export const noMarks: CardMarks = {
  graph: null,
  indexed: false,
  markers: [],
  hidden: 0,
  range: null,
  reads: [],
  inferred: true,
  narration: null,
}

const shownMarkers = 4 // §19.4.1
const pairs = [
  ['l', 'r'],
  ['lo', 'hi'],
  ['L', 'R'],
  ['left', 'right'],
  ['i', 'j'],
] as const

type Scope = (name: string) => number | undefined

function intScope(values: Record<string, Value>): Scope {
  return (name) => {
    const v = values[name]
    if (v?.t !== 'int' || v.v === undefined || !/^-?\d+$/.test(v.v)) return undefined
    return Number(v.v)
  }
}

// once per step and per parse, not per card: synthetic-5000 7.9 => 4.8 ms p50 keydown to DOM (prod build)
const scopes = new WeakMap<StepState, Record<string, Value>>()
const subscripted = new WeakMap<SourceFacts, Set<string>>()
const rangeLoops = new WeakMap<
  SourceFacts,
  { header: number; loop: [number, number]; iterates: NonNullable<LineFacts['iterates']> }[]
>()

function scopeOf(state: StepState) {
  const hit = scopes.get(state)
  if (hit) return hit
  const values: Record<string, Value> = {}
  const frames = [...state.stack.filter((f) => f.kind === 'global'), state.stack.at(-1)]
  for (const f of frames) for (const l of f?.locals ?? []) values[l.name] = l.value
  scopes.set(state, values)
  return values
}

function arraysIn(facts: SourceFacts) {
  let set = subscripted.get(facts)
  if (!set) {
    set = new Set(Object.values(facts).flatMap((f) => f.subscripts.map((s) => s.array)))
    subscripted.set(facts, set)
  }
  return set
}

function cellKey(path: number[]) {
  return path.join(',')
}

export function isDefault(v: Value | undefined) {
  if (v === undefined || v.t === 'uninit') return true
  if (v.t === 'int' || v.t === 'float') return Number(v.v) === 0
  return v.t === 'bool' && v.v === 'false'
}

function names(card: CardView) {
  return new Set(card.referrers.filter((r) => /^[A-Za-z_][\w.]*$/.test(r)))
}

function shape(card: CardView) {
  const o = card.object
  if (card.view === 'matrix' && card.matrix) return [card.matrix.rows.length, card.matrix.columns]
  return [o.length ?? 0]
}

function markersOf(
  dims: number[],
  subscripts: Subscript[],
  scope: Scope,
  pins: string[],
): Pick<CardMarks, 'markers' | 'hidden' | 'range'> {
  const found = new Map<string, Marker>()
  const add = (axis: number, label: string, name: string, at: number, plain: boolean) => {
    const key = `${axis}|${name}`
    if (found.has(key) && !plain) return
    const size = dims[axis]!
    found.set(key, { label, at, axis, outside: at < 0 || at >= size })
  }
  for (const name of pins) {
    const v = scope(name)
    if (v !== undefined) add(0, name, name, v, true)
  }
  for (const s of subscripts) {
    s.indices.slice(0, dims.length).forEach((index, axis) => {
      if (index?.name == null) return
      const at = evaluate(index, scope)
      if (at !== null) add(axis, indexText(index), index.name, at, index.offset === 0)
    })
  }
  let range: Range | null = null
  if (dims.length === 1 && found.size > 0) {
    const pair = pairs.find(([a, b]) => scope(a) !== undefined && scope(b) !== undefined)
    if (pair) {
      const [a, b] = pair
      const [from, to] = [scope(a)!, scope(b)!]
      if (!found.has(`0|${a}`)) add(0, a, a, from, true)
      if (!found.has(`0|${b}`)) add(0, b, b, to, true)
      range = { from, to, label: `${a}..${b}`, empty: from > to }
    }
  }
  const all = [...found.values()]
  const markers = dims.flatMap((_, axis) =>
    all.filter((m) => m.axis === axis).slice(0, shownMarkers),
  )
  return { markers, hidden: all.length - markers.length, range }
}

// a 2-d read names its row's object (§19.9.2); a matrix folds its rows in, so their reads are its cells
function exactReads(card: CardView, state: StepState) {
  const rows = new Map(
    card.view === 'matrix' ? card.matrix?.rows.map((row) => [row.id, row.index]) : [],
  )
  return (state.access ?? []).flatMap((a) => {
    const row = rows.get(a.obj)
    if (a.mode !== 'r' || (a.obj !== card.id && row === undefined)) return []
    return [{ path: row === undefined ? a.path : [row, ...a.path], inferred: a.inferred === true }]
  })
}

function readsOf(card: CardView, subscripts: Subscript[], before: Scope, state: StepState) {
  const dims = shape(card)
  if ((state.access?.length ?? 0) > 0) {
    const access = exactReads(card, state)
    return {
      reads: [...new Set(access.map((a) => cellKey(a.path)))],
      inferred: access.some((a) => a.inferred),
    }
  }
  const reads = subscripts.flatMap((s) => {
    if (s.mode === 'w' || s.indices.length !== dims.length) return []
    const path = s.indices.map((i) => evaluate(i, before))
    if (path.some((p, axis) => p === null || p < 0 || p >= dims[axis]!)) return []
    return [cellKey(path as number[])]
  })
  return { reads: [...new Set(reads)], inferred: true }
}

export const readClass = 'outline-2 -outline-offset-2 outline-trace-read'

export function cellValue(o: HeapObject, index: number): Value | undefined {
  if (o.sparse) return o.sparse.items[String(index)] ?? o.sparse.default
  return o.items?.[index - (o.window?.start ?? 0)]
}

function narrationOf(
  card: CardView,
  subscripts: Subscript[],
  before: Scope,
  state: StepState,
  format: Formatter,
) {
  if (card.view !== 'matrix' || card.matrix === null) return null
  const matrix = card.matrix
  const text = (v: Value | undefined) => (isDefault(v) ? '·' : format.value(v!).text)
  const valueAt = (r: number, c: number, old: boolean) => {
    const row = matrix.rows[r]
    if (row === undefined) return undefined
    const was = state.before.cells[row.id]?.[String(c)]
    if (old && was !== undefined) return was
    return cellValue(state.heap[row.id]!, c)
  }
  const target = subscripts.find((s) => s.mode !== 'r' && s.indices.length === 2)
  if (!target) return null
  const [r, c] = target.indices.map((i) => evaluate(i, before))
  if (r == null || c == null) return null
  const row = matrix.rows[r]
  if (!row || !state.changed.cells[row.id]?.includes(String(c))) return null
  const reads = subscripts.filter((s) => s !== target && s.mode !== 'w' && s.indices.length === 2)
  const from = reads.flatMap((s) => {
    const [x, y] = s.indices.map((i) => evaluate(i, before))
    if (x == null || y == null || valueAt(x, y, true) === undefined) return []
    return [`${s.array}[${x}][${y}] = ${text(valueAt(x, y, true))}`]
  })
  const head = `${target.array}[${r}][${c}] = ${text(valueAt(r, c, false))} (was ${text(valueAt(r, c, true))})`
  if (from.length === 0) return head
  const list = from.length === 1 ? from[0] : `${from.slice(0, -1).join(', ')} and ${from.at(-1)}`
  return `${head} from ${list}`
}

function loopsIn(facts: SourceFacts) {
  let loops = rangeLoops.get(facts)
  if (!loops) {
    loops = Object.entries(facts).flatMap(([line, f]) =>
      f.iterates !== null && f.loop !== null
        ? [{ header: Number(line), loop: f.loop, iterates: f.iterates }]
        : [],
    )
    rangeLoops.set(facts, loops)
  }
  return loops
}

const colourNames = [
  'dist',
  'd',
  'depth',
  'dep',
  'vis',
  'visited',
  'used',
  'color',
  'col',
  'low',
  'tin',
]
const scalars = new Set(['int', 'bool', 'char', 'float'])

function graphMarks(
  card: CardView,
  shape: GraphShape,
  state: StepState,
  facts: SourceFacts | null,
): GraphMarks {
  const arrays = names(card)
  const values = scopeOf(state)
  const scope = intScope(values)
  const node = (n: number | null) => (n !== null && n >= 0 && n < shape.size ? n : null)
  const subscripts = [state.line, state.prevLine].flatMap((l) =>
    lineFacts(facts, l).subscripts.filter((s) => arrays.has(s.array) && s.indices.length > 0),
  )
  const loop =
    facts === null
      ? undefined
      : loopsIn(facts).findLast(
          (l) => arrays.has(l.iterates.array) && state.line >= l.loop[0] && state.line <= l.loop[1],
        )
  let current: GraphMarks['current'] = null
  for (const s of subscripts) {
    const at = node(evaluate(s.indices[0]!, scope))
    if (at !== null && s.indices[0]?.name != null) {
      current = { name: indexText(s.indices[0]), at }
      break
    }
  }
  if (current === null && loop !== undefined && loop.iterates.index?.name != null) {
    const at = node(evaluate(loop.iterates.index, scope))
    if (at !== null) current = { name: indexText(loop.iterates.index), at }
  }
  let checking: GraphMarks['checking'] = null
  const pair = subscripts.find((s) => s.indices.length === 2)
  if (pair && current !== null) {
    const row = card.object.items?.[current.at]
    const column = evaluate(pair.indices[1]!, scope)
    const cell =
      row?.id === undefined || column === null ? undefined : state.heap[row.id]?.items?.[column]
    const to = node(cell?.t === 'int' ? Number(cell.v) : null)
    if (to !== null)
      checking = {
        name: `${pair.array}[${current.name}][${indexText(pair.indices[1]!)}]`,
        from: current.at,
        to,
      }
  }
  if (checking === null && current !== null && loop !== undefined && state.line > loop.header) {
    const to = node(scope(loop.iterates.variable) ?? null)
    if (to !== null) checking = { name: loop.iterates.variable, from: current.at, to }
  }
  const candidates = Object.entries(values).flatMap(([name, v]) => {
    const o = v.t === 'ref' && v.id !== undefined && v.id !== card.id ? state.heap[v.id] : undefined
    if (o?.kind !== 'sequence' || (o.length ?? 0) < shape.size) return []
    const sample = o.sparse ? [o.sparse.default] : (o.items ?? [])
    return sample.length > 0 && sample.every((x) => scalars.has(x.t)) ? [{ name, object: o }] : []
  })
  const rank = (name: string) => {
    const k = colourNames.indexOf(name)
    return k < 0 ? colourNames.length : k
  }
  const sorted = candidates.sort((a, b) => rank(a.name) - rank(b.name))
  const colour =
    sorted[0] !== undefined && rank(sorted[0].name) < colourNames.length ? sorted[0].name : null
  return { current, checking, arrays: sorted, colour }
}

export function marksFor(
  card: CardView,
  state: StepState,
  facts: SourceFacts | null,
  format: Formatter,
  pins: string[],
): CardMarks {
  if (card.object.kind !== 'sequence') return noMarks
  const graph =
    card.graph !== null && card.view === card.graph.kind
      ? graphMarks(card, card.graph.shape, state, facts)
      : null
  const arrays = names(card)
  const indexed = facts !== null && [...arrays].some((a) => arraysIn(facts).has(a))
  const access = exactReads(card, state).length > 0
  if (!indexed && !access && pins.length === 0) return { ...noMarks, graph }
  const on = (line: number | null) =>
    lineFacts(facts, line).subscripts.filter((s) => arrays.has(s.array))
  const ran = on(state.prevLine)
  const scope = intScope(scopeOf(state))
  const before = intScope(state.before.scope)
  return {
    graph,
    indexed,
    ...markersOf(shape(card), [...on(state.line), ...ran], scope, pins),
    ...readsOf(card, ran, before, state),
    narration: narrationOf(card, ran, before, state, format),
  }
}

export function stringMarkers(state: StepState, facts: SourceFacts | null) {
  const out: Record<string, Marker[]> = {}
  if (facts === null) return out
  const values = scopeOf(state)
  const subscripts = [state.line, state.prevLine].flatMap((l) => lineFacts(facts, l).subscripts)
  for (const [name, v] of Object.entries(values)) {
    if (v.t !== 'str' || v.v === undefined) continue
    const on = subscripts.filter((s) => s.array === name && s.indices.length === 1)
    if (on.length === 0) continue
    const { markers } = markersOf([[...v.v].length], on, intScope(values), [])
    if (markers.length > 0) out[name] = markers
  }
  return out
}
