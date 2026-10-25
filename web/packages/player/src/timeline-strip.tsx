import { Button, cn } from '@viz/ui'
import { Fragment, useEffect, useRef, useState } from 'react'

const kinds = ['error', 'call', 'print', 'read'] as const
type Kind = (typeof kinds)[number]

export type TimelineEvents = Record<Kind, number[]>
export type Lane = { target: string; changes: number[] | null }

type Placed = { step: number; kind: Kind | 'change'; at: number; more: number }

const markerPx = 16

const glyphs: Record<Placed['kind'], string> = {
  error: '!',
  call: '▲',
  print: '■',
  read: '◆',
  change: '┼',
}

const colors: Record<Placed['kind'], string> = {
  error: 'text-trace-error-mark',
  call: 'text-trace-executed-mark',
  print: 'text-foreground',
  read: 'text-trace-index',
  change: 'text-foreground',
}

// crowded => one marker per markerPx slot, by kind order, so markers never overlap
function place(events: [Placed['kind'], number[]][], stepCount: number, width: number) {
  const last = stepCount - 1
  const slots = width > 0 ? Math.max(1, Math.floor(width / markerPx)) : Infinity
  const crowded = stepCount > slots
  const placed = new Map<number, Placed>()
  for (const [kind, steps] of events) {
    for (const step of steps) {
      const slot = crowded ? Math.floor((step / stepCount) * slots) : step
      const hit = placed.get(slot)
      if (hit) {
        hit.more++
        continue
      }
      const at = crowded ? (slot + 0.5) / slots : last === 0 ? 0 : step / last
      placed.set(slot, { step, kind, at, more: 0 })
    }
  }
  return [...placed.values()]
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function eventLabel(marker: Placed, callee: string | null, target: string, narration?: string) {
  const at = `step ${marker.step + 1}`
  const what = {
    error: `Error at ${at}`,
    call: `Call of ${callee} at ${at}`,
    print: `Printed at ${at}`,
    read: `Input read at ${at}`,
    change: `${target} set or changed at ${at}`,
  }[marker.kind]
  const more = marker.more > 0 ? `, ${marker.more} more nearby` : ''
  return `${what}${more}${narration === undefined ? '' : `: ${narration}`}`
}

export function TimelineStrip({
  step,
  stepCount,
  events,
  callee,
  lanes,
  lane,
  narrations,
  onGo,
  onScrub,
  onLane,
}: {
  step: number
  stepCount: number
  events: TimelineEvents
  callee: string | null
  lanes: Lane[]
  lane: string | null
  narrations: string[]
  onGo: (step: number) => void
  onScrub: (step: number) => void
  onLane: (target: string) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [track, width] = useWidth()
  const slider = useRef<HTMLInputElement>(null)
  const last = stepCount - 1
  const left = (at: number) => `${at * 100}%`
  const markers = place(
    kinds.map((k) => [k, events[k]]),
    stepCount,
    width,
  )
  const shown = new Set(markers.map((m) => m.kind))
  const selected = lanes.find((l) => l.target === lane) ?? lanes[0]
  const changes = selected?.changes ?? []
  const previous = changes.findLast((k) => k < step)
  const next = changes.find((k) => k > step)

  const markerButton = (marker: Placed, target: string) => (
    <button
      key={`${marker.kind}${marker.step}`}
      type="button"
      aria-label={eventLabel(marker, callee, target, narrations[marker.step])}
      className={cn(
        'absolute top-1/2 z-10 flex size-4 -translate-1/2 items-center justify-center rounded-sm bg-background text-xs leading-none hover:bg-accent focus-visible:bg-accent',
        colors[marker.kind],
      )}
      style={{ left: left(marker.at) }}
      onFocus={() => setHovered(marker.step)}
      onBlur={() => setHovered(null)}
      onClick={() => onGo(marker.step)}
    >
      <span aria-hidden>{glyphs[marker.kind]}</span>
    </button>
  )

  return (
    <div
      onPointerMove={(event) => {
        const rect = slider.current!.getBoundingClientRect()
        if (rect.width === 0) return
        const index = Math.round(((event.clientX - rect.left) / rect.width) * last)
        setHovered(Math.max(0, Math.min(last, index)))
      }}
      onPointerLeave={() => setHovered(null)}
    >
      <p role="tooltip" className="min-h-4 truncate text-xs text-muted-foreground">
        {hovered === null
          ? ' '
          : `Step ${hovered + 1}: ${narrations[hovered] ?? 'Loading narration…'}`}
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
        <span className="font-mono text-xs text-muted-foreground">
          {lanes.length > 0 && 'events'}
        </span>
        <div ref={track} className="relative h-6">
          <span
            aria-hidden
            className="absolute top-1/2 -translate-1/2 text-xs leading-none text-brand"
            style={{ left: left(last === 0 ? 0 : step / last) }}
          >
            ●
          </span>
          {markers.map((m) => markerButton(m, ''))}
        </div>
        <span />
        <input
          ref={slider}
          type="range"
          min={1}
          max={stepCount}
          value={step + 1}
          aria-label="Step"
          aria-valuetext={`Step ${step + 1} of ${stepCount}`}
          onFocus={() => setHovered(step)}
          onBlur={() => setHovered(null)}
          onChange={(event) => onScrub(event.currentTarget.valueAsNumber - 1)}
          className="w-full accent-primary"
        />
        {lanes.map((l) => (
          <Fragment key={l.target}>
            <Button
              size="sm"
              variant={l === selected ? 'secondary' : 'ghost'}
              aria-pressed={l === selected}
              aria-label={`Lane ${l.target}`}
              className="h-5 justify-start px-1 font-mono text-xs"
              onClick={() => onLane(l.target)}
            >
              {l.target}
            </Button>
            <div className="relative h-5" aria-label={`Changes of ${l.target}`} role="group">
              <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-border" />
              <span
                aria-hidden
                className="absolute inset-y-0 border-l border-brand"
                style={{ left: left(last === 0 ? 0 : step / last) }}
              />
              {l.changes === null ? (
                <span className="absolute top-0 left-0 text-xs text-muted-foreground">…</span>
              ) : (
                place([['change', l.changes]], stepCount, width).map((m) =>
                  markerButton(m, l.target),
                )
              )}
            </div>
          </Fragment>
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        {shown.has('read') && <span>◆ input read</span>}
        {shown.has('print') && <span>■ printed</span>}
        {shown.has('call') && <span>▲ call of {callee}</span>}
        {shown.has('error') && <span>! error</span>}
        {lanes.length > 0 && <span>┼ value set or changed</span>}
        <span>● you are here</span>
      </p>
      {selected && (
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={previous === undefined}
            onClick={() => onGo(previous!)}
          >
            <span aria-hidden>◀</span> Prev change of {selected.target}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={next === undefined}
            onClick={() => onGo(next!)}
          >
            Next change of {selected.target} <span aria-hidden>▶</span>
          </Button>
        </div>
      )}
    </div>
  )
}
