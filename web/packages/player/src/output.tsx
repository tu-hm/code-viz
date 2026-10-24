import { cn } from '@viz/ui'
import type { ReactNode } from 'react'
import type { OutputSegment } from './engine.ts'

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-h-0 flex-col gap-1 bg-muted py-2">
      <h2 className="mono-label px-(--pane-padding) text-muted-foreground">{label}</h2>
      {children}
    </section>
  )
}

const text =
  'px-(--pane-padding) font-mono text-(length:--code-font-size) leading-(--code-line-height) whitespace-pre-wrap break-words'

export function StdinPanel({ stdin }: { stdin: string }) {
  return (
    <Panel label="Stdin">
      <pre className={cn(text, 'min-h-0 flex-1 overflow-auto')}>
        {stdin === '' ? <span className="text-faint">(none)</span> : stdin}
      </pre>
    </Panel>
  )
}

export function OutputPanel({ output }: { output: OutputSegment[] }) {
  return (
    <Panel label="Stdout / Stderr">
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-auto">
        <pre className={text}>
          {output.length === 0 && <span className="text-faint">(nothing printed yet)</span>}
          {output.map((s, i) => (
            <span
              key={i}
              className={cn(
                s.current && 'bg-trace-changed font-semibold',
                s.stream === 'stderr' && 'text-danger',
                s.current && s.stream === 'stderr' && 'bg-danger-subtle',
              )}
            >
              {s.text}
            </span>
          ))}
        </pre>
      </div>
    </Panel>
  )
}
