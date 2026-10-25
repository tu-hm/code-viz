import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@viz/ui'
import { useId, useState, type FormEvent } from 'react'
import { changedClass, Mark } from './value-view.tsx'
import type { WatchRow } from './watch.ts'

function PinForm({
  variables,
  onWatch,
}: {
  variables: string[]
  onWatch: (text: string) => string | null
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const listId = useId()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const failure = onWatch(text)
    setError(failure)
    if (failure !== null) return
    setText('')
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setError(null)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="ml-auto">
          + Pin
        </Button>
      </PopoverTrigger>
      <PopoverContent label="Pin to watch">
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2 p-1">
          <label htmlFor={inputId} className="text-sm">
            Watch
          </label>
          <input
            id={inputId}
            list={listId}
            value={text}
            placeholder="mid, a[2], dp[2][3]"
            spellCheck={false}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : `${inputId}-error`}
            onChange={(e) => setText(e.target.value)}
            className="h-8 w-48 rounded-lg border border-input bg-background px-2 font-mono text-base sm:text-sm"
          />
          <datalist id={listId}>
            {variables.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <Button size="sm" type="submit">
            Pin
          </Button>
          {error !== null && (
            <p id={`${inputId}-error`} className="w-full text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}

export function WatchPanel({
  rows,
  variables,
  onWatch,
  onUnwatch,
}: {
  rows: WatchRow[]
  variables: string[]
  onWatch: (text: string) => string | null
  onUnwatch: (target: string) => void
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2 id={headingId} className="mono-label text-muted-foreground">
          Watch
        </h2>
        <span aria-hidden className="text-xs text-muted-foreground">
          name · value · history
        </span>
        <PinForm variables={variables} onWatch={onWatch} />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pin a variable or a cell to follow its value.
        </p>
      ) : (
        <div className="rounded-xl bg-card px-3 py-1">
          <table className="w-full font-mono text-(length:--code-font-size)">
            <thead className="sr-only">
              <tr>
                <th scope="col">name</th>
                <th scope="col">value</th>
                <th scope="col">history</th>
                <th scope="col">actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const missing = row.value === null
                return (
                  <tr
                    key={row.target}
                    className={cn(
                      'h-(--row-height) border-b border-border align-top last:border-b-0',
                      missing && 'text-muted-foreground',
                    )}
                  >
                    <th scope="row" className="py-0.5 pr-3 text-left font-normal whitespace-nowrap">
                      {row.target}
                      {row.auto && (
                        <>
                          {' '}
                          <span className="ml-1 font-sans text-xs text-muted-foreground">auto</span>
                        </>
                      )}
                    </th>
                    <td
                      className={cn(
                        'py-0.5 pr-3 break-all transition-colors duration-(--duration-fade)',
                        row.changed && changedClass,
                      )}
                    >
                      {missing ? (
                        <span className="font-sans">not in scope</span>
                      ) : (
                        <>
                          {row.value}
                          <Mark on={row.changed} />
                        </>
                      )}
                    </td>
                    <td className="w-full py-0.5 text-muted-foreground">{row.history}</td>
                    <td className="py-0.5 text-right font-sans whitespace-nowrap">
                      {row.auto ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Pin ${row.target}`}
                          onClick={() => onWatch(row.target)}
                        >
                          Pin
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Unpin ${row.target}`}
                          onClick={() => onUnwatch(row.target)}
                        >
                          <span aria-hidden>✕</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
