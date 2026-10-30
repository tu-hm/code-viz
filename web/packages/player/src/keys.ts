import { useEffect, useEffectEvent } from 'react'
import { togglePlay } from './autoplay.ts'
import type { Entry } from './goto.ts'
import { usePlayer } from './store.ts'

const jumpKeys: Record<string, Entry> = {
  l: 'line',
  c: 'change',
  w: 'where',
  f: 'call',
  p: 'print',
  d: 'diff',
  e: 'error',
}

const shiftJumpKeys: Record<string, Entry> = { ArrowRight: 'over', ArrowUp: 'out' }

const ownsArrows = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

function ownsKey(target: EventTarget | null, key: string) {
  if (!(target instanceof Element)) return false
  const typing =
    '[role="dialog"], [contenteditable]:not([contenteditable="false"]):not([aria-readonly="true"])'
  if (target.closest(typing)) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    if (target.type === 'range') return ownsArrows.has(key)
    if (target.type === 'checkbox' || target.type === 'radio')
      return key === ' ' || ownsArrows.has(key)
    if (target.type === 'button' || target.type === 'submit' || target.type === 'reset')
      return key === ' '
    return true
  }
  if (target.getAttribute('role') === 'separator') return ownsArrows.has(key)
  return key === ' ' && target.closest('button, a[href], summary') !== null
}

export function useStepKeys(
  stepCount: number,
  onClose: () => void,
  onJump: (entry: Entry) => void,
) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return
    if (ownsKey(e.target, e.key)) return
    const jump = e.shiftKey ? shiftJumpKeys[e.key] : jumpKeys[e.key.toLowerCase()]
    if (jump !== undefined) {
      e.preventDefault()
      onJump(jump)
      return
    }
    if (e.shiftKey) return
    const { step, go } = usePlayer.getState()
    const last = stepCount - 1
    switch (e.key) {
      case 'ArrowRight':
        go(Math.min(step + 1, last))
        break
      case 'ArrowLeft':
        go(Math.max(step - 1, 0))
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(last)
        break
      case ' ':
        togglePlay(stepCount)
        break
      case 'Escape':
        onClose()
        break
      default:
        return
    }
    e.preventDefault()
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
