import { Button, cn } from '@viz/ui'
import type { ReactNode } from 'react'
import { jumpTarget, type Comparison } from './compare.ts'
import type { OutputSegment } from './engine.ts'
import type { InputStep } from './narration.ts'

function Panel({
  label,
  action,
  className,
  children,
}: {
  label: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={label}
      className={cn('flex min-h-0 flex-col gap-1 bg-muted py-2', className)}
    >
      <div className="flex items-center gap-3 px-(--pane-padding)">
        <h2 className="mono-label text-muted-foreground">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const text =
  'px-(--pane-padding) font-mono text-(length:--code-font-size) leading-(--code-line-height) whitespace-pre-wrap break-words'

export function StdinPanel({ stdin, position }: { stdin: string; position: InputStep | null }) {
  const words = [...stdin.matchAll(/\S+/g)]
  let end = 0
  const parts: ReactNode[] = []
  for (const [index, word] of words.entries()) {
    parts.push(stdin.slice(end, word.index))
    const read = index < (position?.token ?? 0)
    const current = read && index >= (position?.from ?? 0)
    parts.push(
      <span
        key={index}
        aria-current={current ? 'true' : undefined}
        className={cn(
          read && 'text-muted-foreground',
          current && 'bg-trace-write font-semibold text-foreground',
        )}
      >
        {word[0]}
      </span>,
    )
    end = word.index + word[0].length
  }
  parts.push(stdin.slice(end))
  return (
    <Panel
      label="Input"
      action={
        stdin === '' ? undefined : (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {position?.token ?? 0} of {words.length} tokens read
            {position?.inferred ? ' (inferred)' : ''}
          </span>
        )
      }
    >
      <pre className={cn(text, 'min-h-0 flex-1 overflow-auto')}>
        {stdin === '' ? <span className="text-faint">(none)</span> : parts}
      </pre>
    </Panel>
  )
}

export type Mark = { at: number; label: string }

type Piece = OutputSegment | { mark: string }

function withMark(output: OutputSegment[], mark: Mark | undefined): Piece[] {
  if (mark === undefined) return output
  const all = output.map((s) => s.text).join('')
  const newline = all.indexOf('\n', mark.at)
  const end = newline === -1 ? all.length : newline
  const pieces: Piece[] = []
  let start = 0
  for (const s of output) {
    const cut = end - start
    if (cut >= 0 && cut < s.text.length) {
      pieces.push(
        { ...s, text: s.text.slice(0, cut) },
        { mark: mark.label },
        { ...s, text: s.text.slice(cut) },
      )
    } else {
      pieces.push(s)
    }
    start += s.text.length
  }
  if (end === all.length) pieces.push({ mark: mark.label })
  return pieces
}

export type OutputEnd = { tail: string; afterStep: number; truncated: boolean }

export function OutputPanel({
  output,
  mark,
  end,
  action,
}: {
  output: OutputSegment[]
  mark?: Mark
  end: OutputEnd | null
  action?: ReactNode
}) {
  const untraced = end !== null && end.tail !== ''
  return (
    <Panel label="Stdout / Stderr" action={action}>
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-auto">
        <div>
          <pre className={text}>
            {output.length === 0 && !untraced && (
              <span className="text-faint">(nothing printed yet)</span>
            )}
            {withMark(output, mark).map((s, i) =>
              'mark' in s ? (
                <span key={i} className="font-sans text-danger">
                  {'  '}◀ {s.mark}
                </span>
              ) : (
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
              ),
            )}
          </pre>
          {untraced && (
            <section aria-label="Not traced" className="mt-1">
              <h3 className="mono-label px-(--pane-padding) text-muted-foreground">
                Printed after step {end.afterStep.toLocaleString('en')}, not traced
              </h3>
              <pre className={cn(text, 'text-muted-foreground')}>{end.tail}</pre>
            </section>
          )}
          {end?.truncated && (
            <p className={cn(text, 'text-muted-foreground')}>… (output truncated)</p>
          )}
        </div>
      </div>
    </Panel>
  )
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="ml-auto flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  )
}

export function ExpectedPanel({
  expected,
  exact,
  onExpected,
  onExact,
}: {
  expected: string
  exact: boolean
  onExpected: (text: string) => void
  onExact: (exact: boolean) => void
}) {
  return (
    <Panel
      label="Expected"
      action={<Check label="Exact" checked={exact} onChange={onExact} />}
      className="relative before:absolute before:inset-y-2 before:left-0 before:w-px before:bg-border"
    >
      <textarea
        aria-label="Expected output"
        value={expected}
        placeholder="Paste the expected output"
        spellCheck={false}
        onChange={(e) => onExpected(e.currentTarget.value)}
        className="min-h-0 flex-1 resize-none bg-transparent px-(--pane-padding) font-mono text-base leading-(--code-line-height) sm:text-(length:--code-font-size)"
      />
    </Panel>
  )
}

function shown(char: string | null) {
  if (char === null) return 'end of output'
  if (char === '\n') return 'end of line'
  return JSON.stringify(char)
}

function where(step: number, line: number | null) {
  return line === null ? `step ${step + 1}` : `step ${step + 1} (line ${line})`
}

function story(c: Exclude<Comparison, { kind: 'match' }>) {
  const first =
    c.kind === 'short'
      ? `Output ended early: ${c.missing} more ${c.missing === 1 ? 'line' : 'lines'} expected.`
      : `First difference: line ${c.line}, char ${c.char}: expected ${shown(c.expected)}, got ${shown(c.got)}.`
  if (c.from === null) return `${first} Nothing was printed.`
  if (c.from === 'untraced')
    return `${first} It was printed after the last traced step, so no step shows it.`
  const at = where(c.from.step, c.from.line)
  if (c.kind === 'short') return `${first} The last print was at ${at}.`
  return c.got === null ? `${first} Output ended at ${at}.` : `${first} It was printed at ${at}.`
}

export function CompareResult({
  comparison,
  exact,
  lastStep,
  onGo,
}: {
  comparison: Comparison | null
  exact: boolean
  lastStep: number
  onGo: (step: number) => void
}) {
  let body: ReactNode
  if (comparison === null) {
    body = <p className="text-muted-foreground">Paste the expected output to compare.</p>
  } else if (comparison.kind === 'match') {
    body = (
      <p>
        Matches the expected output
        {exact ? ' exactly.' : ', ignoring trailing spaces and line endings.'}
      </p>
    )
  } else {
    const target = jumpTarget(comparison, lastStep)
    body = (
      <>
        <p>{story(comparison)}</p>
        {target !== null && (
          <Button size="sm" onClick={() => onGo(target)}>
            Jump to step {target + 1}
          </Button>
        )}
      </>
    )
  }
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-3 bg-muted px-(--pane-padding) pb-2 text-sm"
    >
      {body}
    </div>
  )
}
