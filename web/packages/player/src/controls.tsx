import { Button } from '@viz/ui'
import type { ReactNode } from 'react'
import type { StepState } from './engine.ts'
import { stepDetail } from './step-label.ts'
import type { Settings } from './store.ts'

type ControlsProps = {
  state: StepState | null
  step: number
  stepCount: number
  playing: boolean
  speed: Settings['autoplaySpeed']
  goto: ReactNode
  story: ReactNode
  narration: string | null
  passes: ReactNode
  timeline: ReactNode
  onGo: (step: number) => void
  onStepOver: () => void
  onTogglePlay: () => void
}

export function Controls({
  state,
  step,
  stepCount,
  playing,
  speed,
  goto,
  story,
  narration,
  passes,
  timeline,
  onGo,
  onStepOver,
  onTogglePlay,
}: ControlsProps) {
  const last = stepCount - 1
  return (
    <div className="flex flex-col gap-2 px-(--pane-padding) py-2">
      <div className="flex items-center justify-between gap-3 font-mono text-xs">
        <p className="min-w-0 truncate">
          {state === null ? (
            '\u00a0'
          ) : (
            <>
              Step {state.i + 1} of {stepCount}
              <span className="text-muted-foreground"> · {stepDetail(state)}</span>
            </>
          )}
        </p>
        {passes}
      </div>
      <p className="min-h-5 truncate text-sm" aria-label="Step narration">
        {narration === null ? (
          '\u00a0'
        ) : (
          <>
            <span aria-hidden>» </span>
            {narration}
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label="First step"
          disabled={step === 0}
          onClick={() => onGo(0)}
        >
          <span aria-hidden>|◀</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous step"
          disabled={step === 0}
          onClick={() => onGo(step - 1)}
        >
          <span aria-hidden>◀</span> Prev
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next step"
          disabled={step === last}
          onClick={(e) => (e.shiftKey ? onStepOver() : onGo(step + 1))}
        >
          Next <span aria-hidden>▶</span>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Last step"
          disabled={step === last}
          onClick={() => onGo(last)}
        >
          <span aria-hidden>▶|</span>
        </Button>
        {goto}
        {story}
        <Button size="sm" aria-label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay}>
          <span aria-hidden>{playing ? '❚❚' : '▶'}</span> {playing ? 'Pause' : 'Play'} {speed}×
        </Button>
      </div>
      {timeline}
    </div>
  )
}

export function Notice({ text }: { text: string | null }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center px-(--pane-padding) pb-2"
    >
      {text !== null && (
        <p className="rounded-full bg-popover px-4 py-2 text-sm text-popover-foreground shadow-popover">
          {text}
        </p>
      )}
    </div>
  )
}
