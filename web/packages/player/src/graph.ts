import type { ElkNode } from 'elkjs/lib/elk-api.js'
import { apply, type Base } from './engine.ts'
import type { Formatter } from './format.ts'
import type { HeapObject, Step, Value } from './gen/trace.ts'

export type Edge = { from: number; to: number; weight?: Value }
export type GraphKind = 'graph' | 'tree'
export type GraphShape = {
  source: 'adjacency' | 'edges' | 'parents'
  size: number
  edges: Edge[]
  // objects drawn inside the graph, which fold away like a matrix's rows
  rows: string[]
}

export type GraphRequest = {
  id: string
  kind: GraphKind
  // null => undirected when every edge the trace ever holds is there both ways
  undirected: boolean | null
  // null => every node the graph ever has; else these only (the 2-hop view of a big graph)
  nodes: number[] | null
}

export type Point = { x: number; y: number }
export type GraphLayout = {
  undirected: boolean
  width: number
  height: number
  nodes: Record<number, Point>
  // key: from>to, or min-max when undirected; points run from the edge's own from to its to
  edges: Record<string, Point[]>
}

type Heap = (id: string) => HeapObject | undefined

export const adjacencyNames = new Set(['adj', 'g', 'graph']) // §19.4
export const parentNames = new Set(['par', 'parent', 'p', 'fa'])
const maxEdgeListNode = 1_000_000
export const nodeWidth = 44
export const nodeHeight = 26
export const captionHeight = 16

function int(v: Value | undefined): number | null {
  if (v?.t !== 'int' || v.v === undefined || !/^-?\d+$/.test(v.v)) return null
  return Number(v.v)
}

function members(v: Value, heap: Heap, format: Formatter): Value[] | null {
  if (v.t !== 'ref' || v.id === undefined) return null
  const o = heap(v.id)
  if (o === undefined) return null
  const fields = format.tupleMembers(o) ?? (o.kind === 'record' ? (o.fields ?? []) : null)
  return fields?.map((f) => f.value) ?? null
}

function adjacency(o: HeapObject, heap: Heap, format: Formatter): GraphShape | null {
  if (o.kind !== 'sequence' || o.sparse || !o.items) return null
  const size = o.length ?? 0
  const start = o.window?.start ?? 0
  const rows: string[] = []
  const edges: Edge[] = []
  for (const [i, item] of o.items.entries()) {
    const row = item.t === 'ref' && item.id !== undefined ? heap(item.id) : undefined
    if (row?.kind !== 'sequence' || row.sparse || !row.items) return null
    rows.push(item.id!)
    for (const cell of row.items) {
      const pair = int(cell) === null ? members(cell, heap, format) : null
      const to = pair === null ? int(cell) : int(pair[0])
      if (to === null || to < 0 || to >= size) return null
      edges.push(
        pair !== null && pair.length > 1
          ? { from: start + i, to, weight: pair[1] }
          : { from: start + i, to },
      )
    }
  }
  return { source: 'adjacency', size, edges, rows }
}

function edgeList(o: HeapObject, heap: Heap, format: Formatter): GraphShape | null {
  if (o.kind !== 'sequence' || o.sparse || !o.items || o.items.length === 0) return null
  const edges: Edge[] = []
  const rows: string[] = []
  let size = 0
  for (const item of o.items) {
    const m = members(item, heap, format)
    const [u, v] = [int(m?.[0]), int(m?.[1])]
    if (m === null || u === null || v === null || u < 0 || v < 0) return null
    if (u >= maxEdgeListNode || v >= maxEdgeListNode) return null
    edges.push(m.length > 2 ? { from: u, to: v, weight: m[2] } : { from: u, to: v })
    if (item.id !== undefined) rows.push(item.id)
    size = Math.max(size, u + 1, v + 1)
  }
  return { source: 'edges', size, edges, rows }
}

// a sparse array's default cells have no parent, and a dense array of one value holds no tree yet:
// a zeroed global par[] isn't every node under 0
function parents(o: HeapObject): GraphShape | null {
  if (o.kind !== 'sequence') return null
  const size = o.length ?? 0
  const cells: [number, Value][] = o.sparse
    ? [...Object.entries(o.sparse.items).map(([k, v]): [number, Value] => [Number(k), v])]
    : (o.items ?? []).map((v, i) => [(o.window?.start ?? 0) + i, v])
  const inRange = (v: Value) => {
    const p = int(v)
    return p !== null && p >= -1 && p < size
  }
  if (!cells.every(([, v]) => inRange(v)) || (o.sparse && !inRange(o.sparse.default))) return null
  const blank = !o.sparse && new Set(cells.map(([, v]) => v.v)).size === 1
  const edges = cells.flatMap(([v, cell]): Edge[] => {
    const p = int(cell)!
    return !blank && p >= 0 && p !== v ? [{ from: p, to: v }] : []
  })
  return { source: 'parents', size, edges, rows: [] }
}

export function graphShape(kind: GraphKind, o: HeapObject, heap: Heap, format: Formatter) {
  if (kind === 'tree') return parents(o)
  return adjacency(o, heap, format) ?? edgeList(o, heap, format)
}

// what the card offers, from the shape and the names it goes by (§19.4)
export function suggestedGraph(
  o: HeapObject,
  names: string[],
  heap: Heap,
  format: Formatter,
): { kind: GraphKind; shape: GraphShape } | null {
  if (names.some((n) => parentNames.has(n))) {
    const shape = parents(o)
    if (shape !== null) return { kind: 'tree', shape }
  }
  const adj = adjacency(o, heap, format)
  if (adj !== null) {
    const lengths = new Set(
      (o.items ?? []).map((v) => (v.id === undefined ? 0 : (heap(v.id)?.items?.length ?? 0))),
    )
    if (lengths.size > 1 || names.some((n) => adjacencyNames.has(n)))
      return { kind: 'graph', shape: adj }
    return null
  }
  const list = edgeList(o, heap, format)
  return list === null ? null : { kind: 'graph', shape: list }
}

export function edgeKey(from: number, to: number, undirected: boolean) {
  return undirected ? `${Math.min(from, to)}-${Math.max(from, to)}` : `${from}>${to}`
}

export function isUndirected(edges: Edge[]) {
  const all = new Set(edges.map((e) => `${e.from}>${e.to}`))
  return edges.length > 0 && edges.every((e) => all.has(`${e.to}>${e.from}`))
}

const unionBatch = 256

// every node and edge the object has at any step, so the layout never moves between steps
export async function graphUnion(steps: Step[], id: string, kind: GraphKind, format: Formatter) {
  const walk: Base = { frames: new Map(), heap: new Map() }
  const nodes = new Set<number>()
  const edges = new Map<string, Edge>()
  for (let k = 0; k < steps.length; k++) {
    if (k % unionBatch === unionBatch - 1) await new Promise((resolve) => setTimeout(resolve))
    apply(walk, steps[k]!)
    const o = walk.heap.get(id)
    const shape = o && graphShape(kind, o, (child) => walk.heap.get(child), format)
    for (const e of shape?.edges ?? []) {
      if (e.from === e.to) continue
      nodes.add(e.from).add(e.to)
      edges.set(edgeKey(e.from, e.to, false), e)
    }
  }
  return { nodes: [...nodes].sort((a, b) => a - b), edges: [...edges.values()] }
}

// BFS level over edges taken both ways, from the lowest node of each component
export function levels(nodes: number[], edges: Edge[]) {
  const next = new Map<number, number[]>(nodes.map((n) => [n, []]))
  for (const e of edges) {
    next.get(e.from)?.push(e.to)
    next.get(e.to)?.push(e.from)
  }
  const level = new Map<number, number>()
  for (const root of nodes) {
    if (level.has(root)) continue
    level.set(root, 0)
    const queue = [root]
    for (let k = 0; k < queue.length; k++) {
      const u = queue[k]!
      for (const v of next.get(u) ?? []) {
        if (level.has(v)) continue
        level.set(v, level.get(u)! + 1)
        queue.push(v)
      }
    }
  }
  return level
}

export async function layoutGraph(
  nodes: number[],
  edges: Edge[],
  undirected: boolean,
  elk: { layout: (graph: ElkNode) => Promise<ElkNode> },
): Promise<GraphLayout> {
  const shown = new Set(nodes)
  const once = new Map(edges.map((e) => [edgeKey(e.from, e.to, undirected), e]))
  const drawn = [...once.values()].filter((e) => shown.has(e.from) && shown.has(e.to))
  const level = levels(nodes, drawn)
  // layered layout needs downward edges: same level => lower index first
  const down = (e: Edge) => {
    const [a, b] = [level.get(e.from)!, level.get(e.to)!]
    return a < b || (a === b && e.from < e.to)
  }
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'POLYLINE',
      'elk.spacing.nodeNode': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': '28',
      'elk.partitioning.activate': 'true',
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
    },
    children: nodes.map((n) => ({
      id: String(n),
      width: nodeWidth,
      height: nodeHeight + captionHeight,
      layoutOptions: { 'elk.partitioning.partition': String(level.get(n)) },
    })),
    edges: drawn.map((e) => {
      const [from, to] = down(e) ? [e.from, e.to] : [e.to, e.from]
      return { id: `${e.from}>${e.to}`, sources: [String(from)], targets: [String(to)] }
    }),
  }
  const result = await elk.layout(graph)
  const positions: GraphLayout['nodes'] = {}
  for (const child of result.children ?? [])
    positions[Number(child.id)] = { x: child.x ?? 0, y: child.y ?? 0 }
  const routes: GraphLayout['edges'] = {}
  const byId = new Map(drawn.map((e) => [`${e.from}>${e.to}`, e]))
  for (const edge of result.edges ?? []) {
    const e = byId.get(edge.id)
    const section = edge.sections?.[0]
    if (e === undefined || section === undefined) continue
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
    routes[edgeKey(e.from, e.to, undirected)] = down(e) ? points : points.toReversed()
  }
  return {
    undirected,
    width: result.width ?? 0,
    height: result.height ?? 0,
    nodes: positions,
    edges: routes,
  }
}
