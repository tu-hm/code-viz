import { Button, cn } from '@viz/ui'
import type { ReactNode } from 'react'
import { isApiError, type Visualization } from './api.ts'
import { useCountdown, waitText } from './countdown.ts'
import { DiagnosticList, RawOutput, type GoToLine } from './diagnostics.tsx'

function Screen({
  language,
  phase,
  children,
}: {
  language: string
  phase: string
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-background text-foreground">
      <header className="px-(--pane-padding) py-2">
        <h1 className="truncate font-medium">
          Visualizer · {language} · {phase}
        </h1>
      </header>
      <div className="flex max-w-3xl flex-col items-start gap-4 p-6">{children}</div>
    </div>
  )
}

function Headline({ children }: { children: ReactNode }) {
  return <h2 className="text-2xl font-medium">{children}</h2>
}

function Id({ label, id }: { label: string; id: string }) {
  return (
    <p className="font-mono text-xs text-muted-foreground select-all">
      {label}: {id}
    </p>
  )
}

const stages = [
  { status: 'queued', label: 'Queued' },
  { status: 'building', label: 'Building' },
  { status: 'tracing', label: 'Tracing' },
  { status: 'completed', label: 'Ready' },
] as const

const marks = { done: '●', current: '◌', next: '○' }

export function LoadingScreen({
  language,
  visualization,
  maxSteps,
  onCancel,
}: {
  language: string
  visualization: Visualization | null
  maxSteps: number
  onCancel: () => void
}) {
  const current = Math.max(
    0,
    stages.findIndex((s) => s.status === visualization?.status),
  )
  const steps = visualization?.status === 'tracing' ? visualization.progress?.steps : undefined
  const tracing = steps === undefined ? '' : ` (${steps.toLocaleString('en')} steps so far)`
  const status = visualization === null ? 'Sending' : `${stages[current]!.label}${tracing}`
  return (
    <Screen language={language} phase="preparing">
      <ol aria-label="Progress" className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-sm">
        {stages.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'next'
          return (
            <li
              key={s.status}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(state === 'next' && 'text-muted-foreground')}
            >
              <span aria-hidden className={cn(state !== 'next' && 'text-brand')}>
                {marks[state]}
              </span>{' '}
              {s.label}
              {state === 'current' && tracing}
            </li>
          )
        })}
      </ol>
      <div
        role="progressbar"
        aria-label="Steps traced"
        aria-valuemin={0}
        aria-valuemax={maxSteps}
        aria-valuenow={steps}
        className="h-2.5 w-full max-w-md overflow-hidden rounded-full border border-input"
      >
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.min(1, (steps ?? 0) / maxSteps) * 100}%` }}
        />
      </div>
      <p role="status" className="text-muted-foreground">
        {status}…
      </p>
      <Button onClick={onCancel}>Cancel</Button>
    </Screen>
  )
}

type ErrorView = {
  phase: string
  headline: string
  detail?: string
  action: 'retry' | 'rerun' | null
}

const ours = { phase: 'error', headline: 'Something went wrong on our side.' }

function errorView(error: unknown): ErrorView {
  if (error instanceof TypeError) {
    return {
      phase: 'offline',
      headline: "Couldn't reach the visualizer. Check your connection.",
      action: 'retry',
    }
  }
  if (!isApiError(error)) {
    return { ...ours, detail: error instanceof Error ? error.message : String(error), action: null }
  }
  if (error.code === 'internal_error') return { ...ours, action: 'retry' }
  if (error.code === null && error.status >= 500) {
    return { ...ours, detail: error.message, action: 'retry' }
  }
  switch (error.code) {
    case 'capacity':
      return {
        phase: 'busy',
        headline: 'Visualizer is busy, try again in a few seconds.',
        action: 'retry',
      }
    case 'rate_limited':
      return { phase: 'rate limited', headline: error.message, action: 'retry' }
    case 'expired':
      return {
        phase: 'expired',
        headline: 'This visualization has expired.',
        detail: 'Traces are kept for 7 days. Visualize again to make a new one.',
        action: 'rerun',
      }
    case 'not_found':
      return {
        phase: 'not found',
        headline: "This visualization doesn't exist.",
        detail: 'It may have been deleted. Visualize again to make a new one.',
        action: 'rerun',
      }
    case 'payload_too_large':
      return {
        phase: 'too large',
        headline: 'This program is too big to visualize.',
        detail: error.message,
        action: null,
      }
    default:
      return {
        phase: 'error',
        headline: "The visualizer couldn't take this request.",
        detail: error.message,
        action: null,
      }
  }
}

export function ApiErrorScreen({
  language,
  error,
  onRetry,
  onRerun,
  onClose,
}: {
  language: string
  error: unknown
  onRetry: () => void
  onRerun: () => void
  onClose: () => void
}) {
  const view = errorView(error)
  const api = isApiError(error) ? error : null
  const wait = useCountdown(api?.retryAfterSec ?? 0)
  return (
    <Screen language={language} phase={view.phase}>
      <div role="alert" className="flex flex-col gap-2">
        <Headline>{view.headline}</Headline>
        {view.detail !== undefined && <p>{view.detail}</p>}
        {api?.code === 'rate_limited' && (
          <p>
            {wait > 0
              ? `You can visualize again in ${waitText(wait)}.`
              : 'You can visualize again now.'}
          </p>
        )}
        {api !== null && api.requestId !== null && <Id label="Request ID" id={api.requestId} />}
      </div>
      <div className="flex gap-2">
        {view.action === 'retry' && (
          <Button variant="primary" disabled={wait > 0} onClick={onRetry}>
            {wait > 0 ? `Retry in ${waitText(wait)}` : 'Retry'}
          </Button>
        )}
        {view.action === 'rerun' && (
          <Button variant="primary" onClick={onRerun}>
            Visualize again
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Screen>
  )
}

export function EndedScreen({
  language,
  visualization,
  source,
  onGoToLine,
  onRerun,
  onClose,
}: {
  language: string
  visualization: Visualization
  source: string
  onGoToLine: GoToLine
  onRerun: () => void
  onClose: () => void
}) {
  const { failure, build, id } = visualization
  const diagnostics = build?.diagnostics ?? []
  switch (failure?.kind) {
    case 'compile_error':
      return (
        <Screen language={language} phase="build error">
          <div role="alert">
            <Headline>Build failed. Fix the error and visualize again.</Headline>
          </div>
          <DiagnosticList
            diagnostics={diagnostics}
            source={source}
            file={null}
            onGoToLine={onGoToLine}
          />
          {build?.raw !== undefined &&
            (diagnostics.length === 0 ? (
              <pre className="w-full overflow-x-auto rounded-xl bg-muted px-3 py-2 font-mono text-xs">
                {build.raw}
              </pre>
            ) : (
              <RawOutput raw={build.raw} />
            ))}
          <Button onClick={onClose}>Close</Button>
        </Screen>
      )
    case 'unsupported_module': {
      const [first] = diagnostics
      return (
        <Screen language={language} phase="unsupported module">
          <div role="alert">
            <Headline>
              {first === undefined
                ? "This program imports a module the visualizer doesn't support."
                : `${first.message}.`}{' '}
              Use Run instead.
            </Headline>
          </div>
          <div className="flex gap-2">
            {first !== undefined && (
              <Button variant="primary" onClick={() => onGoToLine(first.line, first.column)}>
                Go to line {first.line}
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </div>
        </Screen>
      )
    }
    case 'sandbox_error':
    case 'internal_error':
      return (
        <Screen language={language} phase="error">
          <div role="alert" className="flex flex-col gap-2">
            <Headline>Something went wrong on our side.</Headline>
            <p>Visualizing again runs the program again.</p>
            <Id label="Visualization ID" id={id} />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={onRerun}>
              Try again
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </Screen>
      )
    default:
      return (
        <Screen language={language} phase="stopped">
          <div role="alert">
            <Headline>
              {failure === undefined
                ? 'This visualization was canceled.'
                : "The visualizer couldn't run this program."}
            </Headline>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={onRerun}>
              Visualize again
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </Screen>
      )
  }
}

type Exit = NonNullable<Visualization['trace']>['header']['summary']['exit']

export function NoStepsScreen({
  language,
  startAtLines,
  exit,
  output,
  onStartAt,
  onTraceFromStart,
  onClose,
}: {
  language: string
  startAtLines: number[]
  exit: Exit
  // null: still loading
  output: string | null
  onStartAt: (() => void) | undefined
  onTraceFromStart: () => void
  onClose: () => void
}) {
  const lines = `${startAtLines.length === 1 ? 'line' : 'lines'} ${startAtLines.join(', ')}`
  return (
    <Screen language={language} phase="nothing traced">
      <div role="alert" className="flex flex-col gap-2">
        <Headline>Nothing was traced.</Headline>
        <p>
          {startAtLines.length === 0
            ? 'The program ended before its first traced line.'
            : `The program never reached ${lines}, so no steps were recorded.`}{' '}
          It ran untraced and exited: {exit.kind}
          {exit.code === null ? '' : ` (${exit.code})`}.
        </p>
      </div>
      <section aria-label="Output" className="flex w-full flex-col gap-1">
        <h2 className="mono-label text-muted-foreground">Output, not traced</h2>
        <pre className="max-h-64 overflow-auto rounded-xl bg-muted px-3 py-2 font-mono text-sm whitespace-pre-wrap">
          {output === null && <span className="text-faint">Loading…</span>}
          {output === '' && <span className="text-faint">(nothing printed)</span>}
          {output}
        </pre>
      </section>
      <div className="flex flex-wrap gap-2">
        {onStartAt && (
          <Button variant="primary" onClick={onStartAt}>
            Start tracing from line…
          </Button>
        )}
        {startAtLines.length > 0 && (
          <Button onClick={onTraceFromStart}>Trace from the start</Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Screen>
  )
}
