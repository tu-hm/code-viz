import { cn } from '@viz/ui'
import type { Value } from './gen/trace.ts'
import type { Marker } from './marks.ts'

const shownChars = 64

export function IndexedString({ value, markers }: { value: Value; markers: Marker[] }) {
  const chars = [...(value.v ?? '')]
  const shown = chars.slice(0, shownChars)
  const outside = markers.filter((m) => m.outside)
  return (
    <span className="inline-flex flex-col">
      <span
        className="inline-grid w-max"
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(1ch, auto))` }}
      >
        {shown.map((ch, i) => {
          const here = markers.filter((m) => !m.outside && m.at === i)
          return (
            <span key={i} className="flex flex-col items-center">
              <span aria-hidden className="text-xs text-trace-index">
                {here.length > 0 ? here.map((m) => m.label).join(' ') : '\u00a0'}
              </span>
              <span aria-hidden className="text-xs text-trace-index">
                {here.length > 0 ? '▼' : '\u00a0'}
              </span>
              <span className={cn(here.length > 0 && 'rounded-sm bg-background px-0.5')}>
                {ch === ' ' ? '␣' : ch}
              </span>
            </span>
          )
        })}
      </span>
      <span className="sr-only">
        {markers
          .filter((m) => !m.outside)
          .map((m) => `${m.label} at ${m.at}`)
          .join(', ')}
      </span>
      {chars.length > shownChars && (
        <span className="text-xs text-muted-foreground">
          … +{(chars.length - shownChars).toLocaleString('en')}
        </span>
      )}
      {outside.map((m) => (
        <span key={m.label} className="font-sans text-xs text-danger">
          {m.label} = {m.at} <span aria-hidden>▶</span> out of range, size {chars.length}
        </span>
      ))}
    </span>
  )
}
