import type { Frame, HeapObject, Step, Value } from './gen/trace.ts'
import { isRecord } from './is-record.ts'
import { createLru } from './lru.ts'

export type OutputSegment = { stream: 'stdout' | 'stderr'; text: string; current: boolean }

export type StepState = Pick<
  Step,
  'i' | 'event' | 'prevLine' | 'line' | 'error' | 'access' | 'stdinPos' | 'callId' | 'parentCallId'
> & {
  stack: Frame[]
  heap: Record<string, HeapObject>
  changed: {
    locals: Record<string, string[]>
    // sequence: absolute index; set, mapping: position in items or entries; record: field name; sparse: cell index
    cells: Record<string, string[]>
  }
  newObjects: string[]
  output: OutputSegment[]
}

type Base = { frames: Map<string, Frame>; heap: Map<string, HeapObject> }

const cacheSize = 200 // §9.6

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => same(x, b[i]))
    )
  }
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && same(a[k], b[k]))
}

function patched(before: HeapObject | undefined, patch: Record<string, Value>, at: string) {
  if (!before?.sparse) throw new Error(`${at}: patch for an object with no sparse items`)
  const items = { ...before.sparse.items }
  for (const [k, v] of Object.entries(patch)) {
    if (same(v, before.sparse.default)) delete items[k]
    else items[k] = v
  }
  return { ...before, sparse: { ...before.sparse, items } }
}

function apply(base: Base, step: Step) {
  for (const id of step.removedObjects) base.heap.delete(id)
  for (const [id, frame] of Object.entries(step.frames)) base.frames.set(id, frame)
  for (const [id, o] of Object.entries(step.heap)) {
    base.heap.set(id, o.patch ? patched(base.heap.get(id), o.patch, `step ${step.i}, ${id}`) : o)
  }
}

function changedKeys(before: Map<string, Value>, after: Map<string, Value>) {
  return [...after.keys()].filter((k) => !same(before.get(k), after.get(k)))
}

function sequenceCells(o: HeapObject) {
  const start = o.window?.start ?? 0
  return new Map((o.items ?? []).map((v, i) => [String(start + i), v]))
}

function fieldCells(o: HeapObject) {
  return new Map((o.fields ?? []).map((f) => [f.name, f.value]))
}

function changedCells(before: HeapObject, after: HeapObject): string[] {
  if (before.kind !== after.kind) return []
  if (before.sparse && after.sparse) {
    const was = before.sparse.items
    const now = after.sparse.items
    return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
      (k) => !same(was[k], now[k]),
    )
  }
  switch (after.kind) {
    case 'sequence':
      return changedKeys(sequenceCells(before), sequenceCells(after))
    case 'set': {
      const had = new Set((before.items ?? []).map((v) => JSON.stringify(v)))
      return (after.items ?? []).flatMap((v, i) => (had.has(JSON.stringify(v)) ? [] : [String(i)]))
    }
    case 'mapping': {
      const had = new Map((before.entries ?? []).map((e) => [JSON.stringify(e.key), e.value]))
      return (after.entries ?? []).flatMap((e, i) =>
        same(had.get(JSON.stringify(e.key)), e.value) ? [] : [String(i)],
      )
    }
    case 'record':
      return changedKeys(fieldCells(before), fieldCells(after))
    default:
      return []
  }
}

function changedLocals(before: Frame | undefined, after: Frame) {
  if (before === after) return []
  const had = new Map((before?.locals ?? []).map((l) => [l.name, l.value]))
  return after.locals.filter((l) => !before || !same(had.get(l.name), l.value)).map((l) => l.name)
}

export function createEngine(steps: Step[]) {
  const bases = createLru<number, Base>(cacheSize)
  const states = createLru<number, StepState>(cacheSize)
  const printed = steps.filter((s) => s.stdout !== '' || s.stderr !== '')

  function base(k: number): Base {
    const hit = bases.get(k)
    if (hit) return hit
    const step = steps[k]!
    const prev = step.keyframe || k === 0 ? undefined : base(k - 1)
    const b = { frames: new Map(prev?.frames), heap: new Map(prev?.heap) }
    apply(b, step)
    bases.set(k, b)
    return b
  }

  function output(k: number) {
    const segments: OutputSegment[] = []
    const push = (stream: OutputSegment['stream'], text: string, current: boolean) => {
      if (text === '') return
      const last = segments.at(-1)
      if (last && last.stream === stream && last.current === current) last.text += text
      else segments.push({ stream, text, current })
    }
    for (const s of printed) {
      if (s.i > k) break
      push('stdout', s.stdout, s.i === k)
      push('stderr', s.stderr, s.i === k)
    }
    return segments
  }

  function state(k: number): StepState {
    const hit = states.get(k)
    if (hit) return hit
    const step = steps[k]!
    const prev = k > 0 ? base(k - 1) : undefined
    const cur = base(k)

    const stack = step.stack.map((id) => {
      const frame = cur.frames.get(id)
      if (!frame) throw new Error(`step ${k}: frame ${id} is on the stack but was never sent`)
      return frame
    })
    const changed: StepState['changed'] = { locals: {}, cells: {} }
    const newObjects: string[] = []
    if (prev) {
      for (const frame of stack) {
        const names = changedLocals(prev.frames.get(frame.id), frame)
        if (names.length > 0) changed.locals[frame.id] = names
      }
      for (const [id, o] of cur.heap) {
        const before = prev.heap.get(id)
        if (!before) newObjects.push(id)
        else if (!same(before, o)) changed.cells[id] = changedCells(before, o)
      }
    }

    const { i, event, prevLine, line, error, access, stdinPos, callId, parentCallId } = step
    const result: StepState = {
      i,
      event,
      prevLine,
      line,
      error,
      access,
      stdinPos,
      callId,
      parentCallId,
      stack,
      heap: Object.fromEntries(cur.heap),
      changed,
      newObjects,
      output: output(k),
    }
    states.set(k, result)
    return result
  }

  return { stepCount: steps.length, state }
}
