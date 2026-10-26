import { Button, cn } from '@viz/ui'
import { useState } from 'react'
import type { Value } from './gen/trace.ts'
import { isDefault, readClass, type CardMarks, type Marker } from './marks.ts'
import type { Look, Matrix } from './state-layout.ts'
import { ValueView } from './value-view.tsx'

const shownRefs = 6
const heat = ['bg-trace-heat/15', 'bg-trace-heat/25', 'bg-trace-heat/40']

function numeric(v: Value) {
  return v.t === 'int' || v.t === 'float' ? Number(v.v) : null
}

const field = 'h-8 rounded-lg border border-input bg-background px-2 font-mono text-base sm:text-sm'

// a string one shorter than its side labels from index 1: dp[0] is the empty prefix
function charAt(chars: string[] | undefined, size: number, i: number) {
  if (chars === undefined) return null
  return chars[i - (size - chars.length)] ?? ''
}

function Label({ char }: { char: string | null }) {
  if (char === null) return null
  if (char === '') return <span className="sr-only"> empty prefix</span>
  return <span className="font-semibold text-foreground"> {char}</span>
}

function MarkerLabel({ markers, size }: { markers: Marker[]; size: number }) {
  if (markers.length === 0) return null
  return (
    <span className={cn('whitespace-nowrap', markers.some((m) => m.outside) && 'text-danger')}>
      {markers.map((m) => `${m.label}=${m.at}`).join(' ')}
      {markers.some((m) => m.outside) && ` out of range, size ${size}`}
    </span>
  )
}

export function MatrixView({
  name,
  matrix,
  look,
  marks,
}: {
  name: string
  matrix: Matrix
  look: Look
  marks: CardMarks
}) {
  const [tinted, setTinted] = useState(false)
  const [rowsBy, setRowsBy] = useState<string | null>(null)
  const [columnsBy, setColumnsBy] = useState<string | null>(null)
  const { rows, columns } = matrix
  const fit = (n: number) =>
    marks.labels.filter((l) => l.chars.length === n || l.chars.length === n - 1)
  const rowOptions = fit(rows.length)
  const columnOptions = fit(columns)
  const rowChars = rowOptions.find((l) => l.name === rowsBy)?.chars
  const columnChars = columnOptions.find((l) => l.name === columnsBy)?.chars
  const pick = rowOptions[0]
  const pickColumns = columnOptions.find((l) => l.name !== pick?.name) ?? columnOptions[0]
  const grid = rows.map((r) => look.heap[r.id]?.items ?? [])
  const edge = (m: Marker, size: number) => (m.outside ? (m.at < 0 ? 0 : size - 1) : m.at)
  const rowMarkers = (r: number) =>
    marks.markers.filter((m) => m.axis === 0 && edge(m, rows.length) === r)
  const colMarkers = (c: number) =>
    marks.markers.filter((m) => m.axis === 1 && edge(m, columns) === c)
  let [low, high] = [Infinity, -Infinity]
  for (const v of grid.flat()) {
    const n = numeric(v)
    if (n === null) continue
    low = Math.min(low, n)
    high = Math.max(high, n)
  }
  const level = (v: Value) => {
    const n = numeric(v)
    if (!tinted || n === null || !(high > low)) return null
    return heat[Math.min(2, Math.floor(((n - low) / (high - low)) * 3))]
  }
  const more = rows.length - shownRefs

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {marks.narration !== null && (
          <p className="font-sans text-sm">
            <span aria-hidden>» </span>
            {marks.narration}
          </p>
        )}
        {pick !== undefined &&
          pickColumns !== undefined &&
          rowsBy === null &&
          columnsBy === null && (
            <Button
              size="sm"
              variant="secondary"
              className="font-sans"
              onClick={() => {
                setRowsBy(pick.name)
                setColumnsBy(pickColumns.name)
              }}
            >
              Label rows by {pick.name}, columns by {pickColumns.name}
            </Button>
          )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto font-sans"
          aria-pressed={tinted}
          onClick={() => setTinted(!tinted)}
        >
          Heat tint
        </Button>
      </div>
      {(rowOptions.length > 0 || columnOptions.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-sm">
          {[
            ['rows', rowOptions, rowsBy, setRowsBy] as const,
            ['columns', columnOptions, columnsBy, setColumnsBy] as const,
          ].map(([axis, options, value, set]) => (
            <label key={axis} className="flex items-center gap-2">
              Label {axis} by
              <select
                value={value ?? ''}
                onChange={(e) => set(e.currentTarget.value === '' ? null : e.currentTarget.value)}
                className={field}
              >
                <option value="">index</option>
                {options.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="max-h-[calc(31*(var(--cell-size)+0.25rem))] max-w-full overflow-auto">
        <table
          aria-label={`${name}, ${rows.length} by ${columns}`}
          className="border-separate border-spacing-1 text-center"
        >
          <thead className="sticky top-0 z-10 bg-card">
            <tr aria-hidden className="text-xs text-trace-index">
              <td />
              {Array.from({ length: columns }, (_, c) => {
                const here = colMarkers(c)
                return (
                  <td key={c} className="align-bottom">
                    <MarkerLabel markers={here} size={columns} />
                    {here.length > 0 && <div>▼</div>}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td />
              {Array.from({ length: columns }, (_, c) => (
                <th key={c} scope="col" className="text-xs font-normal text-muted-foreground">
                  {c}
                  <Label char={charAt(columnChars, columns, c)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const here = rowMarkers(r)
              const written = look.changed[row.id] ?? []
              return (
                <tr key={row.index}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card pr-1 text-right text-xs font-normal whitespace-nowrap text-muted-foreground"
                  >
                    {here.length > 0 && (
                      <span className="text-trace-index">
                        <MarkerLabel markers={here} size={rows.length} /> <span aria-hidden>▶</span>
                      </span>
                    )}{' '}
                    <span className={cn(here.length > 0 && 'sr-only')}>{row.index}</span>
                    <Label char={charAt(rowChars, rows.length, r)} />
                  </th>
                  {grid[r]!.map((value, c) => {
                    const write = look.highlight && written.includes(String(c))
                    const read = marks.reads.includes(`${r},${c}`)
                    const unset = isDefault(value)
                    return (
                      <td
                        key={c}
                        data-cell={`${row.index},${c}`}
                        className={cn(
                          'h-(--cell-size) min-w-(--cell-size) rounded-sm bg-background px-1.5 whitespace-nowrap transition-colors duration-(--duration-fade)',
                          level(value),
                          write && 'bg-trace-write font-semibold',
                          read && readClass,
                        )}
                        title={read ? `read${marks.inferred ? ' (inferred)' : ''}` : undefined}
                      >
                        {write && (
                          <span aria-hidden className="text-trace-write-mark">
                            [
                          </span>
                        )}
                        {read && <span aria-hidden>(</span>}
                        {unset && !write ? (
                          <span className="text-trace-unset">
                            <span aria-hidden>·</span>
                            <span className="sr-only">not set</span>
                          </span>
                        ) : (
                          <ValueView value={value} look={look} />
                        )}
                        {read && <span aria-hidden>)</span>}
                        {write && (
                          <span aria-hidden className="text-trace-write-mark">
                            ]
                          </span>
                        )}
                        {write && <span className="sr-only"> (written this step)</span>}
                        {read && (
                          <span className="sr-only"> (read{marks.inferred && ', inferred'})</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap gap-x-6 text-xs text-muted-foreground">
        <span>[x] written this step</span>
        <span>(x) read this step{marks.inferred && ' (inferred)'}</span>
        <span>· not set yet</span>
      </p>
      <p className="text-xs text-muted-foreground">
        rows{' '}
        {rows
          .slice(0, shownRefs)
          .map((r) => `#${r.id}`)
          .join(' ')}
        {more > 0 && ` +${more} more`} are folded into the grid
      </p>
    </div>
  )
}
