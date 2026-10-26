import { useEffect } from 'react'
import { usePlayer } from './store.ts'

const stepMsAt1x = 500 // 1× = 2 steps/s (§5.9)

export function togglePlay(stepCount: number) {
  const { playing, step } = usePlayer.getState()
  if (playing) usePlayer.setState({ playing: false })
  else usePlayer.setState({ playing: true, step: step === stepCount - 1 ? 0 : step })
}

export function useAutoplay(stepCount: number) {
  const playing = usePlayer((s) => s.playing)
  const speed = usePlayer((s) => s.settings.autoplaySpeed)

  useEffect(() => {
    if (!playing) return
    const from = usePlayer.getState().step
    const timer = setInterval(() => {
      const { step, current, breakpoints } = usePlayer.getState()
      if (current === null || current.i !== step) return
      const arrived = step !== from
      const stop =
        step === stepCount - 1 ||
        (arrived && (current.error !== null || breakpoints.includes(current.line)))
      usePlayer.setState(stop ? { playing: false } : { step: step + 1 })
    }, stepMsAt1x / speed)
    return () => clearInterval(timer)
  }, [playing, speed, stepCount])
}
