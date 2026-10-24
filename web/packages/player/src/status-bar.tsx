import type { ReactNode } from 'react'
import type { Exit } from './gen/trace.ts'

function exitText({ kind, code, signal }: Exit) {
  let text: string = kind
  if (code !== null) text += ` (${code})`
  if (signal !== null) text += ` ${signal}`
  return text
}

export function StatusBar({
  stepCount,
  exit,
  banner,
}: {
  stepCount: number
  exit: Exit
  banner?: ReactNode
}) {
  return (
    <footer className="flex flex-col gap-1 px-(--pane-padding) py-1.5 font-mono text-xs text-muted-foreground">
      {banner}
      <p>
        Ready · {stepCount.toLocaleString('en')} steps · exit: {exitText(exit)}
      </p>
    </footer>
  )
}
