import type { StepState } from './engine.ts'
import { createEngine } from './engine.ts'
import { friendly, rawTitle, type Part } from './friendly.ts'
import { formatterFor } from './format.ts'
import type { HeapObject, Step, StdinPos, Value } from './gen/trace.ts'
import { cellValue, isDefault } from './marks.ts'
import { evaluate, lineFacts, type SourceFacts, type Subscript } from './source-facts.ts'
import { valueText } from './step-label.ts'

export type InputStep = StdinPos & { from: number; fromBytes: number; read: string[] }
export type NarratedTrace = { narrations: string[]; input: InputStep[]; inputReads: number[] }

function tokens(stdin: string) {
  return [...stdin.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    end: match.index + match[0].length,
  }))
}

function inputSteps(steps: Step[], stdin: string, facts: SourceFacts | null, languageId: string) {
  const words = tokens(stdin)
  const positions: InputStep[] = []
  let token = 0
  let bytes = 0
  let inferred = false
  for (const step of steps) {
    const from = token
    const fromBytes = bytes
    if (step.stdinPos) {
      token = step.stdinPos.token
      bytes = step.stdinPos.bytes
      inferred = step.stdinPos.inferred
    } else if (languageId.startsWith('cpp') && step.prevLine !== null) {
      const line = lineFacts(facts, step.prevLine)
      const count =
        line.inputs.length + line.scanf.filter((conversion) => !conversion.endsWith('n')).length
      if (count > 0) {
        token = Math.min(words.length, token + count)
        bytes = words[token - 1]?.end ?? bytes
        inferred = true
      } else if (line.getline) {
        const end = stdin.indexOf('\n', bytes)
        bytes = end < 0 ? stdin.length : end + 1
        token = words.filter((word) => word.end <= bytes).length
        inferred = true
      }
    }
    positions.push({
      bytes,
      token,
      inferred,
      from,
      fromBytes,
      read: words.slice(from, token).map((word) => word.text),
    })
  }
  return positions
}

function plain(parts: Part[]) {
  return parts.map((part) => (typeof part === 'string' ? part : part.code)).join('')
}

function scope(state: StepState) {
  const values: Record<string, Value> = {}
  for (const frame of [...state.stack.filter((f) => f.kind === 'global'), state.stack.at(-1)]) {
    for (const local of frame?.locals ?? []) values[local.name] = local.value
  }
  return values
}

function indexOf(subscript: Subscript, before: Record<string, Value>) {
  return subscript.indices.map((index) =>
    evaluate(index, (name) => {
      const value = before[name]
      return value?.t === 'int' && value.v !== undefined ? Number(value.v) : undefined
    }),
  )
}

function at(heap: Record<string, HeapObject>, root: Value | undefined, indices: (number | null)[]) {
  let value = root
  for (const index of indices) {
    if (index === null || value?.t !== 'ref' || value.id === undefined) return undefined
    const object = heap[value.id]
    value = object === undefined ? undefined : cellValue(object, index)
  }
  return value
}

function beforeAt(state: StepState, root: Value | undefined, indices: (number | null)[]) {
  const parent = at(state.heap, root, indices.slice(0, -1))
  const index = indices.at(-1)
  if (parent?.t === 'ref' && parent.id !== undefined && index !== null && index !== undefined) {
    const old = state.before.cells[parent.id]?.[String(index)]
    if (old !== undefined) return old
  }
  return at(state.heap, root, indices)
}

export function shown(value: Value | undefined, languageId: string, cell = false) {
  if (value === undefined || value.t === 'uninit' || (cell && isDefault(value))) return '·'
  if (value.t === 'ref' || value.t === 'ptr') return valueText(value)
  return formatterFor(languageId).value(value).text
}

function assignment(state: StepState, facts: SourceFacts | null, languageId: string) {
  const line = lineFacts(facts, state.prevLine)
  const current = scope(state)
  const before = state.before.scope
  const writes = line.subscripts.filter((subscript) => subscript.mode !== 'r')
  for (const write of writes) {
    const indices = indexOf(write, before)
    if (indices.some((index) => index === null)) continue
    const root = before[write.array] ?? current[write.array]
    const last = indices.at(-1)!
    const parent = at(state.heap, root, indices.slice(0, -1))
    if (parent?.t !== 'ref' || parent.id === undefined) continue
    if (!state.changed.cells[parent.id]?.includes(String(last))) continue
    const now = at(state.heap, current[write.array], indices)
    const prior = beforeAt(state, root, indices)
    const name = `${write.array}${indices.map((index) => `[${index}]`).join('')}`
    const reads = line.subscripts.filter(
      (subscript) => subscript !== write && subscript.mode !== 'w',
    )
    const from = reads.flatMap((read) => {
      const path = indexOf(read, before)
      const value = beforeAt(state, before[read.array], path)
      return value === undefined
        ? []
        : [
            `${read.array}${path.map((index) => `[${index}]`).join('')} = ${shown(value, languageId, true)}`,
          ]
    })
    return `${name} = ${shown(now, languageId, true)} (was ${shown(prior, languageId, true)})${from.length > 0 ? `, from ${join(from)}` : ''}`
  }

  const changed = state.stack.flatMap((frame) =>
    frame.locals.filter(
      (local) => state.changed.locals[frame.id]?.includes(local.name) && !local.internal,
    ),
  )
  if (changed.length !== 1 || state.prevLine === null) return null
  const local = changed[0]!
  const previous = before[local.name]
  const reads = line.identifiers
    .filter((name) => name !== local.name && before[name] !== undefined)
    .slice(0, 3)
    .map((name) => `${name} = ${shown(before[name], languageId)}`)
  return `${local.name} = ${shown(local.value, languageId)} (was ${shown(previous, languageId)})${reads.length > 0 ? `, from ${join(reads)}` : ''}`
}

function join(items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function changes(state: StepState, languageId: string) {
  const locals = state.stack.flatMap((frame) =>
    frame.locals
      .filter((local) => state.changed.locals[frame.id]?.includes(local.name) && !local.internal)
      .map(
        (local) =>
          `${local.name} = ${shown(local.value, languageId)} (was ${shown(state.before.scope[local.name], languageId)})`,
      ),
  )
  const names = new Map<string, string>()
  for (const frame of state.stack) {
    for (const local of frame.locals) {
      if (local.value.t === 'ref' && local.value.id !== undefined && !local.internal) {
        names.set(local.value.id, local.name)
      }
    }
  }
  const cells = Object.entries(state.changed.cells).flatMap(([id, keys]) => {
    const object = state.heap[id]
    const name = names.get(id) ?? `#${id}`
    if (object?.kind !== 'sequence') return [`${name} changed`]
    return keys.map((key) => {
      const now = cellValue(object, Number(key))
      const old = state.before.cells[id]?.[key]
      return `${name}[${key}] = ${shown(now, languageId, true)} (was ${shown(old, languageId, true)})`
    })
  })
  const all = [...locals, ...cells]
  const count = all.length
  if (count === 0) return null
  return `${all.slice(0, 3).join(' · ')}${count > 3 ? ` · +${count - 3} more` : ''}`
}

function within(line: number, [start, end]: [number, number]) {
  return line >= start && line <= end
}

function branch(state: StepState, facts: SourceFacts | null) {
  if (state.prevLine === null || state.event !== 'line') return null
  const fact = lineFacts(facts, state.prevLine)
  if (fact.branch == null) return null
  if (fact.branch.body[0] === state.prevLine) return null
  const result = within(state.line, fact.branch.body) ? 'true' : 'false'
  const alternative = fact.branch.otherwise
  const suffix =
    result === 'false' && alternative !== null && within(state.line, alternative) ? ' → else' : ''
  return `Condition on line ${state.prevLine} was ${result}${suffix}`
}

function narrated(
  state: StepState,
  input: InputStep,
  total: number,
  facts: SourceFacts | null,
  languageId: string,
  passes: Map<string, number>,
  hasInput: boolean,
) {
  if (state.error) {
    const message = friendly(state.error)
    return message ? `${message.title}: ${plain(message.message)}` : rawTitle(state.error)
  }
  const frame = state.stack.at(-1)
  if (state.event === 'call' && frame) {
    const args = frame.locals
      .filter((local) => !local.internal && local.value.t !== 'uninit')
      .map((local) => `${local.name} = ${valueText(local.value)}`)
    return `Call ${frame.name}(${args.join(', ')})`
  }
  if (state.event === 'return' && frame) {
    return `${frame.name} returns ${frame.returnValue === null ? '·' : valueText(frame.returnValue)}`
  }
  if (hasInput && (input.token > input.from || input.bytes > input.fromBytes)) {
    if (input.token === input.from) {
      return `Read a line from input${input.inferred ? ' (inferred)' : ''}`
    }
    const read =
      input.read.length > 3
        ? `${input.read.length} tokens`
        : input.read.length > 0
          ? join(input.read)
          : 'a line'
    const range =
      input.token - input.from === 1
        ? `token ${input.token}`
        : `tokens ${input.from + 1}–${input.token}`
    return `Read ${read} from input (${range} of ${total})${input.inferred ? ' (inferred)' : ''}`
  }
  const printed = state.output
    .filter((segment) => segment.current)
    .map((segment) => segment.text)
    .join('')
  if (printed !== '') return `Printed ${JSON.stringify(printed)}`
  const set = assignment(state, facts, languageId)
  if (set !== null) return set
  const other = changes(state, languageId)
  if (other !== null) return other
  if (state.prevLine !== null) {
    const fact = lineFacts(facts, state.prevLine)
    const pass = passes.get(`${frame?.id}:${state.prevLine}`) ?? 0
    if ((fact.header === 'for' || fact.header === 'while') && pass > 1) {
      return `Loop at line ${state.prevLine}: pass ${pass}`
    }
  }
  return branch(state, facts) ?? `Line ${state.prevLine ?? state.line} ran`
}

export async function narrate(
  steps: Step[],
  stdin: string,
  facts: SourceFacts | null,
  languageId: string,
): Promise<NarratedTrace> {
  const engine = createEngine(steps)
  const input = inputSteps(steps, stdin, facts, languageId)
  const total = tokens(stdin).length
  const passes = new Map<string, number>()
  const narrations: string[] = []
  for (const [index, step] of steps.entries()) {
    const state = engine.state(index)
    if (step.prevLine !== null) {
      const key = `${state.stack.at(-1)?.id}:${step.prevLine}`
      passes.set(key, (passes.get(key) ?? 0) + 1)
    }
    narrations.push(narrated(state, input[index]!, total, facts, languageId, passes, stdin !== ''))
    if (index % 16 === 15) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  const inputReads =
    stdin === ''
      ? []
      : input.flatMap((position, index) =>
          position.token > position.from || position.bytes > position.fromBytes ? [index] : [],
        )
  return { narrations, input, inputReads }
}
