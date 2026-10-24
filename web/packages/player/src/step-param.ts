import { useEffect } from 'react'
import { usePlayer } from './store.ts'

// Safari throws after 100 replaceState calls in 30 s => write once stepping pauses
const writeDelayMs = 300

export function stepFromUrl(search: string, stepCount: number) {
  const raw = new URLSearchParams(search).get('step')
  if (raw === null) return 0
  if (!/^\d+$/.test(raw)) throw new Error(`?step=${raw}: want a step number from 1 to ${stepCount}`)
  return Math.min(Math.max(Number(raw), 1), stepCount) - 1
}

export function useStepParam() {
  useEffect(() => {
    let timer = 0
    const unsubscribe = usePlayer.subscribe((s, prev) => {
      if (s.step === prev.step) return
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const url = new URL(location.href)
        url.searchParams.set('step', String(usePlayer.getState().step + 1))
        history.replaceState(history.state, '', url)
      }, writeDelayMs)
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [])
}
