import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@viz/ui'
import type { ReactNode } from 'react'
import type { Crash, Ending, Stop } from './ending.ts'
import { friendly, rawTitle, signalText, type Part } from './friendly.ts'
import type { Exit, Summary } from './gen/trace.ts'

function exitText({ kind, code, signal }: Exit) {
  let text: string = kind
  if (code !== null) text += ` (${code})`
  if (signal !== null) text += ` ${signal}`
  return text
}

function Parts({ parts }: { parts: Part[] }) {
  return parts.map((p, i) =>
    typeof p === 'string' ? (
      p
    ) : (
      <code key={i} className="font-mono">
        {p.code}
      </code>
    ),
  )
}

function Banner({
  label,
  tone,
  mark,
  title,
  children,
}: {
  label: string
  tone: 'danger' | 'warning'
  mark: string
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'flex flex-col gap-1.5 rounded-xl px-3 py-2 font-sans text-sm text-foreground',
        tone === 'danger' ? 'bg-danger-subtle' : 'bg-warning-subtle',
      )}
    >
      <p className="font-medium">
        <span aria-hidden className={tone === 'danger' ? 'text-danger' : 'text-warning'}>
          {mark}{' '}
        </span>
        {title}
      </p>
      {children}
    </section>
  )
}

const step = (k: number) => (k + 1).toLocaleString('en')

function ErrorBanner({
  crash,
  stepCount,
  onGo,
}: {
  crash: Crash
  stepCount: number
  onGo: (step: number) => void
}) {
  const { error, frame } = crash
  const f = friendly(error)
  const where =
    crash.step === stepCount - 1
      ? `step ${step(crash.step)}`
      : `raised at step ${step(crash.step)}, program ended at step ${step(stepCount - 1)}`
  const title = `${f?.title ?? rawTitle(error)} · line ${error.line}, in ${frame} · ${where}`
  if (f === null) {
    return (
      <Banner label="Runtime error" tone="danger" mark="!!" title={title}>
        <div>
          <Button size="sm" onClick={() => onGo(crash.step)}>
            Jump to error step
          </Button>
        </div>
      </Banner>
    )
  }
  return (
    <Banner label="Runtime error" tone="danger" mark="!!" title={title}>
      <p>
        <Parts parts={f.message} />
      </p>
      <p>
        Hint: <Parts parts={f.hint} />
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <Button size="sm" onClick={() => onGo(crash.step)}>
          Jump to step {step(crash.step)}
        </Button>
        {crash.step > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onGo(crash.step - 1)}>
            Show values at step {step(crash.step - 1)}
          </Button>
        )}
        <details className="text-xs">
          <summary className="flex h-8 cursor-pointer items-center rounded-full px-3 font-medium hover:bg-secondary">
            Raw message
          </summary>
          <pre className="px-3 pb-1 font-mono whitespace-pre-wrap">
            {error.type}: {error.message}
          </pre>
        </details>
      </div>
    </Banner>
  )
}

function stopText({ line, frame, values }: Stop) {
  return [`line ${line} in ${frame}`, ...values].join(', ')
}

function tailOutcome({ completed, exit }: NonNullable<Summary['untracedTail']>) {
  switch (exit.kind) {
    case 'normal':
      return exit.code === 0 || exit.code === null
        ? 'finished normally'
        : `exited with code ${exit.code}`
    case 'exception':
      return `raised ${exit.message ?? 'an exception'}`
    case 'signal':
      return `crashed with ${exit.signal ?? 'a signal'}`
    case 'timeout':
      return 'ran until the time limit'
    case 'memory_limit':
      return 'ran out of memory'
    case 'output_limit':
      return 'printed past the output limit'
    default:
      return completed ? `ended (${exit.kind})` : `was stopped (${exit.kind})`
  }
}

type LimitProps = {
  summary: Summary
  stop: Stop | null
  stepCount: number
  maxSteps: number
  maxStepsCeiling: number
  onStartAt?: () => void
  onRaiseLimit?: () => void
}

function LimitBanner({
  summary,
  stop,
  stepCount,
  maxSteps,
  maxStepsCeiling,
  onStartAt,
  onRaiseLimit,
}: LimitProps) {
  const reason = summary.truncation?.reason === 'size_limit' ? 'size limit' : 'step limit'
  const steps = stepCount.toLocaleString('en')
  const tail = summary.untracedTail
  const at = stop === null ? '' : `, up to ${stopText(stop)}`
  const title =
    tail === undefined
      ? `Trace stopped at step ${steps} (${reason}).`
      : `Traced the first ${steps} steps${at}; the program then ${tailOutcome(tail)} (not traced).`
  return (
    <Banner label="Step limit" tone="warning" mark="(!)" title={title}>
      {tail === undefined && (
        <p>
          {stop === null
            ? 'The program was still running.'
            : `The program was still running: ${stopText(stop)}.`}{' '}
          Later lines were not recorded.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {onStartAt && (
          <Button size="sm" onClick={onStartAt}>
            Start tracing from line…
          </Button>
        )}
        {onRaiseLimit && maxSteps < maxStepsCeiling && (
          <Button size="sm" onClick={onRaiseLimit}>
            Raise limit to {maxStepsCeiling.toLocaleString('en')}
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost">
              Why?
            </Button>
          </PopoverTrigger>
          <PopoverContent label="Why the trace stops">
            <p className="p-2 text-sm">
              The visualizer records at most {maxSteps.toLocaleString('en')} steps (Settings, Max
              steps; at most {maxStepsCeiling.toLocaleString('en')}), so the trace stays small
              enough to step through in the browser.{' '}
              {tail !== undefined &&
                'After that the program keeps running without recording steps, so its output and exit status are still complete. '}
              Start tracing from a later line to see the part you care about.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </Banner>
  )
}

// §11 defaults; the trace doesn't carry the limits it ran under
const limits = { wallTime: '15 s', output: '64 KB', memory: '256 MB' }

function exitBanner(exit: Exit, crash: Crash | null, traceId: string) {
  switch (exit.kind) {
    case 'timeout':
      return (
        <Banner
          label="Time limit"
          tone="warning"
          mark="(!)"
          title={`Stopped after ${limits.wallTime} (time limit). The steps recorded until then are kept.`}
        />
      )
    case 'output_limit':
      return (
        <Banner
          label="Output limit"
          tone="warning"
          mark="(!)"
          title={`Output limit reached: the program printed more than ${limits.output}, so its output is cut and the run stopped.`}
        />
      )
    case 'memory_limit':
      return (
        <Banner
          label="Memory limit"
          tone="warning"
          mark="(!)"
          title={`Stopped: the program used more than ${limits.memory} of memory.`}
        />
      )
    case 'internal_error':
      return (
        <Banner
          label="Internal error"
          tone="danger"
          mark="!!"
          title="Something went wrong on our side."
        >
          <p>
            The tracer stopped unexpectedly, so the trace may end early.{' '}
            <span className="font-mono text-xs select-all">Trace ID: {traceId}</span>
          </p>
        </Banner>
      )
    case 'signal':
      if (crash !== null || exit.signal === null) return null
      return (
        <Banner
          label="Runtime error"
          tone="danger"
          mark="!!"
          title={`${signalText(exit.signal) ?? exit.signal}: the program was stopped by ${exit.signal}.`}
        />
      )
    case 'exception':
      if (crash !== null) return null
      return (
        <Banner
          label="Runtime error"
          tone="danger"
          mark="!!"
          title={`The program ended with ${exit.message ?? 'an exception'}.`}
        />
      )
    default:
      return null
  }
}

type StatusBarProps = Omit<LimitProps, 'stop'> & {
  traceId: string
  ending: Ending
  banner?: ReactNode
  onGo: (step: number) => void
}

export function StatusBar({ traceId, ending, banner, onGo, ...limit }: StatusBarProps) {
  const { summary, stepCount } = limit
  const { crash } = ending
  const reason = summary.truncation?.reason
  const program = summary.untracedTail?.exit ?? summary.exit
  return (
    <footer className="flex flex-col gap-1.5 px-(--pane-padding) py-1.5 font-mono text-xs text-muted-foreground">
      {banner}
      {crash !== null && <ErrorBanner crash={crash} stepCount={stepCount} onGo={onGo} />}
      {(reason === 'step_limit' || reason === 'size_limit') && (
        <LimitBanner {...limit} stop={ending.stop} />
      )}
      {exitBanner(summary.exit, crash, traceId)}
      <p>
        Ready · {stepCount.toLocaleString('en')} steps · exit: {exitText(program)}
        {summary.untracedTail && ' (not traced)'}
      </p>
    </footer>
  )
}
