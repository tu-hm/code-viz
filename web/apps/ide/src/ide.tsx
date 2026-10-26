import { useQuery } from '@tanstack/react-query'
import { usePlayer } from '@viz/player'
import { Button } from '@viz/ui'
import { useEffect, useEffectEvent, useId, useState } from 'react'
import { version } from '../package.json'
import type { Language } from './api.ts'
import { Editor, type Cursor } from './editor.tsx'
import { useFlag } from './flags.ts'
import { starter, type Draft } from './starters.ts'
import { languagesQuery, useRun } from './visualize.ts'
import { Visualizer } from './visualizer.tsx'

type IdeViewProps = {
  languages: Language[]
  language: Language
  draft: Draft
  cursor: Cursor | null
  onLanguage: (id: string) => void
  onCode: (code: string) => void
  onStdin: (stdin: string) => void
  onVisualize: (() => void) | null
}

function isShortcut(e: KeyboardEvent) {
  return e.key === 'Enter' && e.shiftKey && (e.ctrlKey || e.metaKey)
}

function IdeView({
  languages,
  language,
  draft,
  cursor,
  onLanguage,
  onCode,
  onStdin,
  onVisualize,
}: IdeViewProps) {
  const stdinId = useId()
  const shortcut = useEffectEvent((e: KeyboardEvent) => {
    if (onVisualize === null || !isShortcut(e)) return
    e.preventDefault()
    onVisualize()
  })
  useEffect(() => {
    // capture: before CodeMirror sees the Enter
    window.addEventListener('keydown', shortcut, { capture: true })
    return () => window.removeEventListener('keydown', shortcut, { capture: true })
  }, [])

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground md:grid md:h-dvh md:grid-cols-2 md:grid-rows-[auto_auto_minmax(0,1fr)]">
      <header className="px-(--pane-padding) py-2 md:col-span-2">
        <h1 className="mono-label text-muted-foreground">Code Visualizer</h1>
      </header>
      <div className="flex items-center gap-3 px-(--pane-padding) py-2">
        <select
          aria-label="Language"
          value={language.id}
          onChange={(e) => onLanguage(e.target.value)}
          className="h-9 rounded-full border border-input bg-background px-3 text-base md:text-sm"
        >
          {languages.map((l) => (
            <option key={l.id} value={l.id}>
              {l.displayName}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3 px-(--pane-padding) py-2">
        {onVisualize !== null && (
          <>
            <Button
              variant="primary"
              aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
              onClick={onVisualize}
            >
              Visualize
            </Button>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              Ctrl/Cmd + Shift + Enter
            </span>
          </>
        )}
      </div>
      <div className="h-[60dvh] min-h-0 md:h-auto">
        <Editor
          key={language.id}
          code={draft.code}
          editorMode={language.editorMode}
          cursor={cursor}
          onChange={onCode}
        />
      </div>
      <div className="grid min-h-0 grid-rows-2">
        <section className="flex min-h-0 flex-col gap-1 bg-muted py-2">
          <label htmlFor={stdinId} className="mono-label px-(--pane-padding) text-muted-foreground">
            Stdin
          </label>
          <textarea
            id={stdinId}
            value={draft.stdin}
            onChange={(e) => onStdin(e.target.value)}
            spellCheck={false}
            className="min-h-24 flex-1 resize-none bg-muted px-(--pane-padding) font-mono text-base leading-(--code-line-height) md:text-(length:--code-font-size)"
          />
        </section>
        <section aria-label="Output" className="flex flex-col gap-1 bg-muted py-2">
          <h2 className="mono-label px-(--pane-padding) text-muted-foreground">Output</h2>
          <p className="px-(--pane-padding) text-faint">Run results appear here.</p>
        </section>
      </div>
    </main>
  )
}

export function Ide() {
  const visualizeOn = useFlag('visualize')
  const languages = useQuery(languagesQuery)
  const [languageId, setLanguageId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const { run, created, error, start, retry, close } = useRun()

  if (languages.data === undefined) {
    if (languages.error === null) {
      return (
        <p role="status" className="p-6 text-muted-foreground">
          Loading languages…
        </p>
      )
    }
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p>Couldn't load the languages: {languages.error.message}</p>
        <Button onClick={() => void languages.refetch()}>Retry</Button>
      </div>
    )
  }
  const language = languages.data.find((l) => l.id === languageId) ?? languages.data[0]
  if (language === undefined) {
    return <p className="p-6">The API offers no languages.</p>
  }
  const draft = drafts[language.id] ?? starter(language.id)

  const edit = (patch: Partial<Draft>) => {
    const id = language.id
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? starter(id)), ...patch } }))
  }

  const visualize = () => {
    const { settings } = usePlayer.getState()
    start(
      {
        language: language.id,
        source: draft.code,
        stdin: draft.stdin,
        options: {
          maxSteps: Math.min(settings.maxSteps, language.visualize.limits.maxStepsCeiling),
          startAtLines: [],
          showInternals: settings.showInternals,
        },
        context: { problemCode: null, client: `ide-web/${version}` },
      },
      language,
    )
  }

  return (
    <>
      <div hidden={run !== null}>
        <IdeView
          languages={languages.data}
          language={language}
          draft={draft}
          cursor={cursor}
          onLanguage={(id) => {
            setLanguageId(id)
            setCursor(null)
          }}
          onCode={(code) => edit({ code })}
          onStdin={(stdin) => edit({ stdin })}
          onVisualize={run === null && visualizeOn && language.visualize.enabled ? visualize : null}
        />
      </div>
      {run !== null && (
        <Visualizer
          key={run.key}
          run={run}
          created={created}
          error={error}
          onClose={close}
          onRetry={retry}
          onRerun={(request) => start(request, run.language)}
          onGoToLine={(line, column) => {
            close()
            setCursor({ line, column })
          }}
        />
      )}
    </>
  )
}
