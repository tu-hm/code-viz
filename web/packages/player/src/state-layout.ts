import type { StepState } from './engine.ts'
import type { Container, Formatter } from './format.ts'
import type { Frame, HeapObject, Local, Value } from './gen/trace.ts'
import type { ViewAs } from './store.ts'

export type Reads = { drawn: string[]; named: string[] }

export type FrameView = { frame: Frame; locals: Local[]; hidden: number; reads: Reads }

export type Table = {
  columns: string[]
  rows: { index: number; id: string; cells: Value[] }[]
}

export type Matrix = { rows: { index: number; id: string }[]; columns: number }

export type CardView = {
  id: string
  object: HeapObject
  referrers: string[]
  variable: string | undefined
  unreachable: boolean
  table: Table | null
  matrix: Matrix | null
  container: Container | null
  view: ViewAs
  reads: Reads
}

export type Look = {
  format: Formatter
  heap: Record<string, HeapObject>
  inline: Record<string, string>
  nested: ReadonlySet<string>
  changed: StepState['changed']['cells']
  highlight: boolean
  addresses: boolean
}

export type StateLayout = {
  frames: FrameView[]
  cards: CardView[]
  inline: Record<string, string>
  nested: ReadonlySet<string>
}

type Place = { label: string; variable?: string; object?: string; pointer: boolean }
type Edge = { value: Value; place: Place }

function target(v: Value) {
  if (v.t === 'ref' && v.id !== undefined) return { id: v.id, pointer: false }
  if (v.t === 'ptr' && v.target !== undefined) return { id: v.target, pointer: true }
  return null
}

export function inlineChanged(value: Value, look: Look) {
  const to = target(value)
  return to !== null && to.id in look.inline && (look.changed[to.id]?.length ?? 0) > 0
}

export function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined) {
  if (a === b) return true
  return (
    a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => x === b[i])
  )
}

export function sameReads(a: Reads, b: Reads, x: Look, y: Look) {
  if (x.format !== y.format || x.highlight !== y.highlight || x.addresses !== y.addresses) {
    return false
  }
  if (!sameList(a.drawn, b.drawn) || !sameList(a.named, b.named)) return false
  const sameStatus = (id: string) =>
    x.inline[id] === y.inline[id] &&
    x.nested.has(id) === y.nested.has(id) &&
    Object.hasOwn(x.heap, id) === Object.hasOwn(y.heap, id)
  return (
    a.drawn.every(
      (id) => x.heap[id] === y.heap[id] && sameList(x.changed[id], y.changed[id]) && sameStatus(id),
    ) &&
    a.named.every(
      (id) =>
        sameStatus(id) && (x.inline[id] === undefined || sameList(x.changed[id], y.changed[id])),
    )
  )
}

function scalar(v: Value) {
  return !['ref', 'ptr', 'uninit', 'unavailable'].includes(v.t)
}

function children(id: string, o: HeapObject, format: Formatter): Edge[] {
  const edges: Edge[] = []
  const add = (value: Value, label: () => string) => {
    if (target(value)) edges.push({ value, place: { label: label(), object: id, pointer: false } })
  }
  const start = o.window?.start ?? 0
  for (const [i, value] of (o.items ?? []).entries()) {
    add(value, () => (o.kind === 'sequence' ? `#${id}[${start + i}]` : `#${id}`))
  }
  for (const e of o.entries ?? []) {
    add(e.key, () => `#${id}`)
    add(e.value, () => `#${id}[${format.value(e.key).text}]`)
  }
  for (const f of o.fields ?? []) add(f.value, () => `#${id}.${f.name}`)
  return edges
}

function walk(roots: Edge[], heap: Record<string, HeapObject>, format: Formatter) {
  const reached = new Map<string, Place[]>()
  const todo = [...roots]
  for (let k = 0; k < todo.length; k++) {
    const edge = todo[k]!
    const to = target(edge.value)
    if (to === null) continue
    const place = { ...edge.place, pointer: to.pointer }
    const places = reached.get(to.id)
    if (places) {
      places.push(place)
      continue
    }
    reached.set(to.id, [place])
    const o = heap[to.id]
    if (o) todo.push(...children(to.id, o, format))
  }
  return reached
}

function frameRoots(frames: Frame[], include: (l: Local) => boolean): Edge[] {
  return frames.flatMap((f) => [
    ...f.locals
      .filter(include)
      .map((l) => ({ value: l.value, place: { label: l.name, variable: l.name, pointer: false } })),
    ...(f.returnValue
      ? [{ value: f.returnValue, place: { label: 'return', pointer: false } }]
      : []),
  ])
}

function targets(values: Value[]) {
  return values.flatMap((v) => {
    const to = target(v)
    return to === null ? [] : [to.id]
  })
}

function valuesOf(o: HeapObject | undefined): Value[] {
  if (o === undefined) return []
  return [
    ...(o.items ?? []),
    ...(o.entries ?? []).flatMap((e) => [e.key, e.value]),
    ...(o.fields ?? []).map((f) => f.value),
  ]
}

function readsOf(
  own: string[],
  values: Value[],
  heap: Record<string, HeapObject>,
  inside: (id: string) => boolean,
): Reads {
  const drawn = [...own]
  const named: string[] = []
  const todo = targets(values)
  const seen = new Set(own)
  for (let k = 0; k < todo.length; k++) {
    const id = todo[k]!
    if (seen.has(id)) continue
    seen.add(id)
    if (!inside(id)) {
      named.push(id)
      continue
    }
    drawn.push(id)
    todo.push(...targets(valuesOf(heap[id])))
  }
  return { drawn, named }
}

function members(o: HeapObject, format: Formatter) {
  return format.tupleMembers(o) ?? (o.kind === 'record' ? (o.fields ?? []) : null)
}

function tableOf(o: HeapObject, heap: Record<string, HeapObject>, format: Formatter) {
  if (o.kind !== 'sequence' || o.sparse || !o.items || o.items.length === 0) return null
  const start = o.window?.start ?? 0
  const rows: Table['rows'] = []
  let columns: string[] | null = null
  for (const [i, item] of o.items.entries()) {
    const element = item.t === 'ref' && item.id !== undefined ? heap[item.id] : undefined
    const fields = element && members(element, format)
    if (!fields || fields.length === 0) return null
    const names = fields.map((f) => f.name)
    columns ??= names
    if (names.join('\u0000') !== columns.join('\u0000')) return null
    rows.push({ index: start + i, id: item.id!, cells: fields.map((f) => f.value) })
  }
  return { columns: columns!, rows }
}

const primitives = new Set(['int', 'float', 'bool', 'char', 'str', 'uninit'])

function matrixOf(o: HeapObject, heap: Record<string, HeapObject>): Matrix | null {
  if (o.kind !== 'sequence' || o.sparse || o.truncated || !o.items || o.items.length === 0) {
    return null
  }
  const start = o.window?.start ?? 0
  const rows: Matrix['rows'] = []
  let columns: number | null = null
  for (const [i, item] of o.items.entries()) {
    const row = item.t === 'ref' && item.id !== undefined ? heap[item.id] : undefined
    if (row?.kind !== 'sequence' || row.sparse || row.truncated || !row.items) return null
    columns ??= row.items.length
    if (columns === 0 || row.items.length !== columns) return null
    if (!row.items.every((v) => primitives.has(v.t))) return null
    rows.push({ index: start + i, id: item.id! })
  }
  return { rows, columns: columns! }
}

function firstSeen(a: string, b: string) {
  const n = (id: string) => (/^o\d+$/.test(id) ? Number(id.slice(1)) : Number.NaN)
  const [x, y] = [n(a), n(b)]
  return Number.isNaN(x) || Number.isNaN(y) ? a.localeCompare(b) : x - y
}

export function layoutState(
  state: StepState,
  options: {
    showInternals: boolean
    showUnreachable: boolean
    matrixView: boolean
    views: Record<string, ViewAs>
    format: Formatter
  },
): StateLayout {
  const { showInternals, showUnreachable, matrixView, views, format } = options
  const { stack, heap } = state
  const shown = walk(
    frameRoots(stack, (l) => showInternals || !l.internal),
    heap,
    format,
  )
  const reachable = walk(
    frameRoots(stack, () => true),
    heap,
    format,
  )
  const placesOf = (id: string) => shown.get(id) ?? []

  const inline: Record<string, string> = {}
  for (const [id, o] of Object.entries(heap)) {
    const fields = format.tupleMembers(o)
    if (!fields?.every((f) => scalar(f.value)) || placesOf(id).some((p) => p.pointer)) continue
    inline[id] = format.tupleText(fields.map((f) => format.value(f.value).text))
  }

  const nested = new Set<string>()
  if (format.nestsRecords) {
    for (const [id, o] of Object.entries(heap)) {
      const places = placesOf(id)
      if (o.kind !== 'record' || id in inline || places.length !== 1) continue
      const parent = places[0]!.object
      if (parent !== undefined && heap[parent]?.kind === 'record' && !places[0]!.pointer) {
        nested.add(id)
      }
    }
  }

  const candidates = Object.keys(heap).filter(
    (id) => shown.has(id) || (showUnreachable && !reachable.has(id)),
  )
  const cards = candidates.map((id): CardView => {
    const places = placesOf(id)
    const variable = places.find((p) => p.variable !== undefined)?.variable
    const container = format.container(heap[id]!)
    const table = container === null ? tableOf(heap[id]!, heap, format) : null
    const matrix = container === null && table === null ? matrixOf(heap[id]!, heap) : null
    const fallback =
      container !== null
        ? 'container'
        : table !== null
          ? 'table'
          : matrix !== null && matrixView
            ? 'matrix'
            : 'cells'
    const view = views[variable ?? `#${id}`] ?? fallback
    const rows = new Set([
      ...(table !== null && view === 'table' ? table.rows.map((r) => r.id) : []),
      ...(matrix !== null && view === 'matrix' ? matrix.rows.map((r) => r.id) : []),
    ])
    return {
      id,
      object: heap[id]!,
      referrers: [
        ...new Set([
          ...places.filter((p) => p.variable !== undefined).map((p) => p.label),
          ...places.filter((p) => p.variable === undefined).map((p) => p.label),
        ]),
      ],
      variable,
      unreachable: !reachable.has(id),
      table,
      matrix,
      container,
      view,
      reads: readsOf(
        [id],
        valuesOf(heap[id]),
        heap,
        (child) => nested.has(child) || rows.has(child),
      ),
    }
  })

  const folded = new Set<string>()
  for (const card of cards) {
    const rows =
      card.view === 'table' ? card.table?.rows : card.view === 'matrix' ? card.matrix?.rows : null
    for (const row of rows ?? []) {
      if (placesOf(row.id).every((p) => p.object === card.id && !p.pointer)) folded.add(row.id)
    }
  }

  const frames = stack.map((frame) => {
    const locals = showInternals ? frame.locals : frame.locals.filter((l) => !l.internal)
    const values = [
      ...locals.map((l) => l.value),
      ...(frame.returnValue ? [frame.returnValue] : []),
    ]
    return {
      frame,
      locals,
      hidden: frame.locals.length - locals.length,
      reads: readsOf([], values, heap, (id) => nested.has(id)),
    }
  })

  return {
    frames,
    cards: cards
      .filter((c) => !(c.id in inline) && !nested.has(c.id) && !folded.has(c.id))
      .sort((a, b) => firstSeen(a.id, b.id)),
    inline,
    nested,
  }
}
