import { Button, Popover, PopoverContent, PopoverTrigger } from '@viz/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { togglePlay, useAutoplay } from './autoplay.ts'
import { CallsPanel } from './call-tree.tsx'
import { CodePane } from './code-pane.tsx'
import { compareOutput, shownAt } from './compare.ts'
import { parseCondition } from './condition.ts'
import { Controls, Notice } from './controls.tsx'
import { useDisplayOptions } from './display.ts'
import { Divider } from './divider.tsx'
import type { OutputSegment } from './engine.ts'
import { GotoMenu } from './goto-menu.tsx'
import { entries, locate, parseTarget, plan, runJump, type Entry } from './goto.ts'
import { Header } from './header.tsx'
import { LoopPasses } from './loop-passes.tsx'
import { useHistories } from './histories.ts'
import { useStepKeys } from './keys.ts'
import { isTraceError, type TraceHeader, type TraceSource } from './load.ts'
import type { InputStep } from './narration.ts'
import {
  Check,
  CompareResult,
  ExpectedPanel,
  OutputPanel,
  StdinPanel,
  type Mark,
  type OutputEnd,
} from './output.tsx'
import { targetText } from './search.ts'
import { lineFacts } from './source-facts.ts'
import { useSession, type LoadedTrace } from './session.ts'
import { SettingsDialog } from './settings.tsx'
import { StatePane } from './state-pane.tsx'
import { StatusBar } from './status-bar.tsx'
import { useStepParam } from './step-param.ts'
import { usePlayer } from './store.ts'
import { TimelineStrip } from './timeline-strip.tsx'
import { WatchPanel } from './watch-panel.tsx'
import { autoTargets, watchRow } from './watch.ts'

export type LanguageInfo = {
  displayName: string
  editorMode: string
  visualize: { capabilities: { pointers: boolean }; limits: { maxStepsCeiling: number } }
}

type Slots = {
  share?: ReactNode
  banner?: ReactNode
}

type PlayerProps = Slots & {
  source: TraceSource
  code: string
  stdin: string
  language: LanguageInfo
  permalink?: string
  expected?: string
  onClose: () => void
  onStartAt?: () => void
  onRaiseLimit?: () => void
  onShowRange?: (variable: string) => void
}

const noOutput: OutputSegment[] = []
const noWatches: string[] = []
const noticeMs = 4000

function useFrameThrottle(fn: (value: number) => void) {
  const pending = useRef<number | null>(null)
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return (value: number) => {
    const idle = pending.current === null
    pending.current = value
    if (!idle) return
    frame.current = requestAnimationFrame(() => {
      const latest = pending.current!
      pending.current = null
      fn(latest)
    })
  }
}

function conditionError(text: string) {
  const parsed = parseCondition(text)
  return 'error' in parsed ? parsed.error : null
}

function GotoPanel({ trace, onRun }: { trace: LoadedTrace; onRun: (entry: Entry) => void }) {
  const step = usePlayer((s) => s.step)
  const stack = usePlayer((s) => s.current?.stack)
  const breakpoints = usePlayer((s) => s.breakpoints)
  const jumpLine = usePlayer((s) => s.jumpLine)
  const jumpChange = usePlayer((s) => s.jumpChange)
  const jumpWhere = usePlayer((s) => s.jumpWhere)
  const jumpCall = usePlayer((s) => s.jumpCall)
  const expected = usePlayer((s) => s.expected)
  const exact = usePlayer((s) => s.exact)
  const [found, setFound] = useState<Partial<Record<Entry, boolean>>>({})
  const params = { breakpoints, jumpLine, jumpChange, jumpWhere, jumpCall, expected, exact }

  useEffect(() => {
    let alive = true
    const params = { breakpoints, jumpLine, jumpChange, jumpWhere, jumpCall, expected, exact }
    Promise.all(entries.map((e) => locate(plan(e, params, trace), step, trace))).then(
      (targets) => {
        if (alive) setFound(Object.fromEntries(entries.map((e, i) => [e, targets[i] !== null])))
      },
      (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e)
        if (alive) usePlayer.setState({ notice: `Couldn't search the trace: ${reason}` })
      },
    )
    return () => {
      alive = false
    }
  }, [step, breakpoints, jumpLine, jumpChange, jumpWhere, jumpCall, expected, exact, trace])

  const frames = [...(stack ?? [])].reverse()
  const variables = frames.flatMap((f) => f.locals.filter((l) => !l.internal).map((l) => l.name))
  return (
    <GotoMenu
      labels={
        Object.fromEntries(entries.map((e) => [e, plan(e, params, trace).label])) as Record<
          Entry,
          string
        >
      }
      found={found}
      line={jumpLine}
      change={jumpChange}
      where={jumpWhere}
      whereError={jumpWhere.trim() === '' ? null : conditionError(jumpWhere)}
      call={jumpCall}
      breakpoints={breakpoints}
      variables={[...new Set(variables)]}
      functions={Object.keys(trace.calls)}
      onLine={(jumpLine) => usePlayer.setState({ jumpLine })}
      onChange={(jumpChange) => usePlayer.setState({ jumpChange })}
      onWhere={(jumpWhere) => usePlayer.setState({ jumpWhere })}
      onCall={(jumpCall) => usePlayer.setState({ jumpCall })}
      onRun={onRun}
    />
  )
}

function GotoBox({ trace }: { trace: LoadedTrace }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          Go to… <span aria-hidden>▾</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent label="Go to">
        <GotoPanel
          trace={trace}
          onRun={(entry) => {
            setOpen(false)
            void runJump(entry, trace)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function NoticeBox() {
  const notice = usePlayer((s) => s.notice)
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => usePlayer.setState({ notice: null }), noticeMs)
    return () => clearTimeout(timer)
  }, [notice])
  return <Notice text={notice} />
}

function ControlsBox({ trace }: { trace: LoadedTrace }) {
  const { stepCount } = trace
  const state = usePlayer((s) => s.current)
  const step = usePlayer((s) => s.step)
  const playing = usePlayer((s) => s.playing)
  const speed = usePlayer((s) => s.settings.autoplaySpeed)
  const go = usePlayer((s) => s.go)
  const lane = usePlayer((s) => s.lane)
  const jumpCall = usePlayer((s) => s.jumpCall)
  const watched = usePlayer((s) => s.watches[trace.header.id] ?? noWatches)
  const histories = useHistories(trace, watched)
  const scrub = useFrameThrottle(go)
  const callee = jumpCall ?? Object.keys(trace.calls)[0] ?? null
  return (
    <div className="relative">
      <NoticeBox />
      <Controls
        state={state}
        step={step}
        stepCount={stepCount}
        playing={playing}
        speed={speed}
        goto={<GotoBox trace={trace} />}
        story={<StoryBox trace={trace} />}
        narration={trace.narrations[step] ?? null}
        passes={<PassesBox trace={trace} />}
        timeline={
          <TimelineStrip
            step={step}
            stepCount={stepCount}
            events={{
              read: trace.inputReads,
              print: trace.prints.map((p) => p.i),
              call: callee === null ? [] : (trace.calls[callee] ?? []),
              error: trace.errors,
            }}
            callee={callee}
            lanes={watched.map((target) => ({
              target,
              changes: histories[target]?.map((c) => c.step) ?? null,
            }))}
            lane={lane}
            narrations={trace.narrations}
            onGo={go}
            onScrub={scrub}
            onLane={(lane) => usePlayer.setState({ lane })}
          />
        }
        onGo={go}
        onStepOver={() => void runJump('over', trace)}
        onTogglePlay={() => togglePlay(stepCount)}
      />
    </div>
  )
}

function PassesBox({ trace }: { trace: LoadedTrace }) {
  const step = usePlayer((s) => s.current?.i)
  const line = usePlayer((s) => s.current?.line)
  const prevLine = usePlayer((s) => s.current?.prevLine)
  const facts = usePlayer((s) => s.facts)
  const go = usePlayer((s) => s.go)
  const [found, setFound] = useState<{ header: number; passes: number[] } | null>(null)
  const header = [line, prevLine].find((l) => lineFacts(facts, l).loop !== null) ?? null
  const loop = lineFacts(facts, header).loop

  useEffect(() => {
    if (step === undefined || header === null || loop === null) return
    let alive = true
    trace.passes(step, header, loop).then(
      (passes) => {
        if (alive) setFound({ header, passes })
      },
      (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e)
        if (alive) usePlayer.setState({ notice: `Couldn't search the trace: ${reason}` })
      },
    )
    return () => {
      alive = false
    }
  }, [step, header, loop, trace])

  if (step === undefined || header === null || found?.header !== header) return null
  return <LoopPasses line={header} passes={found.passes} step={step} onGo={go} />
}

function StoryBox({ trace }: { trace: LoadedTrace }) {
  const step = usePlayer((s) => s.step)
  const go = usePlayer((s) => s.go)
  const [open, setOpen] = useState(false)
  const first = Math.max(0, step - 19)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={trace.narrations.length === 0}>
          Story
        </Button>
      </PopoverTrigger>
      <PopoverContent label="Story">
        <ol className="max-h-80 min-w-72 overflow-auto">
          {trace.narrations.slice(first, step + 1).map((line, index) => (
            <li key={first + index}>
              <Button
                size="sm"
                variant="ghost"
                className="h-auto w-full justify-start text-left whitespace-normal"
                aria-current={first + index === step ? 'step' : undefined}
                onClick={() => {
                  go(first + index)
                  setOpen(false)
                }}
              >
                <span className="mr-2 shrink-0 font-mono text-xs text-muted-foreground">
                  {first + index + 1}
                </span>{' '}
                <span>» {line}</span>
              </Button>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  )
}

function CodeBox({
  code,
  editorMode,
  header,
}: {
  code: string
  editorMode: string
  header: TraceHeader
}) {
  const state = usePlayer((s) => s.current)
  const breakpoints = usePlayer((s) => s.breakpoints)
  const fontSize = usePlayer((s) => s.settings.fontSize)
  const revealed = usePlayer((s) => s.revealed)
  const toggleBreakpoint = usePlayer((s) => s.toggleBreakpoint)
  return (
    <CodePane
      code={code}
      editorMode={editorMode}
      state={state}
      breakpoints={breakpoints}
      revealed={revealed}
      lineHits={header.summary.lineHits}
      lineHitsSource={header.summary.lineHitsSource}
      fontSize={fontSize}
      onToggleBreakpoint={toggleBreakpoint}
    />
  )
}

function outputEnd({ header, stepCount, tail }: LoadedTrace): OutputEnd {
  const { exit, untracedTail } = header.summary
  return {
    tail,
    afterStep: stepCount,
    truncated: exit.kind === 'output_limit' || untracedTail?.exit.kind === 'output_limit',
  }
}

function InputBox({ stdin, input }: { stdin: string; input: InputStep[] }) {
  const step = usePlayer((s) => s.current?.i ?? 0)
  return <StdinPanel stdin={stdin} position={input[step] ?? null} />
}

function OutputBox({ trace }: { trace: LoadedTrace }) {
  const output = usePlayer((s) => s.current?.output ?? noOutput)
  const shownStep = usePlayer((s) => s.current?.i ?? 0)
  const comparing = usePlayer((s) => s.comparing)
  const expected = usePlayer((s) => s.expected)
  const exact = usePlayer((s) => s.exact)
  const go = usePlayer((s) => s.go)
  const end = shownStep === trace.stepCount - 1 ? outputEnd(trace) : null
  const toggle = (
    <Check
      label="Compare"
      checked={comparing}
      onChange={(comparing) => usePlayer.setState({ comparing })}
    />
  )
  if (!comparing) return <OutputPanel output={output} end={end} action={toggle} />

  const comparison =
    expected === '' ? null : compareOutput(expected, exact, trace.prints, trace.tail)
  let mark: Mark | undefined
  if (
    comparison?.kind === 'differ' &&
    comparison.from !== null &&
    comparison.from !== 'untraced' &&
    comparison.from.step <= shownStep
  ) {
    mark = {
      at: shownAt(trace.prints, comparison.from),
      label: `differs at char ${comparison.char}`,
    }
  }
  return (
    <div className="grid min-h-0 grid-cols-2 grid-rows-[minmax(0,1fr)_auto]">
      <OutputPanel output={output} mark={mark} end={end} action={toggle} />
      <ExpectedPanel
        expected={expected}
        exact={exact}
        onExpected={(expected) => usePlayer.setState({ expected })}
        onExact={(exact) => usePlayer.setState({ exact })}
      />
      <div className="col-span-2">
        <CompareResult
          comparison={comparison}
          exact={exact}
          lastStep={trace.stepCount - 1}
          onGo={go}
        />
      </div>
    </div>
  )
}

function WatchBox({ trace }: { trace: LoadedTrace }) {
  const state = usePlayer((s) => s.current)
  const facts = usePlayer((s) => s.facts)
  const watched = usePlayer((s) => s.watches[trace.header.id] ?? noWatches)
  const watch = usePlayer((s) => s.watch)
  const unwatch = usePlayer((s) => s.unwatch)
  const autos = state === null ? [] : autoTargets(state, facts, watched)
  const histories = useHistories(trace, [...watched, ...autos])
  if (state === null) return null
  const languageId = trace.header.language.id
  const row = (text: string, auto: boolean) =>
    watchRow(state, parseTarget(text)!, text, auto, histories[text], languageId)
  const variables = state.stack.flatMap((f) =>
    f.locals.filter((l) => !l.internal).map((l) => l.name),
  )
  return (
    <WatchPanel
      rows={[...watched.map((t) => row(t, false)), ...autos.map((t) => row(t, true))]}
      variables={[...new Set(variables)]}
      onWatch={(text) => {
        const target = parseTarget(text)
        if (target === null) return 'Enter a variable or a cell such as a[2]'
        watch(trace.header.id, targetText(target))
        return null
      }}
      onUnwatch={(target) => unwatch(trace.header.id, target)}
    />
  )
}

function CallsBox({ trace }: { trace: LoadedTrace }) {
  const step = usePlayer((s) => s.current?.i)
  const line = usePlayer((s) => s.current?.line)
  const stack = usePlayer((s) => s.current?.stack)
  const go = usePlayer((s) => s.go)
  if (step === undefined || line === undefined || stack === undefined) return null
  return (
    <CallsPanel
      tree={trace.tree}
      step={step}
      line={line}
      stack={stack}
      languageId={trace.header.language.id}
      onGo={go}
    />
  )
}

function StateBox({
  traceId,
  languageId,
  pointers,
  onShowRange,
}: {
  traceId: string
  languageId: string
  pointers: boolean
  onShowRange?: (variable: string) => void
}) {
  const state = usePlayer((s) => s.current)
  const showInternals = usePlayer((s) => s.settings.showInternals)
  const showUnreachable = usePlayer((s) => s.settings.showUnreachable)
  const highlightChanges = usePlayer((s) => s.settings.highlightChanges)
  const drawArrows = usePlayer((s) => s.settings.drawArrows)
  const showAddresses = usePlayer((s) => s.settings.showAddresses)
  const matrixView = usePlayer((s) => s.settings.matrixView)
  const views = usePlayer((s) => s.views)
  const facts = usePlayer((s) => s.facts)
  const pins = usePlayer((s) => s.pins)
  const setPins = usePlayer((s) => s.setPins)
  const watch = usePlayer((s) => s.watch)
  const updateSettings = usePlayer((s) => s.updateSettings)
  const revealLine = usePlayer((s) => s.revealLine)
  const setView = usePlayer((s) => s.setView)
  return (
    <StatePane
      state={state}
      languageId={languageId}
      pointers={pointers}
      settings={{
        showInternals,
        showUnreachable,
        highlightChanges,
        drawArrows,
        showAddresses,
        matrixView,
      }}
      views={views}
      facts={facts}
      pins={pins}
      onPin={setPins}
      onWatch={(target) => watch(traceId, target)}
      onShowInternals={() => updateSettings({ showInternals: true })}
      onFrameLine={revealLine}
      onView={setView}
      onShowRange={onShowRange}
    />
  )
}

function SettingsBox({ language, header }: { language: LanguageInfo; header: TraceHeader }) {
  const settings = usePlayer((s) => s.settings)
  const updateSettings = usePlayer((s) => s.updateSettings)
  return (
    <SettingsDialog
      settings={settings}
      onChange={updateSettings}
      pointers={language.visualize.capabilities.pointers}
      safetyChecks={header.options.safetyChecks !== undefined}
      maxStepsCeiling={language.visualize.limits.maxStepsCeiling}
    />
  )
}

function failureText(error: unknown) {
  if (!isTraceError(error)) {
    return `Couldn't load this trace: ${error instanceof Error ? error.message : String(error)}`
  }
  switch (error.name) {
    case 'ChecksumError':
      return 'The trace failed its integrity check. Visualize again to get a fresh copy.'
    case 'NetworkError':
      return "Couldn't download the trace. Check your connection and visualize again."
    case 'VersionError':
      return 'This trace needs a newer visualizer. Reload the page to update.'
  }
}

function Shell({
  trace,
  code,
  stdin,
  language,
  permalink,
  onClose,
  onStartAt,
  onRaiseLimit,
  onShowRange,
  share,
  banner,
}: Omit<PlayerProps, 'source' | 'expected'> & { trace: LoadedTrace }) {
  const { header, stepCount } = trace
  useStepKeys(stepCount, onClose, (entry) => void runJump(entry, trace))
  useAutoplay(stepCount)
  useStepParam()
  const split = usePlayer((s) => s.split)
  const setSplit = usePlayer((s) => s.setSplit)
  const go = usePlayer((s) => s.go)

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-background text-foreground">
      <Header
        language={language.displayName}
        file={header.source.file}
        safetyChecks={header.options.safetyChecks}
        settings={<SettingsBox language={language} header={header} />}
        share={share}
        permalink={permalink}
        onClose={onClose}
      />
      <div
        className="grid min-h-0 grid-rows-[minmax(0,1fr)_10rem]"
        style={{ gridTemplateColumns: `minmax(0, ${split}fr) auto minmax(0, ${1 - split}fr)` }}
      >
        <div className="flex min-h-0 flex-col">
          <CodeBox code={code} editorMode={language.editorMode} header={header} />
          <ControlsBox trace={trace} />
        </div>
        <Divider split={split} onSplit={setSplit} />
        <div className="min-h-0 overflow-auto">
          <div className="px-(--pane-padding) pt-(--pane-padding)">
            <WatchBox trace={trace} />
          </div>
          {trace.tree.some((n) => n.depth > 0) && (
            <div className="px-(--pane-padding) pt-(--pane-padding)">
              <CallsBox trace={trace} />
            </div>
          )}
          <StateBox
            traceId={header.id}
            languageId={header.language.id}
            pointers={language.visualize.capabilities.pointers}
            onShowRange={onShowRange}
          />
        </div>
        <InputBox stdin={stdin} input={trace.input} />
        <OutputBox trace={trace} />
      </div>
      <StatusBar
        traceId={header.id}
        summary={header.summary}
        ending={trace.ending}
        stepCount={stepCount}
        maxSteps={header.options.maxSteps}
        maxStepsCeiling={language.visualize.limits.maxStepsCeiling}
        banner={banner}
        onGo={go}
        onStartAt={onStartAt}
        onRaiseLimit={onRaiseLimit}
      />
    </div>
  )
}

export function Player({ source, expected, ...props }: PlayerProps) {
  const session = useSession(source, expected ?? '', props.code, props.stdin)
  useDisplayOptions()

  if (session.status === 'loading') {
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading trace…
      </p>
    )
  }
  if (session.status === 'failed') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p>{failureText(session.error)}</p>
        <Button onClick={props.onClose}>Close</Button>
      </div>
    )
  }
  return <Shell {...props} trace={session} />
}
