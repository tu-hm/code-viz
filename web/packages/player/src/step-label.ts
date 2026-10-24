import type { StepState } from './engine.ts'
import type { Frame, Value } from './gen/trace.ts'

export function valueText(v: Value): string {
  switch (v.t) {
    case 'str':
      return JSON.stringify(v.v ?? '')
    case 'char':
      return `'${v.v ?? ''}'`
    case 'none':
      return 'None'
    case 'ref':
      return `#${v.id ?? '?'}`
    case 'ptr':
      if (v.addr === '0x0') return '∅'
      return v.target === undefined ? (v.addr ?? '?') : `→ #${v.target}`
    case 'uninit':
      return '·'
    case 'unavailable':
      return '?'
    default:
      return v.v ?? v.t
  }
}

function callee(frame: Frame) {
  return frame.kind === 'global' ? frame.name : `${frame.name}()`
}

export function stepDetail(state: StepState): string {
  const frame = state.stack.at(-1)
  if (!frame) return state.event
  switch (state.event) {
    case 'call': {
      const args = frame.locals
        .filter((l) => !l.internal && l.value.t !== 'uninit')
        .map((l) => `${l.name}=${valueText(l.value)}`)
      return `call ${frame.name}(${args.join(', ')})`
    }
    case 'return':
      return frame.returnValue === null
        ? `return from ${callee(frame)}`
        : `return ${valueText(frame.returnValue)} from ${callee(frame)}`
    case 'exception':
      return `exception in ${callee(frame)}`
    case 'exit':
      return 'exit'
    case 'line':
      return state.prevLine === null
        ? `line ${state.line}`
        : `line ${state.prevLine} → ${state.line}`
  }
}
