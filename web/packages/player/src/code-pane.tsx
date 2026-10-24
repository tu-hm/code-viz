import type { EditorView } from '@codemirror/view'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  createCodeView,
  focusLine,
  loadLanguage,
  scrollToLine,
  setFontSize,
  setLanguage,
  setLines,
  type LineMarks,
  type Lines,
} from './code-view.ts'
import type { StepState } from './engine.ts'
import type { Summary } from './gen/trace.ts'
import type { Settings } from './store.ts'

type CodePaneProps = {
  code: string
  editorMode: string
  state: StepState | null
  breakpoints: number[]
  lineHits: Summary['lineHits']
  lineHitsSource: Summary['lineHitsSource']
  fontSize: Settings['fontSize']
  onToggleBreakpoint: (line: number) => void
}

const noMarks: LineMarks = { executed: null, next: null, error: null }

function lineMarks({ prevLine, line, error }: StepState): LineMarks {
  const errorLine = error?.line ?? null
  return {
    executed: prevLine === errorLine ? null : prevLine,
    next: error === null && line !== prevLine ? line : null,
    error: errorLine,
  }
}

function breakpointNote(breakpoints: number[]) {
  if (breakpoints.length === 0) {
    return 'Click a line number, or press Enter on a line, to set a breakpoint.'
  }
  const where =
    breakpoints.length === 1
      ? `Breakpoint on line ${breakpoints[0]} stops`
      : `Breakpoints on lines ${breakpoints.join(', ')} stop`
  return `${where} autoplay. “Start tracing from line…” offers them on the next run.`
}

export function CodePane({
  code,
  editorMode,
  state,
  breakpoints,
  lineHits,
  lineHitsSource,
  fontSize,
  onToggleBreakpoint,
}: CodePaneProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const [plainMode, setPlainMode] = useState<string | null>(null)
  const { executed, next, error } = state === null ? noMarks : lineMarks(state)
  const focus = focusLine({ executed, next, error })

  const toggle = useEffectEvent((line: number) => onToggleBreakpoint(line))
  const shown = useEffectEvent((): Lines => ({ marks: { executed, next, error }, breakpoints }))

  useEffect(() => {
    const hits =
      lineHits === undefined ? null : { counts: lineHits, recordedOnly: lineHitsSource === 'trace' }
    const v = createCodeView(host.current!, {
      code,
      lines: shown(),
      hits,
      onToggle: (line) => toggle(line),
    })
    view.current = v
    let alive = true
    loadLanguage(editorMode).then(
      (extension) => {
        if (alive) setLanguage(v, extension)
      },
      () => {
        if (alive) setPlainMode(editorMode)
      },
    )
    return () => {
      alive = false
      v.destroy()
    }
  }, [code, editorMode, lineHits, lineHitsSource])

  useEffect(() => {
    view.current!.dispatch({
      effects: setLines.of({ marks: { executed, next, error }, breakpoints }),
    })
  }, [executed, next, error, breakpoints])

  useEffect(() => {
    if (focus !== null) scrollToLine(view.current!, focus)
  }, [focus])

  useEffect(() => setFontSize(view.current!, fontSize), [fontSize])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div ref={host} className="min-h-0 flex-1" />
      <div className="flex flex-col gap-0.5 px-(--pane-padding) py-1.5 text-xs text-muted-foreground">
        <p aria-live="polite">{breakpointNote(breakpoints)}</p>
        {lineHits !== undefined && lineHitsSource === 'trace' && (
          <p>Hit counts (×n) cover the recorded steps only.</p>
        )}
        {plainMode === editorMode && (
          <p>Syntax highlighting didn’t load, so the code is shown as plain text.</p>
        )}
      </div>
    </div>
  )
}
