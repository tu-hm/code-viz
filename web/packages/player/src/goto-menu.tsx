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
    <kbd className="pr-3 pl-4 text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
      {children}
    </kbd>
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
    const disabled = found[entry] === false
    return (
      <li className="col-span-3 grid grid-cols-subgrid items-center">
        <Button
          size="sm"
          variant="ghost"
          aria-label={labels[entry]}
          disabled={disabled}
          onClick={() => onRun(entry)}
          className={cn('justify-start text-sm', input === undefined && 'col-span-2')}
        >
          {text}
        </Button>
        {input !== undefined && (
          <span className="flex items-center gap-1.5">
            {input}
            {after && (
              <span aria-hidden className={cn(disabled && 'text-faint')}>
                {after}
              </span>
            )}
          </span>
        )}
        <Keys>{shortcuts[entry]}</Keys>
      </li>
    )
  }

  return (
    <ul className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-y-0.5 text-sm">
      <li className="col-span-3 grid h-8 grid-cols-subgrid items-center pl-3 text-muted-foreground">
        <span className="col-span-2">Next step / previous step</span>
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
