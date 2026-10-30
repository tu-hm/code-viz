import { Button, Dialog, DialogContent } from '@viz/ui'
import { useId, useState, type FormEvent, type ReactNode } from 'react'

const maxStepChoices = [100, 500, 1000, 2000, 5000]

const input =
  'h-9 w-24 rounded-xl border border-input bg-background px-3 font-mono text-base sm:text-sm'

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
      {htmlFor === undefined ? <span>{label}</span> : <label htmlFor={htmlFor}>{label}</label>}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

function Actions({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="primary">
        Visualize
      </Button>
    </div>
  )
}

function Problem({ text }: { text: string | null }) {
  if (text === null) return null
  return (
    <p role="alert" className="text-danger">
      {text}
    </p>
  )
}

function wholeNumber(text: string) {
  return /^\d+$/.test(text.trim()) ? Number(text) : null
}

type StartAt = { startAtLines: number[]; maxSteps: number }

type StartAtProps = {
  lineCount: number
  breakpoints: number[]
  maxSteps: number
  maxStepsCeiling: number
  onCancel: () => void
  onVisualize: (options: StartAt) => void
}

function StartAtForm({
  lineCount,
  breakpoints,
  maxSteps,
  maxStepsCeiling,
  onCancel,
  onVisualize,
}: StartAtProps) {
  const lineId = useId()
  const stepsId = useId()
  const [line, setLine] = useState('')
  const [picked, setPicked] = useState(breakpoints)
  const [steps, setSteps] = useState(Math.min(maxSteps, maxStepsCeiling))
  const [problem, setProblem] = useState<string | null>(null)
  const choices = [...new Set([...maxStepChoices, steps, maxStepsCeiling])]
    .filter((n) => n <= maxStepsCeiling)
    .sort((a, b) => a - b)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const typed = line.trim() === '' ? null : wholeNumber(line)
    if (line.trim() !== '' && (typed === null || typed < 1 || typed > lineCount)) {
      setProblem(`Enter a line from 1 to ${lineCount}.`)
      return
    }
    const lines = [...new Set([...(typed === null ? [] : [typed]), ...picked])]
    if (lines.length === 0) {
      setProblem('Enter a line, or pick a breakpoint.')
      return
    }
    onVisualize({ startAtLines: lines.sort((a, b) => a - b), maxSteps: steps })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        Skip ahead: record steps only after the program first reaches one of these lines.
      </p>
      <Row label="Start at line" htmlFor={lineId}>
        <input
          id={lineId}
          inputMode="numeric"
          value={line}
          onChange={(e) => setLine(e.currentTarget.value)}
          className={input}
        />
      </Row>
      <Row label="Breakpoints">
        {breakpoints.length === 0 && (
          <span className="text-muted-foreground">None. Click the gutter to add one.</span>
        )}
        {breakpoints.map((b) => (
          <label key={b} className="flex items-center gap-1.5 font-mono">
            <input
              type="checkbox"
              checked={picked.includes(b)}
              onChange={(e) => {
                const on = e.currentTarget.checked
                setPicked((p) => (on ? [...p, b] : p.filter((x) => x !== b)))
              }}
              className="size-4 accent-primary"
            />
            <span aria-hidden>●</span>
            {b}
          </label>
        ))}
      </Row>
      <Row label="Max steps" htmlFor={stepsId}>
        <select
          id={stepsId}
          value={steps}
          onChange={(e) => setSteps(choices[e.currentTarget.selectedIndex]!)}
          className="h-9 rounded-xl border border-input bg-background px-3 text-base sm:text-sm"
        >
          {choices.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString('en')}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">
          server max {maxStepsCeiling.toLocaleString('en')}
        </span>
      </Row>
      <Problem text={problem} />
      <Actions onCancel={onCancel} />
    </form>
  )
}

export function StartAtDialog({ open, ...props }: StartAtProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onCancel()}>
      <DialogContent title="Start tracing from">
        <StartAtForm {...props} />
      </DialogContent>
    </Dialog>
  )
}

type ShowRangeProps = {
  variable: string
  onCancel: () => void
  onVisualize: (variable: string, indices: [number, number]) => void
}

function ShowRangeForm({ variable, onCancel, onVisualize }: ShowRangeProps) {
  const fromId = useId()
  const toId = useId()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const first = wholeNumber(from)
    const last = wholeNumber(to)
    if (first === null || last === null) {
      setProblem('Enter two indices, 0 or more.')
      return
    }
    if (last < first) {
      setProblem('The range ends before it starts.')
      return
    }
    onVisualize(variable, [first, last])
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        Visualize again, recording <code className="font-mono text-foreground">{variable}</code> in
        full between these indices (both included).
      </p>
      <Row label="From index" htmlFor={fromId}>
        <input
          id={fromId}
          inputMode="numeric"
          value={from}
          onChange={(e) => setFrom(e.currentTarget.value)}
          className={input}
        />
      </Row>
      <Row label="To index" htmlFor={toId}>
        <input
          id={toId}
          inputMode="numeric"
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
          className={input}
        />
      </Row>
      <Problem text={problem} />
      <Actions onCancel={onCancel} />
    </form>
  )
}

export function ShowRangeDialog({
  variable,
  onCancel,
  onVisualize,
}: Omit<ShowRangeProps, 'variable'> & { variable: string | null }) {
  return (
    <Dialog open={variable !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent title={`Show a range of ${variable ?? ''}`}>
        {variable !== null && (
          <ShowRangeForm variable={variable} onCancel={onCancel} onVisualize={onVisualize} />
        )}
      </DialogContent>
    </Dialog>
  )
}
