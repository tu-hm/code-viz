import { Button } from '@viz/ui'
import { useEffect, useId, useRef, useState } from 'react'
import Graph from 'graphology'
import type { Canvas, CanvasGraph, EdgeData, NodeData } from './graph-canvas.ts'
import type { HeapObject } from './gen/trace.ts'
import {
  cellText,
  edgeKey,
  graphPadding,
  nodeHeight,
  nodeWidth,
  type Edge,
  type GraphKind,
  type GraphLayout,
  type GraphRequest,
  type GraphShape,
  type Point,
} from './graph.ts'
import { cellValue, type GraphMarks } from './marks.ts'
import type { Look } from './state-layout.ts'

const maxNodes = 200 // §19.4.5: above this, the 2-hop neighbourhood of the current node
const field = 'h-8 rounded-lg border border-input bg-background px-2 font-mono text-base sm:text-sm'

export type LayoutGraph = (request: GraphRequest) => Promise<GraphLayout>

// what an unvisited node holds: the sparse default, else -1, else an INF-sized value, else 0
function unvisited(o: HeapObject, look: Look) {
  if (o.sparse) return cellText(o.sparse.default, look.format)
  const values = (o.items ?? []).map((v) => cellText(v, look.format))
  if (values.includes('-1')) return '-1'
  const big = values.find((v) => /^-?\d+$/.test(v) && Math.abs(Number(v)) >= 1e9)
  if (big !== undefined) return big
  return values.includes('false') ? 'false' : '0'
}

function nodesOf(edges: Edge[]) {
  return [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort((a, b) => a - b)
}

function neighbourhood(edges: Edge[], center: number) {
  const next = new Map<number, number[]>()
  for (const e of edges) {
    next.set(e.from, [...(next.get(e.from) ?? []), e.to])
    next.set(e.to, [...(next.get(e.to) ?? []), e.from])
  }
  const near = new Set([center])
  for (const a of next.get(center) ?? []) {
    near.add(a)
    for (const b of next.get(a) ?? []) near.add(b)
  }
  return [...near].sort((a, b) => a - b)
}

// a straight edge through another node's box => curved, so it can't read as two edges
function crosses(a: Point, b: Point, nodes: Point[]) {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  return nodes.some((p) => {
    if (p === a || p === b || length === 0) return false
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    const [x, y] = [a.x + t * dx - p.x, a.y + t * dy - p.y]
    return Math.abs(x) < nodeWidth / 2 && Math.abs(y) < nodeHeight / 2
  })
}

// elkjs's positions, y flipped: sigma's y axis points up
function graphOf(layout: GraphLayout): CanvasGraph {
  const graph: CanvasGraph = new Graph({ type: layout.undirected ? 'undirected' : 'directed' })
  const centres = Object.entries(layout.nodes).map(([n, p]): [string, Point] => [
    n,
    { x: p.x + nodeWidth / 2, y: p.y + nodeHeight / 2 },
  ])
  const at = new Map(centres)
  for (const [n, p] of centres) graph.addNode(n, { x: p.x, y: -p.y })
  for (const [key, [from, to]] of Object.entries(layout.edges)) {
    const [a, b] = [at.get(String(from))!, at.get(String(to))!]
    const curvature = crosses(a, b, [...at.values()]) ? 0.3 : 0
    graph.addEdgeWithKey(key, String(from), String(to), { curvature })
  }
  return graph
}

type Drawn = { graph: CanvasGraph; canvas: Canvas | null }

// module level: React Compiler can't build import() inside a component
function loadCanvas() {
  return import('./graph-canvas.ts')
}

type GraphViewProps = {
  name: string
  kind: GraphKind
  shape: GraphShape
  layout: GraphLayout
  shown: number[] | null
  marks: GraphMarks
  look: Look
  colour: HeapObject | null
  colourName: string | null
  label: HeapObject | null
}

function GraphView({
  name,
  kind,
  shape,
  layout,
  shown,
  marks,
  look,
  colour,
  colourName,
  label,
}: GraphViewProps) {
  const box = useRef<HTMLDivElement>(null)
  const drawn = useRef<Drawn | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const { undirected } = layout
  const nodes = Object.keys(layout.nodes).map(Number)
  const keep = shown === null ? null : new Set(shown)
  const live =
    layout.spans === null
      ? shape.edges
      : Object.entries(layout.spans).flatMap(([key, [since, until]]): Edge[] => {
          if (since > marks.step || (until !== null && marks.step >= until)) return []
          const [from, to] = key.split('>').map(Number)
          return [{ from: from!, to: to! }]
        })
  const edges = [
    ...new Map(
      live
        .filter((e) => e.from !== e.to && (keep === null || (keep.has(e.from) && keep.has(e.to))))
        .map((e) => [edgeKey(e.from, e.to, undirected), e]),
    ).entries(),
  ]
  const empty = colour === null ? null : unvisited(colour, look)
  const visited = (n: number) => {
    if (colour === null) return null
    const v = cellValue(colour, n)
    return v !== undefined && v.t !== 'uninit' && cellText(v, look.format) !== empty
  }
  const { current, checking } = marks
  const checked = checking === null ? null : edgeKey(checking.from, checking.to, undirected)
  const neighbours = (n: number) => [
    ...new Set(
      live
        .filter((e) => e.from === n || (undirected && e.to === n))
        .map((e) => {
          const to = e.from === n ? e.to : e.from
          return e.weight === undefined
            ? String(to)
            : `${to} (weight ${cellText(e.weight, look.format)})`
        }),
    ),
  ]
  const nodeLabel = (n: number) =>
    label === null ? String(n) : cellText(cellValue(label, n), look.format)
  const nodeData = nodes.map((n): [string, NodeData] => {
    const seen = visited(n)
    return [
      String(n),
      {
        text: seen === null ? nodeLabel(n) : seen ? `[${nodeLabel(n)}]` : `(${nodeLabel(n)})`,
        seen,
        here: current?.at === n,
        caption:
          colour === null ? null : `${colourName}=${cellText(cellValue(colour, n), look.format)}`,
        pointer: current?.at === n ? `◀ ${current.name}` : null,
      },
    ]
  })
  const liveEdges = new Map(edges)
  const edgeData = Object.keys(layout.edges).map((key): [string, EdgeData] => {
    const weight = liveEdges.get(key)?.weight
    return [
      key,
      {
        live: liveEdges.has(key),
        on: key === checked,
        weight: weight === undefined ? '' : cellText(weight, look.format),
      },
    ]
  })

  useEffect(() => {
    const graph = graphOf(layout)
    const shown: Drawn = { graph, canvas: null }
    let alive = true
    drawn.current = shown
    loadCanvas()
      .then(({ drawGraph }) => {
        if (alive) shown.canvas = drawGraph(box.current!, graph, layout.undirected)
      })
      .catch((e: unknown) => {
        if (alive) setFailed(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
      shown.canvas?.kill()
      drawn.current = null
    }
  }, [layout])

  useEffect(() => {
    const { graph } = drawn.current!
    for (const [n, data] of nodeData) graph.mergeNodeAttributes(n, data)
    for (const [key, data] of edgeData) graph.mergeEdgeAttributes(key, data)
  }, [layout, nodeData, edgeData])
  const summary = [
    `${name} as ${layout.spans === null ? `a ${kind}` : 'the tree of first visits'}: ${nodes.length} nodes, ${edges.length} edges`,
    current !== null ? `current node ${current.at} (${current.name})` : null,
    checking !== null
      ? `checking ${checking.name} = ${checking.to}, edge ${checking.from} to ${checking.to}`
      : null,
  ]
    .filter((s) => s !== null)
    .join('; ')

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-border">
          <div
            ref={box}
            role="img"
            aria-label={summary}
            style={{
              minWidth: layout.width + 2 * graphPadding,
              height: layout.height + 2 * graphPadding,
            }}
            className="w-full"
          />
        </div>
        <div className="absolute top-1 right-1 flex gap-0.5 rounded-full bg-card/90">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => void drawn.current?.canvas?.getCamera().zoomIn()}
          >
            +
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => void drawn.current?.canvas?.getCamera().zoomOut()}
          >
            −
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Fit the graph"
            onClick={() => void drawn.current?.canvas?.getCamera().reset()}
          >
            Fit
          </Button>
        </div>
      </div>
      {failed !== null && (
        <p role="alert" className="text-sm text-danger">
          Couldn&apos;t draw the graph: {failed}
        </p>
      )}
      <ul aria-label={`Nodes of ${name}`} className="sr-only">
        {nodes.map((n) => (
          <li key={n}>
            node {n}
            {label !== null && `, labelled ${nodeLabel(n)}`}
            {visited(n) === true && ', visited'}
            {visited(n) === false && ', not visited'}
            {colour !== null && `, ${colourName} ${cellText(cellValue(colour, n), look.format)}`}
            {current?.at === n && ', current'}
            {`, edges to ${neighbours(n).join(', ') || 'none'}`}
          </li>
        ))}
      </ul>
      {checking !== null && (
        <p className="font-sans text-xs text-trace-index">
          <span aria-hidden>┊ </span>checking {checking.name} = {checking.to}, edge {checking.from}{' '}
          {undirected ? '–' : '→'} {checking.to}
        </p>
      )}
      {(colour !== null || current !== null || checking !== null) && (
        <p className="flex flex-wrap gap-x-6 text-xs text-muted-foreground">
          {colour !== null && (
            <>
              <span>
                [x] visited: {colourName} ≠ {empty}
              </span>
              <span>(x) not visited</span>
            </>
          )}
          {checking !== null && <span>┊ edge being checked</span>}
          {current !== null && <span>◀ current node</span>}
        </p>
      )}
    </div>
  )
}

export function GraphBox({
  id,
  name,
  kind,
  shape,
  marks,
  look,
  layoutGraph,
}: {
  id: string
  name: string
  kind: GraphKind
  shape: GraphShape
  marks: GraphMarks
  look: Look
  layoutGraph: LayoutGraph
}) {
  const [undirected, setUndirected] = useState<boolean | null>(kind === 'tree' ? false : null)
  const [firstVisits, setFirstVisits] = useState(false)
  const [colourPick, setColour] = useState<string | null | undefined>(undefined)
  const [labelPick, setLabel] = useState<string | null>(null)
  const [found, setFound] = useState<{ key: string; layout?: GraphLayout; error?: string } | null>(
    null,
  )
  const colourId = useId()
  const labelId = useId()
  const all = nodesOf(shape.edges)
  const big = all.length > maxNodes
  const center = marks.current?.at ?? all[0] ?? 0
  const shown = big ? neighbourhood(shape.edges, center) : null
  const colourName = colourPick === undefined ? marks.colour : colourPick
  const canVisit =
    kind === 'graph' &&
    shape.source === 'adjacency' &&
    colourName !== null &&
    marks.indices.length > 0
  const colourArray = marks.arrays.find((a) => a.name === colourName)
  const visits =
    canVisit && firstVisits && colourArray !== undefined
      ? `${colourArray.id}|${marks.indices.join(',')}`
      : null
  const nodesKey = shown?.join(',') ?? null
  const key = `${id}|${kind}|${undirected}|${nodesKey}|${visits}`

  useEffect(() => {
    let alive = true
    const nodes = nodesKey === null ? null : nodesKey.split(',').map(Number)
    const [colour, names] = visits === null ? [] : visits.split('|')
    layoutGraph({
      id,
      kind,
      undirected,
      nodes,
      visits:
        colour === undefined || names === undefined ? null : { colour, names: names.split(',') },
    }).then(
      (layout) => {
        if (alive) setFound({ key, layout })
      },
      (e: unknown) => {
        if (alive) setFound({ key, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [key, id, kind, undirected, nodesKey, visits, layoutGraph])

  const colour = marks.arrays.find((a) => a.name === colourName)?.object ?? null
  const label = marks.arrays.find((a) => a.name === labelPick)?.object ?? null
  const layout = found?.layout
  const options = marks.arrays.map((a) => a.name)

  return (
    <div className="flex flex-col gap-2 font-sans">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <label htmlFor={colourId} className="flex items-center gap-2">
          Color nodes by
          <select
            id={colourId}
            value={colourName ?? ''}
            onChange={(e) => setColour(e.currentTarget.value === '' ? null : e.currentTarget.value)}
            className={field}
          >
            <option value="">none</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={labelId} className="flex items-center gap-2">
          Label nodes by
          <select
            id={labelId}
            value={labelPick ?? ''}
            onChange={(e) => setLabel(e.currentTarget.value === '' ? null : e.currentTarget.value)}
            className={field}
          >
            <option value="">index</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        {canVisit && (
          <div role="group" aria-label="Edges to draw" className="flex gap-1">
            <Button
              size="sm"
              variant={firstVisits ? 'ghost' : 'secondary'}
              aria-pressed={!firstVisits}
              onClick={() => setFirstVisits(false)}
            >
              All edges
            </Button>
            <Button
              size="sm"
              variant={firstVisits ? 'secondary' : 'ghost'}
              aria-pressed={firstVisits}
              onClick={() => setFirstVisits(true)}
            >
              First visits (DFS tree)
            </Button>
          </div>
        )}
        {kind === 'graph' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={layout?.undirected ?? false}
              disabled={layout === undefined || visits !== null}
              onChange={(e) => setUndirected(e.currentTarget.checked)}
              className="size-4 accent-primary"
            />
            Undirected (edges stored twice)
          </label>
        )}
      </div>
      {shown !== null && (
        <p className="text-xs text-muted-foreground">
          {all.length.toLocaleString('en')} nodes: showing the {shown.length} within 2 edges of node{' '}
          {center}
          {marks.current === null ? ' (no node is current on this line)' : ''},{' '}
          {(all.length - shown.length).toLocaleString('en')} hidden
        </p>
      )}
      {found?.key === key && found.error !== undefined ? (
        <p role="alert" className="text-sm text-danger">
          Couldn&apos;t lay out the graph: {found.error}
        </p>
      ) : layout === undefined ? (
        <p className="text-sm text-muted-foreground">Laying out the graph…</p>
      ) : all.length === 0 && Object.keys(layout.nodes).length === 0 ? (
        <p className="text-sm text-muted-foreground">No edges in this run.</p>
      ) : (
        <GraphView
          name={name}
          kind={kind}
          shape={shape}
          layout={layout}
          shown={shown}
          marks={marks}
          look={look}
          colour={colour}
          colourName={colourName}
          label={label}
        />
      )}
    </div>
  )
}
