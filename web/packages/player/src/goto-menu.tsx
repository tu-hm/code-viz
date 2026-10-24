import { Button, cn } from '@viz/ui'
import { useId, type ReactNode } from 'react'
import { shortcuts, type Entry } from './goto.ts'

type GotoMenuProps = {
  labels: Record<Entry, string>
  found: Partial<Record<Entry, boolean>>
  line: string
  change: string
  call: string | null
  breakpoints: number[]
  variables: string[]
  functions: string[]
  onLine: (line: string) => void
  onChange: (target: string) => void
  onCall: (name: string) => void
  onRun: (entry: Entry) => void
}

const field = 'h-8 rounded-lg border border-input bg-background px-2 font-mono text-base sm:text-sm'

function Keys({ children }: { children: string }) {
  return (
    <kbd className="ml-auto shrink-0 pl-3 font-mono text-xs text-muted-foreground">{children}</kbd>
  )
}

export function GotoMenu({
  labels,
  found,
  line,
  change,
  call,
  breakpoints,
  variables,
  functions,
  onLine,
  onChange,
  onCall,
  onRun,
}: GotoMenuProps) {
  const variableList = useId()

  function row(entry: Entry, text: string, input?: ReactNode, after?: string) {
    return (
      <li className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          aria-label={labels[entry]}
          disabled={found[entry] === false}
          onClick={() => onRun(entry)}
          className="justify-start"
        >
          {text}
        </Button>
        {input}
        {after && <span aria-hidden>{after}</span>}
        <Keys>{shortcuts[entry]}</Keys>
      </li>
    )
  }

  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      <li className="flex h-8 items-center px-3 text-muted-foreground">
        Next step / previous step
        <Keys>→ / ←</Keys>
      </li>
      {row('over', 'Step over (next line in this call)')}
      {row('out', 'Step out (back to the caller)')}
      {row(
        'line',
        'Next time line',
        <input
          aria-label="Line number"
          inputMode="numeric"
          value={line}
          placeholder={breakpoints.length > 0 ? breakpoints.join(', ') : 'line'}
          onChange={(e) => onLine(e.currentTarget.value)}
          className={cn(field, 'w-20')}
        />,
        'runs',
      )}
      {row(
        'change',
        'Next change of',
        <>
          <input
            aria-label="Variable or cell"
            list={variableList}
            value={change}
            placeholder="a, a[2]"
            spellCheck={false}
            onChange={(e) => onChange(e.currentTarget.value)}
            className={cn(field, 'w-40')}
          />
          <datalist id={variableList}>
            {variables.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>,
      )}
      {row(
        'call',
        'Next call of',
        <select
          aria-label="Function"
          value={call ?? functions[0] ?? ''}
          disabled={functions.length === 0}
          onChange={(e) => onCall(e.currentTarget.value)}
          className={cn(field, 'max-w-40')}
        >
          {functions.length === 0 && <option value="">none</option>}
          {functions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>,
      )}
      {row('print', 'Next print to output')}
      {row('diff', 'First difference from expected output')}
      {row('error', 'Error step')}
    </ul>
  )
}
