import { Button } from '@viz/ui'
import type { ReactNode } from 'react'

type HeaderProps = {
  language: string
  file: string
  safetyChecks: boolean | undefined
  settings: ReactNode
  share?: ReactNode
  permalink?: string
  onClose: () => void
}

export function Header({
  language,
  file,
  safetyChecks,
  settings,
  share,
  permalink,
  onClose,
}: HeaderProps) {
  return (
    <header className="flex items-center gap-3 px-(--pane-padding) py-2">
      <h1 className="min-w-0 truncate font-medium">
        Visualizer · {language} · {file}
      </h1>
      {safetyChecks !== undefined && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          Safety checks: {safetyChecks ? 'on' : 'off'}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {settings}
        {share}
        {permalink !== undefined && (
          <Button asChild size="sm" variant="ghost">
            <a href={permalink} target="_blank" rel="noopener">
              Open in new tab
            </a>
          </Button>
        )}
        <Button size="icon" variant="ghost" aria-label="Close visualizer" onClick={onClose}>
          <span aria-hidden>✕</span>
        </Button>
      </div>
    </header>
  )
}
