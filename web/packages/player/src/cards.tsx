import { Button, cn } from '@viz/ui'
import { memo, useId, type ReactNode } from 'react'
import { ArrayView } from './array-view.tsx'
import { BigArray, bigArray } from './big-array.tsx'
import { ContainerView } from './containers.tsx'
import { same } from './engine.ts'
import { containerLabels } from './format.ts'
import type { HeapObject, Value } from './gen/trace.ts'
import { isRecord } from './is-record.ts'
import type { kinds } from './load.ts'
import type { CardMarks } from './marks.ts'
import { MatrixView } from './matrix-view.tsx'
import { PinMarkers } from './pin-markers.tsx'
import {
  inlineChanged,
  sameList,
  sameReads,
  type CardView,
  type Look,
  type Table,
} from './state-layout.ts'
import type { ViewAs } from './store.ts'
import { changedClass, Fields, Mark, ValueView } from './value-view.tsx'

export type CardProps = {
  card: CardView
  look: Look
  isNew: boolean
  marks: CardMarks
  pins: string[] | undefined
  onView: (variable: string, view: ViewAs) => void
  onPin: (variable: string, names: string[]) => void
  onShowRange?: (variable: string) => void
}

const drawnCells = 100 // FR-11: draw the first 100
const drawnSparse = 16 // §19.4.2 window, until FE-08 lets it move
const shownReferrers = 6

const cellClass =
  'flex h-(--cell-size) min-w-(--cell-size) items-center justify-center rounded-sm bg-background px-1.5 transition-colors duration-(--duration-fade)'

function Card({
  card,
  isNew,
  type,
  facts,
  actions,
  children,
}: {
  card: CardView
  isNew: boolean
  type: string
  facts?: string[]
  actions?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  const { id, referrers, unreachable } = card
  const more = referrers.length - shownReferrers
  return (
    // content-visibility: offscreen cards skip layout, synthetic-5000 8.1 => 4.0 ms p50
    <article
      aria-labelledby={titleId}
      data-card={id}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl bg-card p-3 data-active:outline-2 data-active:-outline-offset-2 data-active:outline-trace-arrow-active font-mono text-(length:--code-font-size) [contain-intrinsic-size:auto_6rem] [content-visibility:auto]',
        isNew && 'transition-opacity duration-(--duration-fade) starting:opacity-0',
        unreachable && 'text-muted-foreground',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={titleId} className="text-xs">
          <span className="font-semibold">#{id}</span> {type}
          {facts?.map((f) => ` · ${f}`)}
          {referrers.length > 0 && (
            <span className="text-muted-foreground">
              {'  '}
              <span aria-hidden>◀</span>
              <span className="sr-only">from</span> {referrers.slice(0, shownReferrers).join(', ')}
              {more > 0 && `, +${more} more`}
            </span>
          )}
          {unreachable && ' · unreachable'}
        </h3>
        {actions}
      </div>
      {children}
    </article>
  )
}

function Gap({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <li className="flex h-(--cell-size) items-center px-1 text-muted-foreground">
      … +{count.toLocaleString('en')}
    </li>
  )
}

function Cell({
  value,
  index,
  count,
  on,
  look,
}: {
  value: Value
  index?: number
  count?: number
  on: boolean
  look: Look
}) {
  return (
    <li data-cell={index} className="flex flex-col items-center gap-0.5">
      <span className={cn(cellClass, on && changedClass)}>
        {index !== undefined && <span className="sr-only">[{index}] </span>}
        <ValueView value={value} look={look} />
        {count !== undefined && count > 1 && (
          <span className="pl-1 text-muted-foreground"> ×{count.toLocaleString('en')}</span>
        )}
        <Mark on={on} />
      </span>
      {index !== undefined && (
        <span aria-hidden className="text-xs text-muted-foreground">
          {index}
        </span>
      )}
    </li>
  )
}

function sequenceCells(o: HeapObject) {
  const start = o.window?.start ?? 0
  const recorded = o.window?.count ?? (o.sparse ? (o.length ?? 0) - start : (o.items?.length ?? 0))
  const drawn = Math.min(recorded, o.sparse ? drawnSparse : drawnCells)
  const cells = Array.from({ length: drawn }, (_, i) => {
    const index = start + i
    const value = o.sparse ? (o.sparse.items[index] ?? o.sparse.default) : o.items![i]!
    return { index, value }
  })
  return { cells, before: start, after: (o.length ?? start + recorded) - start - drawn }
}

function Cells({ id, object, look }: { id: string; object: HeapObject; look: Look }) {
  const { cells, before, after } = sequenceCells(object)
  if (cells.length === 0 && before + after === 0) {
    return <p className="text-muted-foreground">empty</p>
  }
  const changed = look.changed[id] ?? []
  return (
    <ol className="flex flex-wrap items-start gap-1">
      <Gap count={before} />
      {cells.map(({ index, value }) => (
        <Cell
          key={index}
          value={value}
          index={index}
          on={look.highlight && (changed.includes(String(index)) || inlineChanged(value, look))}
          look={look}
        />
      ))}
      <Gap count={after} />
    </ol>
  )
}

function RowTable({
  id,
  object,
  table,
  look,
}: {
  id: string
  object: HeapObject
  table: Table
  look: Look
}) {
  const moved = look.changed[id] ?? []
  const rows = table.rows.slice(0, drawnCells)
  const before = object.window?.start ?? 0
  const after = (object.length ?? 0) - before - rows.length
  return (
    <div className="overflow-x-auto">
      {before > 0 && <p className="text-muted-foreground">… +{before.toLocaleString('en')}</p>}
      <table className="font-mono">
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="pr-3 text-left font-normal">
              <span className="sr-only">index</span>
            </th>
            {table.columns.map((c) => (
              <th key={c} scope="col" className="px-2 text-left font-normal text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const fields = look.changed[row.id] ?? []
            const whole = moved.includes(String(row.index))
            return (
              <tr key={row.index} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="pr-3 text-left font-normal text-muted-foreground"
                  title={`#${row.id}`}
                >
                  {row.index}
                </th>
                {row.cells.map((value, j) => {
                  const on = look.highlight && (whole || fields.includes(table.columns[j]!))
                  return (
                    <td
                      key={table.columns[j]}
                      className={cn(
                        'px-2 transition-colors duration-(--duration-fade)',
                        on && changedClass,
                      )}
                    >
                      <ValueView value={value} look={look} />
                      <Mark on={on} />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {after > 0 && <p className="text-muted-foreground">… +{after.toLocaleString('en')}</p>}
    </div>
  )
}

const viewLabels: Record<Exclude<ViewAs, 'container'>, string> = {
  table: 'Table',
  cells: 'Cells',
  matrix: 'Matrix',
  bits: 'Bits',
  number: 'Number',
}

function ViewToggle({
  name,
  view,
  options,
  labels,
  onView,
}: {
  name: string
  view: ViewAs
  options: readonly ViewAs[]
  labels: (view: ViewAs) => string
  onView: (view: ViewAs) => void
}) {
  return (
    <div role="group" aria-label={`View ${name} as`} className="flex gap-1 font-sans">
      {options.map((v) => (
        <Button
          key={v}
          size="sm"
          variant={v === view ? 'secondary' : 'ghost'}
          aria-pressed={v === view}
          onClick={() => onView(v)}
        >
          {labels(v)}
        </Button>
      ))}
    </div>
  )
}

function SequenceBody({ card, look, marks }: Pick<CardProps, 'card' | 'look' | 'marks'>) {
  const { id, object: o, table, matrix, container, view, variable } = card
  if (container && view === 'container') {
    return <ContainerView id={id} kind={container} object={o} look={look} />
  }
  if (table && view === 'table') return <RowTable id={id} object={o} table={table} look={look} />
  if (matrix && view === 'matrix') {
    return <MatrixView name={variable ?? `#${id}`} matrix={matrix} look={look} marks={marks} />
  }
  if ((o.length ?? 0) > bigArray)
    return <BigArray name={variable ?? `#${id}`} id={id} object={o} look={look} marks={marks} />
  if (marks.indexed && !o.sparse && (o.items?.length ?? 0) === (o.length ?? 0)) {
    return (
      <ArrayView id={id} object={o} look={look} marks={marks} start={0} count={o.length ?? 0} />
    )
  }
  return <Cells id={id} object={o} look={look} />
}

function SequenceCard({ card, look, isNew, marks, pins, onView, onPin, onShowRange }: CardProps) {
  const { id, object: o, table, matrix, container, view, variable } = card
  const capacity = isRecord(o.meta) ? o.meta.capacity : undefined
  const facts = [`${look.format.sizeLabel} ${(o.length ?? 0).toLocaleString('en')}`]
  if (matrix && view === 'matrix') facts[0] = `${matrix.rows.length} × ${matrix.columns}`
  if (typeof capacity === 'number') facts.push(`cap ${capacity.toLocaleString('en')}`)
  if (o.sparse && !o.truncated) {
    const set = Object.keys(o.sparse.items).length.toLocaleString('en')
    const zero = o.sparse.default.v === '0' || o.sparse.default.v === 'false'
    facts.push(zero ? `${set} non-zero` : `${set} not ${look.format.value(o.sparse.default).text}`)
  }
  const name = variable ?? `#${id}`
  const options: ViewAs[] | null = container
    ? ['container', 'cells']
    : table
      ? ['table', 'cells']
      : matrix
        ? ['matrix', 'cells']
        : null
  const widget = container !== null && view === 'container'
  return (
    <Card
      card={card}
      isNew={isNew}
      type={look.format.typeName(o.type ?? 'sequence')}
      facts={facts}
      actions={
        <>
          {options && (
            <ViewToggle
              name={name}
              view={view}
              options={options}
              labels={(v) => (v === 'container' ? containerLabels[container!] : viewLabels[v])}
              onView={(v) => onView(name, v)}
            />
          )}
          {variable !== undefined && !(matrix && view === 'matrix') && !table && !widget && (
            <PinMarkers variable={variable} pins={pins ?? []} onPin={onPin} />
          )}
          {o.truncated && variable !== undefined && onShowRange && (
            <Button
              size="sm"
              variant="ghost"
              className="font-sans"
              onClick={() => onShowRange(variable)}
            >
              Show range…
            </Button>
          )}
        </>
      }
    >
      <SequenceBody card={card} look={look} marks={marks} />
    </Card>
  )
}

function readingOrder(a: Value, b: Value, look: Look) {
  const numeric = (v: Value) => (v.t === 'int' || v.t === 'float' ? Number(v.v) : Number.NaN)
  const [x, y] = [numeric(a), numeric(b)]
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y
  return look.format.value(a).text.localeCompare(look.format.value(b).text)
}

function SetCard({ card, look, isNew }: CardProps) {
  const { id, object: o } = card
  const changed = look.changed[id] ?? []
  const items = (o.items ?? []).map((value, i) => ({ value, on: changed.includes(String(i)) }))
  if (!o.ordered) items.sort((a, b) => readingOrder(a.value, b.value, look))
  const groups: { value: Value; on: boolean; count: number }[] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last !== undefined && same(last.value, item.value)) {
      last.count++
      last.on = last.on || item.on
    } else groups.push({ ...item, count: 1 })
  }
  return (
    <Card
      card={card}
      isNew={isNew}
      type={look.format.typeName(o.type ?? 'set')}
      facts={[`${look.format.sizeLabel} ${(o.length ?? 0).toLocaleString('en')}`]}
    >
      {items.length === 0 ? (
        <p className="text-muted-foreground">empty</p>
      ) : (
        <ol className="flex flex-wrap items-start gap-1">
          {groups.map(({ value, on, count }, i) => (
            <Cell key={i} value={value} count={count} on={look.highlight && on} look={look} />
          ))}
          <Gap count={(o.length ?? 0) - items.length} />
        </ol>
      )}
    </Card>
  )
}

function MappingCard({ card, look, isNew }: CardProps) {
  const { id, object: o } = card
  const changed = look.changed[id] ?? []
  const entries = (o.entries ?? []).map((e, i) => ({ ...e, on: changed.includes(String(i)) }))
  if (!o.ordered) entries.sort((a, b) => readingOrder(a.key, b.key, look))
  const more = (o.length ?? 0) - entries.length
  return (
    <Card
      card={card}
      isNew={isNew}
      type={look.format.typeName(o.type ?? 'mapping')}
      facts={[`${look.format.sizeLabel} ${(o.length ?? 0).toLocaleString('en')}`]}
    >
      {entries.length === 0 ? (
        <p className="text-muted-foreground">empty</p>
      ) : (
        <table className="w-full">
          <tbody>
            {entries.map((e, i) => {
              const on = look.highlight && (e.on || inlineChanged(e.value, look))
              return (
                <tr key={i} className="border-b border-border align-top last:border-b-0">
                  <th scope="row" className="py-0.5 pr-3 text-left font-normal">
                    <ValueView value={e.key} look={look} />
                  </th>
                  <td
                    className={cn(
                      'w-full py-0.5 transition-colors duration-(--duration-fade)',
                      on && changedClass,
                    )}
                  >
                    <ValueView value={e.value} look={look} />
                    <Mark on={on} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {more > 0 && <p className="text-muted-foreground">… +{more.toLocaleString('en')}</p>}
    </Card>
  )
}

function RecordCard({ card, look, isNew }: CardProps) {
  return (
    <Card card={card} isNew={isNew} type={look.format.typeName(card.object.type ?? 'record')}>
      <Fields id={card.id} object={card.object} look={look} />
    </Card>
  )
}

function FunctionCard({ card, isNew }: CardProps) {
  const { name, signature } = card.object
  return (
    <Card card={card} isNew={isNew} type="function">
      <p>{signature ?? name}</p>
    </Card>
  )
}

function ClassCard({ card, isNew }: CardProps) {
  return (
    <Card card={card} isNew={isNew} type="class">
      <p>{card.object.name}</p>
    </Card>
  )
}

function OpaqueCard({ card, look, isNew }: CardProps) {
  const { kind, type, summary } = card.object
  return (
    <Card card={card} isNew={isNew} type={look.format.typeName(type ?? kind)}>
      <p className="break-words whitespace-pre-wrap">{summary ?? `${kind} object`}</p>
    </Card>
  )
}

const cards: Record<(typeof kinds)[number], (props: CardProps) => ReactNode> = {
  sequence: SequenceCard,
  set: SetCard,
  mapping: MappingCard,
  record: RecordCard,
  function: FunctionCard,
  class: ClassCard,
  opaque: OpaqueCard,
}

function isKind(kind: string): kind is keyof typeof cards {
  return Object.hasOwn(cards, kind)
}

function sameCard(a: CardProps, b: CardProps) {
  return (
    a.isNew === b.isNew &&
    a.onView === b.onView &&
    a.onShowRange === b.onShowRange &&
    a.onPin === b.onPin &&
    sameList(a.pins, b.pins) &&
    same(a.marks, b.marks) &&
    a.card.id === b.card.id &&
    a.card.variable === b.card.variable &&
    a.card.unreachable === b.card.unreachable &&
    a.card.view === b.card.view &&
    (a.card.table === null) === (b.card.table === null) &&
    (a.card.matrix === null) === (b.card.matrix === null) &&
    a.card.container === b.card.container &&
    sameList(a.card.referrers, b.card.referrers) &&
    sameReads(a.card.reads, b.card.reads, a.look, b.look)
  )
}

// memo: synthetic-5000 re-rendered 500 cards a step, keydown to DOM 16.5 => 8.1 ms p50 (prod build)
export const HeapCard = memo(function HeapCard(props: CardProps) {
  const { kind } = props.card.object
  const Shown = isKind(kind) ? cards[kind] : OpaqueCard
  return <Shown {...props} />
}, sameCard)
