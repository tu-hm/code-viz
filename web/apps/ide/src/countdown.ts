import { useEffect, useState } from 'react'

export function waitText(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return s === 0 ? `${m} min` : `${m} min ${s} s`
  return `${s} s`
}

// useCountdown returns the seconds left of a wait that starts when the caller mounts
export function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    if (seconds <= 0) return
    const end = Date.now() + seconds * 1000
    const timer = setInterval(() => {
      const rest = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setLeft(rest)
      if (rest === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [seconds])
  return left
}
