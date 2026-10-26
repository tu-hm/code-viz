import { Button, cn } from '@viz/ui'
import { useEffect, useId, useState } from 'react'
import type { HeapObject, Value } from './gen/trace.ts'
import {
  captionHeight,
  edgeKey,
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

function text(v: Value | undefined, look: Look) {
  if (v === undefined || v.t === 'uninit') return '·'
  return look.format.value(v).text
}

// what an unvisited node holds: the sparse default, else -1, else an INF-sized value, else 0
function unvisited(o: HeapObject, look: Look) {
  if (o.sparse) return text(o.sparse.default, look)
  const values = (o.items ?? []).map((v) => text(v, look))
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

function path(points: Point[]) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
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

export function GraphView({
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
  const arrowId = useId()
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
    return v !== undefined && v.t !== 'uninit' && text(v, look) !== empty
  }
  const { current, checking } = marks
  const checked = checking === null ? null : edgeKey(checking.from, checking.to, undirected)
  const neighbours = (n: number) => [
    ...new Set(
      live
        .filter((e) => e.from === n || (undirected && e.to === n))
        .map((e) => (e.from === n ? e.to : e.from)),
    ),
  ]
  const nodeLabel = (n: number) => (label === null ? String(n) : text(cellValue(label, n), look))
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
      <div className="max-h-[32rem] max-w-full overflow-auto">
        <svg
          role="img"
          aria-label={summary}
          width={layout.width + 40}
          height={layout.height}
          viewBox={`0 0 ${layout.width + 40} ${layout.height}`}
          className="font-mono text-xs"
        >
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 8 8"
              refX="8"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" className="fill-trace-arrow" />
            </marker>
          </defs>
          {edges.map(([key, e]) => {
            const points = layout.edges[key]
            if (points === undefined) return null
            const on = key === checked
            const mid = points[Math.floor(points.length / 2)]!
            return (
              <g key={key}>
                <path
                  d={path(points)}
                  fill="none"
                  strokeWidth={on ? 2 : 1.25}
                  strokeDasharray={on ? '4 3' : undefined}
                  markerEnd={undirected ? undefined : `url(#${arrowId})`}
                  className={on ? 'stroke-trace-index' : 'stroke-trace-arrow'}
                />
                {e.weight !== undefined && (
                  <text x={mid.x + 4} y={mid.y - 2} className="fill-muted-foreground">
                    {text(e.weight, look)}
                  </text>
                )}
              </g>
            )
          })}
          {nodes.map((n) => {
            const at = layout.nodes[n]!
            const seen = visited(n)
            const here = current?.at === n
            const cx = at.x + nodeWidth / 2
            return (
              <g key={n}>
                <rect
                  x={at.x}
                  y={at.y}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={6}
                  strokeWidth={here ? 2.5 : 1.25}
                  className={cn(
                    seen === true ? 'fill-brand-subtle' : 'fill-background',
                    here
                      ? 'stroke-brand'
                      : seen === false
                        ? 'stroke-trace-unset'
                        : 'stroke-border-strong',
                  )}
                />
                <text
                  x={cx}
                  y={at.y + nodeHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={cn('fill-foreground', seen === true && 'font-semibold')}
                >
                  {seen === null ? nodeLabel(n) : seen ? `[${nodeLabel(n)}]` : `(${nodeLabel(n)})`}
                </text>
                {colour !== null && (
                  <text
                    x={cx}
                    y={at.y + nodeHeight + captionHeight / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-muted-foreground"
                  >
                    {colourName}={text(cellValue(colour, n), look)}
                  </text>
                )}
                {here && (
                  <text
                    x={at.x + nodeWidth + 4}
                    y={at.y + nodeHeight / 2}
                    dominantBaseline="central"
                    className="fill-trace-index"
                  >
                    ◀ {current.name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <ul aria-label={`Nodes of ${name}`} className="sr-only">
        {nodes.map((n) => (
          <li key={n}>
            node {n}
            {label !== null && `, labelled ${nodeLabel(n)}`}
            {visited(n) === true && ', visited'}
            {visited(n) === false && ', not visited'}
            {colour !== null && `, ${colourName} ${text(cellValue(colour, n), look)}`}
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
      <p className="flex flex-wrap gap-x-6 text-xs text-muted-foreground">
        {colour !== null && (
          <>
            <span>
              [x] visited: {colourName} ≠ {empty}
            </span>
            <span>(x) not visited</span>
          </>
        )}
        <span>┊ edge being checked</span>
        {current !== null && <span>◀ current node</span>}
      </p>
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
