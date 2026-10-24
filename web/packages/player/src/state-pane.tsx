import { Button, cn } from '@viz/ui'
import { memo, useEffect, useId, useRef, type Ref } from 'react'
import { HeapCard } from './cards.tsx'
import type { StepState } from './engine.ts'
import { formatterFor } from './format.ts'
import {
  inlineChanged,
  layoutState,
  sameList,
  sameReads,
  type FrameView,
  type Look,
} from './state-layout.ts'
import type { Settings, ViewAs } from './store.ts'
import { changedClass, Mark, ValueView } from './value-view.tsx'

type StatePaneProps = {
  state: StepState | null
  languageId: string
  pointers: boolean
  settings: Pick<Settings, 'showInternals' | 'showUnreachable' | 'highlightChanges'>
  views: Record<string, ViewAs>
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
    sameReads(a.view.reads, b.view.reads, a.look, b.look)
  )
}

// memo: as HeapCard; synthetic-5000's globals frame holds 500 locals
const FrameTable = memo(function FrameTable({
  view,
  active,
  changed,
  look,
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
              return (
                <tr key={l.name} className={rowClass}>
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
                    <ValueView value={l.value} look={look} />
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

export function StatePane({
  state,
  languageId,
  pointers,
  settings,
  views,
  onShowInternals,
  onFrameLine,
  onView,
  onShowRange,
}: StatePaneProps) {
  const stackId = useId()
  const heapId = useId()
  const activeFrame = useRef<HTMLDivElement>(null)
  const activeId = state?.stack.at(-1)?.id

  useEffect(() => {
    activeFrame.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  if (state === null) return null
  const format = formatterFor(languageId)
  const { frames, cards, inline, nested } = layoutState(state, { ...settings, views, format })
  const look: Look = {
    format,
    heap: state.heap,
    inline,
    nested,
    changed: state.changed.cells,
    highlight: settings.highlightChanges,
  }
  const fresh = new Set(state.newObjects)

  return (
    <div className="@container flex flex-col gap-4 p-(--pane-padding)">
      <div className="grid items-start gap-6 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby={stackId} className="flex min-w-0 flex-col gap-3">
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
                onLine={onFrameLine}
                onShowInternals={onShowInternals}
              />
            )
          })}
        </section>
        <section aria-labelledby={heapId} className="flex min-w-0 flex-col gap-3">
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
              onView={onView}
              onShowRange={onShowRange}
            />
          ))}
        </section>
      </div>
      <p className="flex flex-wrap gap-x-6 font-mono text-xs text-muted-foreground">
        {settings.highlightChanges && <span>* changed since the previous step</span>}
        <span>· not set yet</span>
        {pointers && <span>∅ null pointer</span>}
      </p>
    </div>
  )
}
