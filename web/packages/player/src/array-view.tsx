import { cn } from '@viz/ui'
import type { HeapObject } from './gen/trace.ts'
import { cellValue, readClass, type CardMarks, type Marker } from './marks.ts'
import { inlineChanged, type Look } from './state-layout.ts'
import { changedClass, Mark, ValueView } from './value-view.tsx'

function Outside({ marker, size }: { marker: Marker; size: number }) {
  return (
    <li className="flex h-(--cell-size) items-center px-1 font-sans text-xs text-danger">
      {marker.at < 0 && <span aria-hidden>◀ </span>}
      {marker.label} = {marker.at}
      {marker.at >= 0 && <span aria-hidden> ▶</span>} out of range, size {size}
    </li>
  )
}

export function ArrayView({
  id,
  object,
  look,
  marks,
  start,
  count,
  before,
  after,
}: {
  id: string
  object: HeapObject
  look: Look
  marks: CardMarks
  start: number
  count: number
  before?: number
  after?: number
}) {
  const size = object.length ?? 0
  const end = start + count
  const changed = look.changed[id] ?? []
  const inside = marks.markers.filter((m) => m.axis === 0 && !m.outside)
  const outside = marks.markers.filter((m) => m.axis === 0 && m.outside)
  const cells = Array.from({ length: count }, (_, k) => start + k)
  const range = marks.range
  const shift = before ? 1 : 0
  const column = (index: number) => index - start + 1 + shift
  const gap = (n: number, at: number) => (
    <li
      className="flex h-(--cell-size) items-center px-1 whitespace-nowrap text-muted-foreground"
      style={{ gridRow: 2, gridColumn: at }}
    >
      … +{n.toLocaleString('en')}
    </li>
  )
  return (
    <div className="overflow-x-auto">
      <ol
        className="grid w-max items-start gap-x-1"
        style={{
          gridTemplateColumns: `repeat(${count + shift + (after ? 1 : 0)}, minmax(var(--cell-size), auto))`,
        }}
      >
        {before ? gap(before, 1) : null}
        {marks.indexed &&
          cells.map((index) => {
            const here = inside.filter((m) => m.at === index)
            return (
              <li
                key={`m${index}`}
                aria-hidden
                className="flex min-h-8 flex-col items-center justify-end self-end text-xs text-trace-index"
                style={{ gridRow: 1, gridColumn: column(index) }}
              >
                {here.length > 0 && (
                  <>
                    <span className="whitespace-nowrap">{here.map((m) => m.label).join(' ')}</span>
                    <span>▼</span>
                  </>
                )}
              </li>
            )
          })}
        {cells.map((index) => {
          const value = cellValue(object, index)
          if (value === undefined) return null
          const on =
            look.highlight && (changed.includes(String(index)) || inlineChanged(value, look))
          const read = marks.reads.includes(String(index))
          const here = inside.filter((m) => m.at === index)
          return (
            <li
              key={index}
              className="flex flex-col items-center gap-0.5"
              style={{ gridRow: 2, gridColumn: column(index) }}
            >
              <span
                className={cn(
                  'flex h-(--cell-size) w-full items-center justify-center rounded-sm bg-background px-1.5 transition-colors duration-(--duration-fade)',
                  on && changedClass,
                  read && readClass,
                )}
                title={read ? `read${marks.inferred ? ' (inferred)' : ''}` : undefined}
              >
                <span className="sr-only">
                  [{index}]{here.length > 0 && ` ${here.map((m) => m.label).join(', ')}`}{' '}
                </span>
                {read && <span aria-hidden>(</span>}
                <ValueView value={value} look={look} />
                {read && <span aria-hidden>)</span>}
                {read && <span className="sr-only"> (read{marks.inferred && ', inferred'})</span>}
                <Mark on={on} />
              </span>
              <span aria-hidden className="text-xs text-muted-foreground">
                {index}
              </span>
            </li>
          )
        })}
        {after ? gap(after, count + shift + 1) : null}
        {range && !range.empty && range.to >= start && range.from < end && (
          <li
            className="flex flex-col text-xs text-trace-index"
            style={{
              gridRow: 3,
              gridColumn: `${column(Math.max(range.from, start))} / ${column(Math.min(range.to, end - 1)) + 1}`,
            }}
          >
            <span aria-hidden className="mx-2 h-1.5 border-x border-b border-trace-index" />
            <span className="text-center">{range.label}</span>
          </li>
        )}
      </ol>
      {range?.empty && (
        <p className="pt-1 font-sans text-xs text-trace-index">
          {range.label}: empty range ({range.from} &gt; {range.to})
        </p>
      )}
      {outside.length > 0 && (
        <ol className="flex flex-wrap gap-2">
          {outside.map((m) => (
            <Outside key={m.label} marker={m} size={size} />
          ))}
        </ol>
      )}
      {marks.hidden > 0 && <p className="text-xs text-trace-index">+{marks.hidden} more markers</p>}
    </div>
  )
}
