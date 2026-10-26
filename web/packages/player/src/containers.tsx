import { Button, cn } from '@viz/ui'
import { useState } from 'react'
import { containerLabels, type Container } from './format.ts'
import type { HeapObject, Value } from './gen/trace.ts'
import type { Look } from './state-layout.ts'
import { changedClass, Mark, ValueView } from './value-view.tsx'

const cellClass =
  'flex h-(--cell-size) min-w-(--cell-size) items-center justify-center rounded-sm bg-background px-1.5 transition-colors duration-(--duration-fade)'
const shownAfterTop = 8

type Item = { value: Value; index: number; on: boolean }

function members(v: Value, look: Look): (number | string)[] {
  if (v.t === 'int' || v.t === 'float') return [Number(v.v)]
  if (v.t === 'ref' && v.id !== undefined) {
    const o = look.heap[v.id]
    const fields = o === undefined ? null : look.format.tupleMembers(o)
    if (fields) return fields.flatMap((f) => members(f.value, look))
  }
  return [look.format.value(v).text]
}

function compare(a: Value, b: Value, look: Look) {
  const [x, y] = [members(a, look), members(b, look)]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [p, q] = [x[i]!, y[i]!]
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p - q
    return String(p).localeCompare(String(q))
  }
  return x.length - y.length
}

// heap order puts the top first; the rest sort the same way when the comparator is < or >
function readingOrder(items: Item[], look: Look) {
  const [top, ...rest] = items
  if (top === undefined) return { sorted: items, readable: true }
  const down = rest.every((i) => compare(top.value, i.value, look) >= 0)
  const up = rest.every((i) => compare(top.value, i.value, look) <= 0)
  if (!down && !up) return { sorted: items, readable: false }
  const sign = down ? -1 : 1
  return {
    sorted: [top, ...rest.toSorted((a, b) => sign * compare(a.value, b.value, look))],
    readable: true,
  }
}

function Cell({ item, look }: { item: Item; look: Look }) {
  return (
    <span data-cell={item.index} className={cn(cellClass, item.on && changedClass)}>
      <ValueView value={item.value} look={look} />
      <Mark on={item.on} />
    </span>
  )
}

function Edge({ text, label }: { text: string; label: string }) {
  return (
    <span className="flex h-(--cell-size) items-center font-sans text-xs whitespace-nowrap text-trace-index">
      <span aria-hidden>{text}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function Heap({ items, more, look }: { items: Item[]; more: number; look: Look }) {
  const [heapOrder, setHeapOrder] = useState(false)
  const { sorted, readable } = readingOrder(items, look)
  const [top, ...rest] = sorted
  const text = ({ value: v }: Item) =>
    v.t === 'ref' && v.id !== undefined && look.inline[v.id] !== undefined
      ? look.inline[v.id]
      : look.format.value(v).text
  const inHeapOrder = items.map(text).join(', ')
  return (
    <div className="flex flex-col gap-2">
      {top !== undefined && (
        <p title={`heap order: ${inHeapOrder}`} className="flex flex-wrap items-center gap-2">
          <Edge text="top ▶" label="top:" />
          <Cell item={top} look={look} />
          {rest.length > 0 && (
            <span>
              <span className="font-sans text-muted-foreground">then </span>
              {rest.slice(0, shownAfterTop).map((i, k) => (
                <span key={i.index}>
                  {k > 0 && ', '}
                  <ValueView value={i.value} look={look} />
                </span>
              ))}
              {rest.length > shownAfterTop &&
                `, +${(rest.length - shownAfterTop).toLocaleString('en')} more`}
            </span>
          )}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2 font-sans text-xs text-muted-foreground">
        {readable
          ? 'Sorted for reading.'
          : 'Shown in heap order: the comparator sorts neither up nor down.'}
        {more > 0 &&
          ` Only the first ${items.length.toLocaleString('en')} of the heap were recorded.`}
        {readable && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={heapOrder}
            onClick={() => setHeapOrder(!heapOrder)}
          >
            Heap order
          </Button>
        )}
      </p>
      {heapOrder && (
        <ol aria-label="Heap order" className="flex flex-wrap items-start gap-1">
          {items.map((i) => (
            <li key={i.index} className="flex flex-col items-center gap-0.5">
              <Cell item={i} look={look} />
              <span aria-hidden className="text-xs text-muted-foreground">
                {i.index}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function ContainerView({
  id,
  kind,
  object,
  look,
}: {
  id: string
  kind: Container
  object: HeapObject
  look: Look
}) {
  const recorded = object.items ?? []
  const more = (object.length ?? recorded.length) - recorded.length
  const changed = look.highlight ? (look.changed[id] ?? []) : []
  // a pop at the front moves every item down one => every index differs, nothing new to point at
  const shifted = recorded.length > 1 && recorded.every((_, i) => changed.includes(String(i)))
  const items = recorded.map((value, index) => ({
    value,
    index,
    on: kind !== 'priority_queue' && !shifted && changed.includes(String(index)),
  }))
  if (items.length === 0 && more === 0) return <p className="text-muted-foreground">empty</p>
  if (kind === 'priority_queue') return <Heap items={items} more={more} look={look} />
  const gap = more > 0 && (
    <span className="flex h-(--cell-size) items-center px-1 text-muted-foreground">
      … +{more.toLocaleString('en')}
    </span>
  )
  if (kind === 'stack') {
    return (
      <div className="flex items-start gap-2">
        {more === 0 && <Edge text="top ▶" label="top:" />}
        <ol aria-label="Stack, top first" className="flex flex-col gap-1">
          {more > 0 && <li>{gap} not recorded, toward the top</li>}
          {items.toReversed().map((i) => (
            <li key={i.index}>
              <Cell item={i} look={look} />
            </li>
          ))}
        </ol>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-start gap-2">
      <Edge text="front ▶" label="front:" />
      <ol aria-label={`${containerLabels[kind]}, front first`} className="flex flex-wrap gap-1">
        {items.map((i) => (
          <li key={i.index}>
            <Cell item={i} look={look} />
          </li>
        ))}
      </ol>
      {gap}
      {more === 0 && <Edge text="◀ back" label="back" />}
    </div>
  )
}
