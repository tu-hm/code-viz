import type { KeyboardEvent, PointerEvent } from 'react'
import { splitRange } from './store.ts'

const keyStep = 0.05

function clamp(split: number) {
  return Math.min(Math.max(split, splitRange[0]), splitRange[1])
}

export function Divider({ split, onSplit }: { split: number; onSplit: (split: number) => void }) {
  function drag(e: PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const box = e.currentTarget.parentElement!.getBoundingClientRect()
    onSplit(clamp((e.clientX - box.left) / box.width))
  }

  function nudge(e: KeyboardEvent<HTMLDivElement>) {
    let by = 0
    if (e.key === 'ArrowLeft') by = -keyStep
    if (e.key === 'ArrowRight') by = keyStep
    if (by === 0) return
    e.preventDefault()
    onSplit(clamp(split + by))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
      aria-valuemin={splitRange[0] * 100}
      aria-valuemax={splitRange[1] * 100}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={drag}
      onKeyDown={nudge}
      className="relative row-span-2 w-2 cursor-col-resize touch-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border hover:before:bg-border-strong"
    />
  )
}
