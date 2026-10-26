import type { StepState } from './engine.ts'
import type { Local, Value } from './gen/trace.ts'
import { cellValue } from './marks.ts'
import { shown } from './narration.ts'
import type { Change, Target } from './search.ts'
import { lineFacts, type SourceFacts } from './source-facts.ts'

export type WatchRow = {
  target: string
  auto: boolean
  // null => not in scope
  value: string | null
  changed: boolean
  // null => history still loading, or not in scope
  history: string | null
}

// innermost frame that declares the name, as search.ts reads it
function local(state: StepState, name: string): Local | undefined {
  const frame = state.stack.findLast((f) => f.locals.some((l) => l.name === name))
  return frame?.locals.find((l) => l.name === name)
}

function resolve(state: StepState, target: Target): Value | undefined {
  let value = local(state, target.name)?.value
  for (const index of target.indices) {
    if (value?.t !== 'ref' || value.id === undefined) return undefined
    const o = state.heap[value.id]
    if (o?.kind !== 'sequence' || index < 0 || index >= (o.length ?? 0)) return undefined
    value = cellValue(o, index)
  }
  return value
}

export function autoTargets(state: StepState, facts: SourceFacts | null, pinned: string[]) {
  return lineFacts(facts, state.line).identifiers.filter((name) => {
    if (pinned.includes(name)) return false
    const l = local(state, name)
    return l !== undefined && !l.internal && l.value.t !== 'ref'
  })
}

function historyText(changes: Change[], step: number, value: Value, languageId: string) {
  const last = changes.findLast((c) => c.step <= step)
  if (last === undefined) return null
  const now = shown(value, languageId)
  if (last.before === null || last.before.t === 'uninit') return `${now} (unchanged)`
  if (value.t === 'ref') return `changed at step ${last.step + 1}`
  return `${shown(last.before, languageId)} → ${now}`
}

export function watchRow(
  state: StepState,
  target: Target,
  text: string,
  auto: boolean,
  changes: Change[] | undefined,
  languageId: string,
): WatchRow {
  const value = resolve(state, target)
  if (value === undefined) return { target: text, auto, value: null, changed: false, history: null }
  return {
    target: text,
    auto,
    value: shown(value, languageId),
    changed: changes?.findLast((c) => c.step <= state.i)?.step === state.i,
    history: changes === undefined ? null : historyText(changes, state.i, value, languageId),
  }
}
