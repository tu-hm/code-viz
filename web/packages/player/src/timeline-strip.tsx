import { useState } from 'react'

export function TimelineStrip({
  step,
  stepCount,
  reads,
  narrations,
  onGo,
  onScrub,
}: {
  step: number
  stepCount: number
  reads: number[]
  narrations: string[]
  onGo: (step: number) => void
  onScrub: (step: number) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const last = stepCount - 1
  return (
    <div
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (rect.width === 0) return
        const index = Math.round(((event.clientX - rect.left) / rect.width) * last)
        setHovered(Math.max(0, Math.min(last, index)))
      }}
      onPointerLeave={() => setHovered(null)}
    >
      <p role="tooltip" className="min-h-4 truncate text-xs text-muted-foreground">
        {hovered === null
          ? '\u00a0'
          : `Step ${hovered + 1}: ${narrations[hovered] ?? 'Loading narration…'}`}
      </p>
      <div className="relative h-6">
        {reads.map((index) => (
          <button
            key={index}
            type="button"
            aria-label={`Input read at step ${index + 1}: ${narrations[index]}`}
            title={narrations[index]}
            className="absolute top-0 flex size-6 -translate-x-1/2 items-center justify-center rounded-full text-xs text-trace-index hover:bg-accent focus-visible:bg-accent"
            style={{ left: `${last === 0 ? 0 : (index / last) * 100}%` }}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
            onClick={() => onGo(index)}
          >
            <span aria-hidden>◆</span>
          </button>
        ))}
      </div>
      <input
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
      {reads.length > 0 && <p className="text-xs text-muted-foreground">◆ input read</p>}
    </div>
  )
}
