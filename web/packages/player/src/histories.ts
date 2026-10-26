import { useEffect, useState } from 'react'
import { parseTarget } from './goto.ts'
import type { Change } from './search.ts'
import type { LoadedTrace } from './session.ts'
import { usePlayer } from './store.ts'

export function useHistories(trace: LoadedTrace, targets: string[]) {
  const [histories, setHistories] = useState<Record<string, Change[]>>({})
  const key = targets.join('\n')
  useEffect(() => {
    let alive = true
    for (const text of key === '' ? [] : key.split('\n')) {
      trace.history(parseTarget(text)!).then(
        (changes) => {
          if (alive) setHistories((h) => (h[text] === changes ? h : { ...h, [text]: changes }))
        },
        (e: unknown) => {
          const reason = e instanceof Error ? e.message : String(e)
          if (alive) usePlayer.setState({ notice: `Couldn't search the trace: ${reason}` })
        },
      )
    }
    return () => {
      alive = false
    }
  }, [key, trace])
  return histories
}
