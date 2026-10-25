import { Button, Popover, PopoverContent, PopoverTrigger } from '@viz/ui'
import { useId, useState, type FormEvent } from 'react'
import { ArrayView } from './array-view.tsx'
import { same } from './engine.ts'
import type { HeapObject, Value } from './gen/trace.ts'
import { cellValue, type CardMarks } from './marks.ts'
import type { Look } from './state-layout.ts'

export const bigArray = 64 // §19.4.2: longer arrays get the window
const windowSize = 16
const shownNonDefault = 200
const minimapBuckets = 200

function recorded(o: HeapObject) {
  const start = o.window?.start ?? 0
  if (o.sparse && !o.truncated) return { lo: 0, hi: o.length ?? 0 }
  const count = o.window?.count ?? o.items?.length ?? 0
  return { lo: start, hi: start + count }
}

function defaultOf(o: HeapObject, look: Look): Value | null {
  if (o.sparse) return o.sparse.default
  const counts = new Map<string, { value: Value; n: number }>()
  for (const v of o.items ?? []) {
    const key = look.format.value(v).text
    const c = counts.get(key)
    if (c) c.n++
    else counts.set(key, { value: v, n: 1 })
  }
  let best: { value: Value; n: number } | null = null
  for (const c of counts.values()) if (best === null || c.n > best.n) best = c
  return best?.value ?? null
}

function nonDefault(o: HeapObject, fallback: Value | null) {
  if (o.sparse) {
    return Object.keys(o.sparse.items)
      .map(Number)
      .sort((a, b) => a - b)
  }
  const start = o.window?.start ?? 0
  return (o.items ?? []).flatMap((v, i) =>
    fallback !== null && same(v, fallback) ? [] : [start + i],
  )
}

function GoToIndex({ lo, hi, onGo }: { lo: number; hi: number; onGo: (index: number) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(text.replaceAll(',', ''))
    if (text.trim() === '' || !Number.isInteger(n) || n < lo || n >= hi) {
      setError(`Enter an index from ${lo.toLocaleString('en')} to ${(hi - 1).toLocaleString('en')}`)
      return
    }
    setError(null)
    setOpen(false)
    onGo(n)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          Go to index…
        </Button>
      </PopoverTrigger>
      <PopoverContent label="Go to index">
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2 p-1 font-sans">
          <label htmlFor={inputId} className="text-sm">
            Index
          </label>
          <input
            id={inputId}
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-8 w-32 rounded-lg border border-input bg-background px-2 font-mono text-base sm:text-sm"
          />
          <Button size="sm" type="submit">
            Go
          </Button>
          {error !== null && (
            <p role="alert" className="w-full text-xs text-danger">
              {error}
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}

function Minimap({
  size,
  lo,
  hi,
  marked,
  changed,
  start,
  label,
  onPick,
}: {
  size: number
  lo: number
  hi: number
  marked: number[]
  changed: number[]
  start: number
  label: string
  onPick: (index: number) => void
}) {
  const buckets = Math.min(minimapBuckets, Math.max(size, 1))
  const at = (i: number) => Math.min(buckets - 1, Math.floor((i / size) * buckets))
  const set = new Set(marked.map(at))
  const now = new Set(changed.map(at))
  const w = Math.max(1, (windowSize / size) * buckets)
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden>{lo.toLocaleString('en')}</span>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${buckets} 10`}
        preserveAspectRatio="none"
        className="h-4 min-w-0 flex-1 cursor-pointer rounded-sm bg-background"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          if (box.width > 0) onPick(Math.floor(((e.clientX - box.left) / box.width) * size))
        }}
      >
        {[...set].map((b) => (
          <rect key={`s${b}`} x={b} y={2} width={1} height={6} className="fill-muted-foreground" />
        ))}
        {[...now].map((b) => (
          <rect key={`c${b}`} x={b} y={0} width={1} height={10} className="fill-trace-write-mark" />
        ))}
        <rect
          x={at(start)}
          y={0.5}
          width={w}
          height={9}
          className="fill-none stroke-brand"
          strokeWidth={0.6}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span aria-hidden>{(hi - 1).toLocaleString('en')}</span>
    </div>
  )
}

export function BigArray({
  name,
  id,
  object,
  look,
  marks,
}: {
  name: string
  id: string
  object: HeapObject
  look: Look
  marks: CardMarks
}) {
  const size = object.length ?? 0
  const { lo, hi } = recorded(object)
  const page = (i: number) =>
    Math.max(lo, Math.min(lo + Math.floor((i - lo) / windowSize) * windowSize, hi - windowSize))
  const fallback = defaultOf(object, look)
  const cells = nonDefault(object, fallback)
  const written = (look.changed[id] ?? []).map(Number)
  const active = marks.markers.find((m) => m.axis === 0 && !m.outside)
  const target = active?.at ?? written[0] ?? null
  const [start, setStart] = useState(() => page(target ?? cells[0] ?? lo))
  const [followed, setFollowed] = useState(target)
  if (target !== followed) {
    setFollowed(target)
    if (target !== null) setStart(page(target))
  }
  const [nonZeroOnly, setNonZeroOnly] = useState(false)
  const move = (by: number) => setStart(page(start + by))
  const count = Math.min(windowSize, hi - start)
  const defaultText = fallback === null ? null : look.format.value(fallback).text
  const followName = active ? ` (follows ${active.label})` : ''

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label={`${name}, ${size.toLocaleString('en')} cells, window ${start}–${start + count - 1}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== '[' && e.key !== ']') return
        e.preventDefault()
        move(e.key === '[' ? -windowSize : windowSize)
      }}
    >
      <Minimap
        size={size}
        lo={lo}
        hi={hi}
        marked={cells}
        changed={written}
        start={start}
        label={`minimap: ${cells.length.toLocaleString('en')} cells differ from ${defaultText ?? 'the default'}, ${written.length} changed this step, window ${start}–${start + count - 1}`}
        onPick={(i) => setStart(page(i))}
      />
      <p className="text-xs text-muted-foreground">
        <span aria-hidden>▲ </span>window {start.toLocaleString('en')}–
        {(start + count - 1).toLocaleString('en')}
        {followName}
        {object.truncated &&
          ` · only cells ${lo.toLocaleString('en')}–${(hi - 1).toLocaleString('en')} were recorded`}
      </p>
      <ArrayView
        id={id}
        object={object}
        look={look}
        marks={marks}
        start={start}
        count={count}
        before={start}
        after={size - start - count}
      />
      <div className="flex flex-wrap gap-1 font-sans">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Window back"
          disabled={start <= lo}
          onClick={() => move(-windowSize)}
        >
          ◀ Window
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Window forward"
          disabled={start + windowSize >= hi}
          onClick={() => move(windowSize)}
        >
          Window ▶
        </Button>
        <GoToIndex lo={lo} hi={hi} onGo={(i) => setStart(page(i))} />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={nonZeroOnly}
          onClick={() => setNonZeroOnly(!nonZeroOnly)}
        >
          Non-zero only
        </Button>
      </div>
      {nonZeroOnly && (
        <section aria-label="Non-zero only" className="text-xs">
          <span className="text-muted-foreground">
            Cells other than {defaultText ?? 'the default'}:{' '}
          </span>
          {cells.length === 0 && <span className="text-muted-foreground">none</span>}
          <ol className="inline">
            {cells.slice(0, shownNonDefault).map((i) => {
              const v = cellValue(object, i)
              const on = written.includes(i)
              return (
                <li key={i} className="mr-3 inline-block">
                  <button
                    type="button"
                    className="rounded-sm hover:underline"
                    onClick={() => setStart(page(i))}
                  >
                    [{i}]={v === undefined ? '?' : look.format.value(v).text}
                    {on && <span aria-hidden>*</span>}
                    {on && <span className="sr-only"> (changed)</span>}
                  </button>
                </li>
              )
            })}
          </ol>
          {cells.length > shownNonDefault && (
            <span className="text-muted-foreground">
              +{(cells.length - shownNonDefault).toLocaleString('en')} more
            </span>
          )}
        </section>
      )}
    </div>
  )
}
