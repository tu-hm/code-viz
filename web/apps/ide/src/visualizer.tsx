import { useQuery } from '@tanstack/react-query'
import { Player, type Manifest } from '@viz/player'
import { Button } from '@viz/ui'
import { useMemo, type ReactNode } from 'react'
import { getVisualization, isApiError, type Visualization } from './api.ts'
import { PlayerErrorBoundary } from './error-boundary.tsx'
import { isFinal, visualizationQuery, type Run } from './visualize.ts'

type Props = {
  run: Run
  created: Visualization | undefined
  error: unknown
  onClose: () => void
}

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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="px-(--pane-padding) py-2">
        <h1 className="truncate font-medium">
          Visualizer · {language} · {phase}
        </h1>
      </header>
      <div className="flex flex-col items-start gap-3 p-6">{children}</div>
    </div>
  )
}

const statusText: Record<Visualization['status'], string> = {
  queued: 'Queued',
  building: 'Building',
  tracing: 'Tracing',
  completed: 'Ready',
  failed: 'Failed',
  canceled: 'Canceled',
}

function LoadingScreen({
  language,
  visualization,
  onCancel,
}: {
  language: string
  visualization: Visualization | null
  onCancel: () => void
}) {
  const steps = visualization?.progress?.steps
  return (
    <Screen language={language} phase="preparing">
      <p role="status">
        {visualization === null ? 'Sending' : statusText[visualization.status]}
        {steps !== undefined && ` (${steps.toLocaleString('en')} steps so far)`}…
      </p>
      <Button onClick={onCancel}>Cancel</Button>
    </Screen>
  )
}

function errorText(error: unknown) {
  if (isApiError(error)) return error.message
  if (error instanceof TypeError) return "Couldn't reach the visualizer. Check your connection."
  return error instanceof Error ? error.message : String(error)
}

function ErrorScreen({
  language,
  error,
  onClose,
}: {
  language: string
  error: unknown
  onClose: () => void
}) {
  return (
    <Screen language={language} phase="error">
      <div role="alert" className="flex flex-col gap-1">
        <p>{errorText(error)}</p>
        {isApiError(error) && error.requestId !== null && (
          <p className="font-mono text-xs text-muted-foreground select-all">
            Request ID: {error.requestId}
          </p>
        )}
      </div>
      <Button onClick={onClose}>Close</Button>
    </Screen>
  )
}

function EndedScreen({
  language,
  visualization,
  onClose,
}: {
  language: string
  visualization: Visualization
  onClose: () => void
}) {
  const { failure, build } = visualization
  return (
    <Screen language={language} phase={failure?.stage === 'build' ? 'build error' : 'stopped'}>
      <p role="alert">
        {failure === undefined
          ? 'This visualization was canceled.'
          : failure.kind === 'compile_error'
            ? 'Build failed. Fix the error and visualize again.'
            : `The visualizer couldn't run this program (${failure.kind}).`}
      </p>
      {build?.raw !== undefined && (
        <pre className="max-w-full overflow-auto rounded-xl bg-muted p-3 font-mono text-xs">
          {build.raw}
        </pre>
      )}
      <Button onClick={onClose}>Close</Button>
    </Screen>
  )
}

type ApiManifest = NonNullable<Visualization['trace']>

function pair(range: number[]): [number, number] {
  const [from, to] = range
  if (range.length !== 2 || from === undefined || to === undefined) {
    throw new Error(`capture range [${range.join(', ')}] is not a pair`)
  }
  return [from, to]
}

// openapi-fetch's types turn captureRanges' pairs into number[]; the player's keep them as tuples
function toManifest(trace: ApiManifest): Manifest {
  const { captureRanges, ...options } = trace.header.options
  const pairs =
    captureRanges &&
    Object.fromEntries(Object.entries(captureRanges).map(([name, r]) => [name, r.map(pair)]))
  return { ...trace, header: { ...trace.header, options: { ...options, captureRanges: pairs } } }
}

async function freshManifest(id: string) {
  const { trace } = await getVisualization(id, null)
  if (trace === undefined) throw new Error(`visualization ${id} has no trace any more`)
  return toManifest(trace)
}

function Completed({
  run,
  id,
  trace,
  onClose,
}: {
  run: Run
  id: string
  trace: ApiManifest
  onClose: () => void
}) {
  // useSession starts over on a new source object
  const source = useMemo(
    () => ({ manifest: toManifest(trace), refresh: () => freshManifest(id) }),
    [id, trace],
  )
  return (
    <PlayerErrorBoundary traceId={trace.header.id}>
      <Player
        source={source}
        code={run.request.source}
        stdin={run.request.stdin}
        language={run.language}
        onClose={onClose}
      />
    </PlayerErrorBoundary>
  )
}

function Polling({
  run,
  created,
  onClose,
}: {
  run: Run
  created: Visualization
  onClose: () => void
}) {
  const { data: visualization, error } = useQuery(visualizationQuery(created))
  const language = run.language.displayName
  if (error !== null && !isFinal(visualization)) {
    return <ErrorScreen language={language} error={error} onClose={onClose} />
  }
  if (visualization.status === 'completed' && visualization.trace !== undefined) {
    return (
      <Completed run={run} id={visualization.id} trace={visualization.trace} onClose={onClose} />
    )
  }
  if (isFinal(visualization)) {
    return <EndedScreen language={language} visualization={visualization} onClose={onClose} />
  }
  return <LoadingScreen language={language} visualization={visualization} onCancel={onClose} />
}

export function Visualizer({ run, created, error, onClose }: Props) {
  const language = run.language.displayName
  if (error !== null && error !== undefined) {
    return <ErrorScreen language={language} error={error} onClose={onClose} />
  }
  if (created === undefined) {
    return <LoadingScreen language={language} visualization={null} onCancel={onClose} />
  }
  return <Polling run={run} created={created} onClose={onClose} />
}
