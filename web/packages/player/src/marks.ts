import type { StepState } from './engine.ts'
import type { Formatter } from './format.ts'
import type { HeapObject, Value } from './gen/trace.ts'
import { evaluate, indexText, lineFacts, type SourceFacts, type Subscript } from './source-facts.ts'
import type { CardView } from './state-layout.ts'

export type Marker = { label: string; at: number; axis: number; outside: boolean }
export type Range = { from: number; to: number; label: string; empty: boolean }

export type CardMarks = {
  indexed: boolean
  markers: Marker[]
  hidden: number
  range: Range | null
  reads: string[]
  inferred: boolean
  narration: string | null
}

export const noMarks: CardMarks = {
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

// per step and per parse, not per card: synthetic-5000's 500 cards with a 500-local globals frame
const scopes = new WeakMap<StepState, Record<string, Value>>()
const subscripted = new WeakMap<SourceFacts, Set<string>>()

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

function readsOf(card: CardView, subscripts: Subscript[], before: Scope, state: StepState) {
  const dims = shape(card)
  const access = state.access?.filter((a) => a.obj === card.id && a.mode === 'r')
  if (access !== undefined && (state.access?.length ?? 0) > 0) {
    return {
      reads: access.map((a) => cellKey(a.path.map(Number))),
      inferred: access.some((a) => a.inferred === true),
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

export function marksFor(
  card: CardView,
  state: StepState,
  facts: SourceFacts | null,
  format: Formatter,
  pins: string[],
): CardMarks {
  if (card.object.kind !== 'sequence') return noMarks
  const arrays = names(card)
  const indexed = facts !== null && [...arrays].some((a) => arraysIn(facts).has(a))
  const access = state.access?.some((a) => a.obj === card.id) === true
  if (!indexed && !access && pins.length === 0) return noMarks
  const on = (line: number | null) =>
    lineFacts(facts, line).subscripts.filter((s) => arrays.has(s.array))
  const ran = on(state.prevLine)
  const scope = intScope(scopeOf(state))
  const before = intScope(state.before.scope)
  return {
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
