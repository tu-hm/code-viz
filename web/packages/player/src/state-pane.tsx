import { Button, cn, Popover, PopoverAnchor, PopoverContent } from '@viz/ui'
import { memo, useEffect, useId, useRef, useState, type Ref } from 'react'
import { ArrowOverlay } from './arrow-overlay.tsx'
import { HeapCard } from './cards.tsx'
import { same, type StepState } from './engine.ts'
import { formatterFor } from './format.ts'
import { IndexedString } from './indexed-string.tsx'
import { marksFor, stringMarkers, type Marker } from './marks.ts'
import type { SourceFacts } from './source-facts.ts'
import {
  inlineChanged,
  layoutState,
  sameList,
  sameReads,
  type CardView,
  type FrameView,
  type Look,
} from './state-layout.ts'
import type { Settings, ViewAs } from './store.ts'
import { changedClass, Mark, ValueView } from './value-view.tsx'

type StatePaneProps = {
  state: StepState | null
  languageId: string
  pointers: boolean
  settings: Pick<
    Settings,
    | 'showInternals'
    | 'showUnreachable'
    | 'highlightChanges'
    | 'drawArrows'
    | 'showAddresses'
    | 'matrixView'
  >
  views: Record<string, ViewAs>
  facts: SourceFacts | null
  pins: Record<string, string[]>
  onPin: (variable: string, names: string[]) => void
  onWatch: (target: string) => void
  onShowInternals: () => void
  onFrameLine: (line: number) => void
  onView: (variable: string, view: ViewAs) => void
  onShowRange?: (variable: string) => void
}

const rowClass = 'h-(--row-height) border-b border-border align-top last:border-b-0'

type FrameProps = {
  view: FrameView
  active: boolean
  changed: string[] | undefined
  look: Look
  strings: Record<string, Marker[]> | undefined
  onLine: (line: number) => void
  onShowInternals: () => void
  ref?: Ref<HTMLDivElement>
}

function sameFrame(a: FrameProps, b: FrameProps) {
  return (
    a.view.frame === b.view.frame &&
    a.view.hidden === b.view.hidden &&
    a.view.locals.length === b.view.locals.length &&
    a.active === b.active &&
    a.onLine === b.onLine &&
    a.onShowInternals === b.onShowInternals &&
    sameList(a.changed, b.changed) &&
    same(a.strings, b.strings) &&
    sameReads(a.view.reads, b.view.reads, a.look, b.look)
  )
}

// memo: as HeapCard; synthetic-5000's globals frame holds 500 locals
const FrameTable = memo(function FrameTable({
  view,
  active,
  changed,
  look,
  strings,
  onLine,
  onShowInternals,
  ref,
}: FrameProps) {
  const { frame, locals, hidden } = view
  const name = frame.kind === 'global' ? 'Globals' : `${frame.name}()`
  return (
    <div ref={ref} className="flex flex-col gap-1">
      <div
        className={cn(
          'rounded-xl bg-card px-3 pb-1.5',
          active && 'outline-2 -outline-offset-2 outline-brand',
        )}
      >
        <table className="w-full font-mono text-(length:--code-font-size)">
          <caption className="border-b border-border-strong py-1.5 text-left">
            <button
              type="button"
              onClick={() => onLine(frame.line)}
              className="rounded-sm font-medium hover:underline"
            >
              {name}
              <span className="font-normal text-muted-foreground"> · line {frame.line}</span>
            </button>
          </caption>
          <tbody>
            {locals.map((l) => {
              const on =
                look.highlight &&
                (changed?.includes(l.name) === true || inlineChanged(l.value, look))
              const marked = l.value.t === 'str' ? strings?.[l.name] : undefined
              return (
                <tr key={l.name} data-local={l.name} className={rowClass}>
                  <th
                    scope="row"
                    className={cn(
                      'py-0.5 pr-3 text-left font-normal',
                      l.internal && 'text-muted-foreground',
                    )}
                  >
                    {l.name}
                  </th>
                  <td
                    className={cn(
                      'w-full py-0.5 break-all transition-colors duration-(--duration-fade)',
                      on && changedClass,
                    )}
                  >
                    {marked ? (
                      <IndexedString value={l.value} markers={marked} />
                    ) : (
                      <ValueView value={l.value} look={look} />
                    )}
                    <Mark on={on} />
                  </td>
                </tr>
              )
            })}
            {frame.returnValue && (
              <tr className={rowClass}>
                <th scope="row" className="py-0.5 pr-3 text-left font-normal text-muted-foreground">
                  return
                </th>
                <td className="w-full py-0.5 break-all">
                  <ValueView value={frame.returnValue} look={look} />
                </td>
              </tr>
            )}
            {locals.length === 0 && !frame.returnValue && (
              <tr className={rowClass}>
                <td colSpan={2} className="py-0.5 font-sans text-muted-foreground">
                  no variables yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {active && <p className="px-3 text-xs text-muted-foreground">▲ active frame</p>}
      {hidden > 0 && (
        <p className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
          hidden: {hidden} {hidden === 1 ? 'internal' : 'internals'}
          <Button size="sm" variant="ghost" onClick={onShowInternals}>
            Show
          </Button>
        </p>
      )}
    </div>
  )
}, sameFrame)

function watchTarget(el: EventTarget, cards: CardView[]) {
  if (!(el instanceof Element)) return null
  const name = el.closest('[data-local]')?.getAttribute('data-local')
  if (name != null) return name
  const cell = el.closest('[data-cell]')?.getAttribute('data-cell')
  const id = el.closest('[data-card]')?.getAttribute('data-card')
  if (cell == null || id == null) return null
  const variable = cards.find((c) => c.id === id)?.variable
  if (variable === undefined) return null
  return `${variable}${cell
    .split(',')
    .map((i) => `[${i}]`)
    .join('')}`
}

export function StatePane({
  state,
  languageId,
  pointers,
  settings,
  views,
  facts,
  pins,
  onPin,
  onWatch,
  onShowInternals,
  onFrameLine,
  onView,
  onShowRange,
}: StatePaneProps) {
  const stackId = useId()
  const heapId = useId()
  const activeFrame = useRef<HTMLDivElement>(null)
  const stack = useRef<HTMLElement>(null)
  const heap = useRef<HTMLElement>(null)
  const activeId = state?.stack.at(-1)?.id
  const [menu, setMenu] = useState<{ target: string; x: number; y: number } | null>(null)

  useEffect(() => {
    activeFrame.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  if (state === null) return null
  const format = formatterFor(languageId)
  const layout = layoutState(state, { ...settings, views, format })
  const { frames, cards, inline, nested } = layout
  const look: Look = {
    format,
    heap: state.heap,
    inline,
    nested,
    changed: state.changed.cells,
    highlight: settings.highlightChanges,
    addresses: settings.showAddresses,
  }
  const fresh = new Set(state.newObjects)
  const strings = stringMarkers(state, facts)

  return (
    <div
      className="@container relative flex flex-col gap-4 p-(--pane-padding)"
      onContextMenu={(e) => {
        const target = watchTarget(e.target, cards)
        if (target === null) return
        e.preventDefault()
        setMenu({ target, x: e.clientX, y: e.clientY })
      }}
    >
      <div className="grid items-start gap-6 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section ref={stack} aria-labelledby={stackId} className="flex min-w-0 flex-col gap-3">
          <h2 id={stackId} className="mono-label text-muted-foreground">
            Stack
          </h2>
          {frames.map((view, i) => {
            const active = i === frames.length - 1
            return (
              <FrameTable
                key={view.frame.id}
                ref={active ? activeFrame : undefined}
                view={view}
                active={active}
                changed={state.changed.locals[view.frame.id]}
                look={look}
                strings={active || view.frame.kind === 'global' ? strings : undefined}
                onLine={onFrameLine}
                onShowInternals={onShowInternals}
              />
            )
          })}
        </section>
        <section ref={heap} aria-labelledby={heapId} className="flex min-w-0 flex-col gap-3">
          <h2 id={heapId} className="mono-label text-muted-foreground">
            Heap
          </h2>
          {cards.length === 0 && <p className="text-muted-foreground">No objects yet.</p>}
          {cards.map((card) => (
            <HeapCard
              key={card.id}
              card={card}
              look={look}
              isNew={fresh.has(card.id)}
              marks={marksFor(card, state, facts, format, pins[card.variable ?? ''] ?? [])}
              pins={card.variable === undefined ? undefined : pins[card.variable]}
              onView={onView}
              onPin={onPin}
              onShowRange={onShowRange}
            />
          ))}
        </section>
      </div>
      <p className="flex flex-wrap gap-x-6 font-mono text-xs text-muted-foreground">
        {settings.highlightChanges && <span>* changed since the previous step</span>}
        <span>· not set yet</span>
        {pointers && <span>∅ null pointer</span>}
        {pointers && <span>focus or hover ● to see the address</span>}
      </p>
      <ArrowOverlay redrawOn={layout} draw={settings.drawArrows} stack={stack} heap={heap} />
      <Popover open={menu !== null} onOpenChange={(open) => !open && setMenu(null)}>
        <PopoverAnchor asChild>
          <span className="fixed size-0" style={{ left: menu?.x, top: menu?.y }} />
        </PopoverAnchor>
        {menu !== null && (
          <PopoverContent label={`Actions for ${menu.target}`} side="bottom" className="w-auto p-1">
            <Button
              size="sm"
              variant="ghost"
              className="justify-start"
              onClick={() => {
                onWatch(menu.target)
                setMenu(null)
              }}
            >
              Pin <code className="font-mono">{menu.target}</code> to watch
            </Button>
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
