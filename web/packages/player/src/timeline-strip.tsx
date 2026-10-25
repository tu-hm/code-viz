import { Button, cn } from '@viz/ui'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

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

function Key({ kind, children }: { kind: Placed['kind']; children: ReactNode }) {
  return (
    <span>
      <span aria-hidden className={colors[kind]}>
        {glyphs[kind]}
      </span>{' '}
      {children}
    </span>
  )
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
        'absolute top-1/2 z-10 flex size-4 -translate-1/2 items-center justify-center rounded-sm bg-background text-sm leading-none hover:bg-accent focus-visible:bg-accent',
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
        {lanes.length > 0 && (
          <div className="col-span-2 grid max-h-[calc(4*1.25rem)] grid-cols-subgrid items-center overflow-y-auto">
            {lanes.map((l) => (
              <Fragment key={l.target}>
                <Button
                  size="sm"
                  variant={l === selected ? 'secondary' : 'ghost'}
                  aria-pressed={l === selected}
                  aria-label={`Lane ${l.target}`}
                  className="h-5 justify-start px-1 font-mono text-xs font-normal"
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
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground">
        {shown.has('read') && <Key kind="read">input read</Key>}
        {shown.has('print') && <Key kind="print">printed</Key>}
        {shown.has('call') && (
          <Key kind="call">
            call of <code className="font-mono">{callee}</code>
          </Key>
        )}
        {shown.has('error') && <Key kind="error">error</Key>}
        {lanes.length > 0 && <Key kind="change">value set or changed</Key>}
        <span>
          <span aria-hidden className="text-primary">
            ●
          </span>{' '}
          you are here
        </span>
        {selected && (
          <span className="ml-auto flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              disabled={previous === undefined}
              onClick={() => onGo(previous!)}
            >
              <span aria-hidden>◀</span> Prev change of{' '}
              <code className="font-mono">{selected.target}</code>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              disabled={next === undefined}
              onClick={() => onGo(next!)}
            >
              Next change of <code className="font-mono">{selected.target}</code>{' '}
              <span aria-hidden>▶</span>
            </Button>
          </span>
        )}
      </div>
    </div>
  )
}
