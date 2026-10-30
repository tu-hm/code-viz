import { Button } from '@viz/ui'
import type { Visualization } from './api.ts'

type Build = NonNullable<Visualization['build']>
type Diagnostic = Build['diagnostics'][number]

export type GoToLine = (line: number, column: number) => void

function Excerpt({ lines, line, column }: { lines: string[]; line: number; column: number }) {
  const text = lines[line - 1]
  if (text === undefined) return null
  const next = lines[line]
  const width = String(next === undefined ? line : line + 1).length
  const gutter = (n: number | '') => String(n).padStart(width)
  // tabs stay tabs, so the caret lines up under them
  const caret = text.slice(0, column - 1).replace(/[^\t]/g, ' ') + '^'
  return (
    <pre className="overflow-x-auto rounded-xl bg-muted px-3 py-2 font-mono text-xs leading-5">
      {`${gutter(line)} | ${text}\n${gutter('')} | `}
      <span className="text-danger">{caret}</span>
      {next !== undefined && `\n${gutter(line + 1)} | ${next}`}
    </pre>
  )
}

export function DiagnosticList({
  diagnostics,
  source,
  file,
  onGoToLine,
}: {
  diagnostics: Diagnostic[]
  source: string
  file: string | null
  onGoToLine: GoToLine
}) {
  const lines = source.split('\n')
  return (
    <ol className="flex w-full flex-col gap-3">
      {diagnostics.map((d, i) => (
        <li key={i} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="font-mono text-sm">
              {file === null ? '' : `${file}:`}
              {d.line}:{d.column}{' '}
              <span className={d.severity === 'error' ? 'text-danger' : 'text-warning'}>
                {d.severity}:
              </span>{' '}
              {d.message}
            </p>
            <Button size="sm" onClick={() => onGoToLine(d.line, d.column)}>
              Go to line {d.line}
            </Button>
          </div>
          <Excerpt lines={lines} line={d.line} column={d.column} />
        </li>
      ))}
    </ol>
  )
}

export function RawOutput({ raw }: { raw: string }) {
  return (
    <details className="w-full">
      <summary className="cursor-pointer text-sm font-medium">Raw compiler output</summary>
      <pre className="mt-2 overflow-x-auto rounded-xl bg-muted px-3 py-2 font-mono text-xs">
        {raw}
      </pre>
    </details>
  )
}

export function BuildWarnings({
  build,
  source,
  file,
  onGoToLine,
}: {
  build: Build
  source: string
  file: string
  onGoToLine: GoToLine
}) {
  const warnings = build.diagnostics.filter((d) => d.severity === 'warning')
  if (warnings.length === 0) return null
  return (
    <details className="rounded-xl bg-warning-subtle px-3 py-2 font-sans text-sm text-foreground">
      <summary className="cursor-pointer font-medium">
        <span aria-hidden className="text-warning">
          (!){' '}
        </span>
        {warnings.length === 1 ? '1 compiler warning' : `${warnings.length} compiler warnings`}
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <DiagnosticList
          diagnostics={warnings}
          source={source}
          file={file}
          onGoToLine={onGoToLine}
        />
        {build.raw !== undefined && <RawOutput raw={build.raw} />}
      </div>
    </details>
  )
}
