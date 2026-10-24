import { Button } from '@viz/ui'
import { useEffect, useRef, type ReactNode } from 'react'
import { togglePlay, useAutoplay } from './autoplay.ts'
import { CodePane } from './code-pane.tsx'
import { Controls } from './controls.tsx'
import { useDisplayOptions } from './display.ts'
import { Divider } from './divider.tsx'
import type { OutputSegment } from './engine.ts'
import { Header } from './header.tsx'
import { useStepKeys } from './keys.ts'
import { isTraceError, type TraceHeader, type TraceSource } from './load.ts'
import { OutputPanel, StdinPanel } from './output.tsx'
import { useSession } from './session.ts'
import { SettingsDialog } from './settings.tsx'
import { StatusBar } from './status-bar.tsx'
import { useStepParam } from './step-param.ts'
import { usePlayer } from './store.ts'

export type LanguageInfo = {
  displayName: string
  editorMode: string
  visualize: { capabilities: { pointers: boolean }; limits: { maxStepsCeiling: number } }
}

type Slots = {
  statePane?: ReactNode
  share?: ReactNode
  banner?: ReactNode
}

type PlayerProps = Slots & {
  source: TraceSource
  code: string
  stdin: string
  language: LanguageInfo
  permalink?: string
  onClose: () => void
}

const noOutput: OutputSegment[] = []

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

function ControlsBox({ stepCount }: { stepCount: number }) {
  const state = usePlayer((s) => s.current)
  const step = usePlayer((s) => s.step)
  const playing = usePlayer((s) => s.playing)
  const speed = usePlayer((s) => s.settings.autoplaySpeed)
  const go = usePlayer((s) => s.go)
  const scrub = useFrameThrottle(go)
  return (
    <Controls
      state={state}
      step={step}
      stepCount={stepCount}
      playing={playing}
      speed={speed}
      onGo={go}
      onScrub={scrub}
      onTogglePlay={() => togglePlay(stepCount)}
    />
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
  const toggleBreakpoint = usePlayer((s) => s.toggleBreakpoint)
  return (
    <CodePane
      code={code}
      editorMode={editorMode}
      state={state}
      breakpoints={breakpoints}
      lineHits={header.summary.lineHits}
      lineHitsSource={header.summary.lineHitsSource}
      fontSize={fontSize}
      onToggleBreakpoint={toggleBreakpoint}
    />
  )
}

function OutputBox() {
  const output = usePlayer((s) => s.current?.output ?? noOutput)
  return <OutputPanel output={output} />
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
  header,
  stepCount,
  code,
  stdin,
  language,
  permalink,
  onClose,
  statePane,
  share,
  banner,
}: Omit<PlayerProps, 'source'> & { header: TraceHeader; stepCount: number }) {
  useStepKeys(stepCount, onClose)
  useAutoplay(stepCount)
  useStepParam()
  const split = usePlayer((s) => s.split)
  const setSplit = usePlayer((s) => s.setSplit)

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
          <ControlsBox stepCount={stepCount} />
        </div>
        <Divider split={split} onSplit={setSplit} />
        <div className="min-h-0 overflow-auto">{statePane}</div>
        <StdinPanel stdin={stdin} />
        <OutputBox />
      </div>
      <StatusBar stepCount={stepCount} exit={header.summary.exit} banner={banner} />
    </div>
  )
}

export function Player({ source, ...props }: PlayerProps) {
  const session = useSession(source)
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
  return <Shell {...props} header={session.header} stepCount={session.stepCount} />
}
