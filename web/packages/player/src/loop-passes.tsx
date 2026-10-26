import { cn } from '@viz/ui'

const shownFirst = 3 // §19.8: 1 2 3 … 8

export function LoopPasses({
  line,
  passes,
  step,
  onGo,
}: {
  line: number
  passes: number[]
  step: number
  onGo: (step: number) => void
}) {
  if (passes.length === 0) return null
  const n = passes.length
  const current = passes.filter((k) => k <= step).length
  const shown = [
    ...new Set([
      ...Array.from({ length: shownFirst }, (_, k) => k + 1),
      current - 1,
      current,
      current + 1,
      n,
    ]),
  ]
    .filter((p) => p >= 1 && p <= n)
    .sort((a, b) => a - b)
  return (
    <nav
      aria-label={`Passes of the loop on line ${line}`}
      className="flex shrink-0 items-center gap-0.5 text-muted-foreground"
    >
      <span className="pr-1">pass</span>
      {shown.map((p, i) => (
        <span key={p} className="flex items-center gap-0.5">
          {i > 0 && p !== shown[i - 1]! + 1 && <span aria-hidden>…</span>}
          <button
            type="button"
            aria-label={`Pass ${p} of ${n}`}
            aria-current={p === current ? 'step' : undefined}
            onClick={() => onGo(passes[p - 1]!)}
            className={cn(
              'h-4 min-w-4 rounded-sm px-1 leading-4 transition-colors duration-(--duration-control) hover:bg-accent',
              p === current && 'bg-brand-subtle font-semibold text-foreground',
            )}
          >
            {p}
          </button>
        </span>
      ))}
    </nav>
  )
}
