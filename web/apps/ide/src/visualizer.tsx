import { useQuery } from '@tanstack/react-query'
import { loadTrace, Player, usePlayer, type Manifest } from '@viz/player'
import { useMemo, useState } from 'react'
import { getVisualization, type CreateRequest, type Visualization } from './api.ts'
import { BuildWarnings, type GoToLine } from './diagnostics.tsx'
import { PlayerErrorBoundary } from './error-boundary.tsx'
import { ShowRangeDialog, StartAtDialog } from './rerun-dialogs.tsx'
import { ApiErrorScreen, EndedScreen, LoadingScreen, NoStepsScreen } from './run-screens.tsx'
import { isFinal, visualizationQuery, type Run } from './visualize.ts'

type Props = {
  run: Run
  created: Visualization | undefined
  error: unknown
  onClose: () => void
  onRetry: () => void
  onRerun: (request: CreateRequest) => void
  onGoToLine: GoToLine
}

type ApiManifest = NonNullable<Visualization['trace']>
type Options = CreateRequest['options']

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

function StartAtBox({
  open,
  run,
  lineCount,
  onCancel,
  onRerun,
}: {
  open: boolean
  run: Run
  lineCount: number
  onCancel: () => void
  onRerun: (options: Partial<Options>) => void
}) {
  const breakpoints = usePlayer((s) => s.breakpoints)
  return (
    <StartAtDialog
      open={open}
      lineCount={lineCount}
      breakpoints={breakpoints}
      maxSteps={run.request.options.maxSteps}
      maxStepsCeiling={run.language.visualize.limits.maxStepsCeiling}
      onCancel={onCancel}
      onVisualize={onRerun}
    />
  )
}

function Completed({
  run,
  visualization,
  trace,
  onClose,
  onRerun,
  onGoToLine,
}: {
  run: Run
  visualization: Visualization
  trace: ApiManifest
  onClose: () => void
  onRerun: (request: CreateRequest) => void
  onGoToLine: GoToLine
}) {
  const { id, build } = visualization
  // useSession starts over on a new source object
  const source = useMemo(
    () => ({ manifest: toManifest(trace), refresh: () => freshManifest(id) }),
    [id, trace],
  )
  const empty = trace.header.summary.stepCount === 0
  const tail = useQuery({
    queryKey: ['tail', trace.header.id],
    queryFn: async () => (await loadTrace(source)).tail,
    enabled: empty,
    staleTime: Infinity,
  })
  const [startAt, setStartAt] = useState(false)
  const [rangeOf, setRangeOf] = useState<string | null>(null)
  const { capabilities, limits } = run.language.visualize
  const rerun = (options: Partial<Options>) =>
    onRerun({ ...run.request, options: { ...run.request.options, ...options } })
  const onStartAt = capabilities.startAtLines ? () => setStartAt(true) : undefined

  const dialogs = (
    <>
      <StartAtBox
        open={startAt}
        run={run}
        lineCount={trace.header.source.lineCount}
        onCancel={() => setStartAt(false)}
        onRerun={rerun}
      />
      <ShowRangeDialog
        variable={rangeOf}
        onCancel={() => setRangeOf(null)}
        onVisualize={(variable, indices) =>
          rerun({ captureRanges: { ...run.request.options.captureRanges, [variable]: [indices] } })
        }
      />
    </>
  )

  if (empty) {
    return (
      <>
        <NoStepsScreen
          language={run.language.displayName}
          startAtLines={trace.header.options.startAtLines}
          exit={trace.header.summary.exit}
          output={
            tail.error === null
              ? (tail.data ?? null)
              : `Couldn't load the output: ${tail.error.message}`
          }
          onStartAt={onStartAt}
          onTraceFromStart={() => rerun({ startAtLines: [] })}
          onClose={onClose}
        />
        {dialogs}
      </>
    )
  }
  return (
    <>
      <PlayerErrorBoundary traceId={trace.header.id}>
        <Player
          source={source}
          code={run.request.source}
          stdin={run.request.stdin}
          language={run.language}
          banner={
            build && (
              <BuildWarnings
                build={build}
                source={run.request.source}
                file={trace.header.source.file}
                onGoToLine={onGoToLine}
              />
            )
          }
          onClose={onClose}
          onStartAt={onStartAt}
          onRaiseLimit={() => rerun({ maxSteps: limits.maxStepsCeiling })}
          onShowRange={capabilities.captureRanges ? setRangeOf : undefined}
        />
      </PlayerErrorBoundary>
      {dialogs}
    </>
  )
}

function Polling({
  run,
  created,
  onClose,
  onRerun,
  onGoToLine,
}: {
  run: Run
  created: Visualization
  onClose: () => void
  onRerun: (request: CreateRequest) => void
  onGoToLine: GoToLine
}) {
  const { data: visualization, error, isFetching, refetch } = useQuery(visualizationQuery(created))
  const language = run.language.displayName
  if (error !== null && !isFetching && !isFinal(visualization)) {
    return (
      <ApiErrorScreen
        language={language}
        error={error}
        onRetry={() => void refetch()}
        onRerun={() => onRerun(run.request)}
        onClose={onClose}
      />
    )
  }
  if (visualization.status === 'completed' && visualization.trace !== undefined) {
    return (
      <Completed
        run={run}
        visualization={visualization}
        trace={visualization.trace}
        onClose={onClose}
        onRerun={onRerun}
        onGoToLine={onGoToLine}
      />
    )
  }
  if (isFinal(visualization)) {
    return (
      <EndedScreen
        language={language}
        visualization={visualization}
        source={run.request.source}
        onGoToLine={onGoToLine}
        onRerun={() => onRerun(run.request)}
        onClose={onClose}
      />
    )
  }
  return (
    <LoadingScreen
      language={language}
      visualization={visualization}
      maxSteps={run.request.options.maxSteps}
      onCancel={onClose}
    />
  )
}

export function Visualizer({ run, created, error, onClose, onRetry, onRerun, onGoToLine }: Props) {
  const language = run.language.displayName
  if (error !== null && error !== undefined) {
    return (
      <ApiErrorScreen
        language={language}
        error={error}
        onRetry={onRetry}
        onRerun={() => onRerun(run.request)}
        onClose={onClose}
      />
    )
  }
  if (created === undefined) {
    return (
      <LoadingScreen
        language={language}
        visualization={null}
        maxSteps={run.request.options.maxSteps}
        onCancel={onClose}
      />
    )
  }
  return (
    <Polling
      run={run}
      created={created}
      onClose={onClose}
      onRerun={onRerun}
      onGoToLine={onGoToLine}
    />
  )
}
