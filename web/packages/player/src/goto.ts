import { compareOutput, jumpTarget } from './compare.ts'
import type { Jump, Target } from './search.ts'
import type { LoadedTrace } from './session.ts'
import { usePlayer } from './store.ts'

export const entries = ['over', 'out', 'line', 'change', 'call', 'print', 'diff', 'error'] as const
export type Entry = (typeof entries)[number]

export const shortcuts: Record<Entry, string> = {
  over: 'Shift + →',
  out: 'Shift + ↑',
  line: 'L',
  change: 'C',
  call: 'F',
  print: 'P',
  diff: 'D',
  error: 'E',
}

type Params = Pick<
  ReturnType<typeof usePlayer.getState>,
  'breakpoints' | 'jumpLine' | 'jumpChange' | 'jumpCall' | 'expected' | 'exact'
>

type Plan = { label: string } & ({ jump: Jump } | { at: number } | { missing: string })

export function parseTarget(text: string): Target | null {
  const m = /^\s*([A-Za-z_]\w*)((?:\[\d+\])*)\s*$/.exec(text)
  if (m === null) return null
  return { name: m[1]!, indices: [...m[2]!.matchAll(/\d+/g)].map((d) => Number(d[0])) }
}

export function plan(entry: Entry, p: Params, trace: LoadedTrace): Plan {
  switch (entry) {
    case 'over':
      return { label: 'Step over', jump: { kind: 'over' } }
    case 'out':
      return { label: 'Step out', jump: { kind: 'out' } }
    case 'line': {
      const typed = p.jumpLine.trim()
      if (typed === '' && p.breakpoints.length > 0) {
        return { label: 'Next breakpoint', jump: { kind: 'line', lines: p.breakpoints } }
      }
      if (!/^\d+$/.test(typed)) {
        return {
          label: 'Next time a line runs',
          missing: 'set a breakpoint or enter a line number',
        }
      }
      return {
        label: `Next time line ${typed} runs`,
        jump: { kind: 'line', lines: [Number(typed)] },
      }
    }
    case 'change': {
      const target = parseTarget(p.jumpChange)
      if (target === null) {
        return {
          label: 'Next change',
          missing: 'enter a variable, a cell such as a[2], or an array',
        }
      }
      return { label: `Next change of ${p.jumpChange.trim()}`, jump: { kind: 'change', target } }
    }
    case 'call': {
      const name = p.jumpCall ?? Object.keys(trace.calls)[0]
      if (name === undefined) return { label: 'Next call', missing: 'this run calls no functions' }
      return { label: `Next call of ${name}`, jump: { kind: 'call', name } }
    }
    case 'print':
      return { label: 'Next print to output', jump: { kind: 'print' } }
    case 'diff': {
      const label = 'First difference from expected output'
      if (p.expected === '') return { label, missing: 'paste the expected output first' }
      const c = compareOutput(p.expected, p.exact, trace.prints, trace.tail)
      if (c.kind === 'match') return { label, missing: 'the output matches' }
      const at = jumpTarget(c, trace.stepCount - 1)
      if (at === null) return { label, missing: 'it was printed after the last traced step' }
      return { label, at }
    }
    case 'error':
      return { label: 'Error step', jump: { kind: 'error' } }
  }
}

export function locate(p: Plan, from: number, trace: LoadedTrace): Promise<number | null> {
  if ('missing' in p) return Promise.resolve(null)
  if ('at' in p) return Promise.resolve(p.at)
  return trace.find(from, p.jump)
}

export async function runJump(entry: Entry, trace: LoadedTrace) {
  const state = usePlayer.getState()
  const from = state.step
  const p = plan(entry, state, trace)
  if ('missing' in p) {
    usePlayer.setState({ notice: `${p.label}: ${p.missing}` })
    return
  }
  let target: number | null
  try {
    target = await locate(p, from, trace)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    usePlayer.setState({ notice: `Couldn't search the trace: ${reason}` })
    return
  }
  if (usePlayer.getState().step !== from) return
  if (target === null) {
    usePlayer.setState({ notice: `${p.label}: not found after step ${from + 1}` })
    return
  }
  usePlayer.getState().go(target)
}
