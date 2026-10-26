import type { StepState } from './engine.ts'
import type { StepError } from './friendly.ts'
import type { Step } from './gen/trace.ts'
import { callee, valueText } from './step-label.ts'

export type Crash = { step: number; error: StepError; frame: string }

export type Stop = { line: number; frame: string; values: string[] }

export type Ending = { crash: Crash | null; stop: Stop | null }

const scalars = new Set(['int', 'float', 'bool', 'char', 'str'])
const stopValues = 3

// the error that ended the program: only its unwinding (exception, return, exit steps) follows it
function raisedAt(steps: Step[]) {
  let at: number | null = null
  for (let k = steps.length - 1; k >= 0; k--) {
    const { event, error } = steps[k]!
    if (event === 'call' || event === 'line') break
    if (error !== null) at = k
  }
  return at
}

function stop({ line, stack }: StepState): Stop | null {
  const top = stack.at(-1)
  if (top === undefined) return null
  const values = top.locals
    .filter((l) => !l.internal && scalars.has(l.value.t))
    .slice(0, stopValues)
    .map((l) => `${l.name} = ${valueText(l.value)}`)
  return { line, frame: callee(top), values }
}

export function ending(steps: Step[], state: (k: number) => StepState): Ending {
  if (steps.length === 0) return { crash: null, stop: null }
  const at = raisedAt(steps)
  const raised = at === null ? null : state(at)
  const frame = raised?.stack.at(-1)
  return {
    crash:
      raised !== null && raised.error !== null && frame !== undefined
        ? { step: raised.i, error: raised.error, frame: callee(frame) }
        : null,
    stop: stop(state(steps.length - 1)),
  }
}
