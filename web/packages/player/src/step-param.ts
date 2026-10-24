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

function writeStep(step: number | null) {
  const url = new URL(location.href)
  if (step === null) url.searchParams.delete('step')
  else url.searchParams.set('step', String(step + 1))
  history.replaceState(history.state, '', url)
}

// the param belongs to the open trace => dropped on close, so the next trace opens at its first step
export function useStepParam() {
  useEffect(() => {
    let timer = 0
    const { step } = usePlayer.getState()
    if (step > 0) writeStep(step)
    const unsubscribe = usePlayer.subscribe((s, prev) => {
      if (s.step === prev.step) return
      clearTimeout(timer)
      timer = window.setTimeout(() => writeStep(usePlayer.getState().step), writeDelayMs)
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
      writeStep(null)
    }
  }, [])
}
