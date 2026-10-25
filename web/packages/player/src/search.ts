import { apply, same, type Base } from './engine.ts'
import type { HeapObject, Step, Value } from './gen/trace.ts'

export type Target = { name: string; indices: number[] }

export function targetText({ name, indices }: Target) {
  return `${name}${indices.map((i) => `[${i}]`).join('')}`
}

// before: the last value it had, null for its first one
export type Change = { step: number; before: Value | null; value: Value }

export type Jump =
  | { kind: 'over' }
  | { kind: 'out' }
  | { kind: 'line'; lines: number[] }
  | { kind: 'change'; target: Target }
  | { kind: 'previousChange'; target: Target }
  | { kind: 'call'; name: string }
  | { kind: 'print' }
  | { kind: 'error' }

type Seen = { value: Value; objects: Map<string, HeapObject> }

function firstAfter(steps: Step[], from: number, match: (step: Step) => boolean) {
  for (let k = from + 1; k < steps.length; k++) if (match(steps[k]!)) return k
  return null
}

function callee(step: Step) {
  const id = step.stack.at(-1)
  return id === undefined ? undefined : step.frames[id]?.name
}

export function callSteps(steps: Step[]) {
  const calls: Record<string, number[]> = {}
  for (let k = 1; k < steps.length; k++) {
    const name = steps[k]!.event === 'call' ? callee(steps[k]!) : undefined
    if (name !== undefined) (calls[name] ??= []).push(k)
  }
  return calls
}

function lookup(stack: string[], base: Base, name: string) {
  for (let d = stack.length - 1; d >= 0; d--) {
    const local = base.frames.get(stack[d]!)!.locals.find((l) => l.name === name)
    if (local) return local.value
  }
  return undefined
}

function cell(o: HeapObject, index: number) {
  if (o.kind !== 'sequence') return undefined
  const start = o.window?.start ?? 0
  if (o.window && (index < start || index >= start + o.window.count)) return undefined
  if (o.sparse === undefined) return o.items?.[index - start]
  return index < (o.length ?? 0) ? (o.sparse.items[index] ?? o.sparse.default) : undefined
}

function resolve(stack: string[], base: Base, target: Target) {
  let value = lookup(stack, base, target.name)
  for (const index of target.indices) {
    if (value?.t !== 'ref' || value.id === undefined) return undefined
    const o = base.heap.get(value.id)
    value = o && cell(o, index)
  }
  return value
}

// refs only: a ptr's value is its address, not what it points at
function reach(value: Value, heap: Map<string, HeapObject>) {
  const objects = new Map<string, HeapObject>()
  const pending = [value]
  for (let v = pending.pop(); v !== undefined; v = pending.pop()) {
    if (v.t !== 'ref' || v.id === undefined || objects.has(v.id)) continue
    const o = heap.get(v.id)
    if (o === undefined) continue
    objects.set(v.id, o)
    for (const item of o.items ?? []) pending.push(item)
    for (const field of o.fields ?? []) pending.push(field.value)
    for (const entry of o.entries ?? []) pending.push(entry.key, entry.value)
  }
  return objects
}

function changed(seen: Seen, value: Value, heap: Map<string, HeapObject>) {
  if (!same(seen.value, value)) return true
  for (const [id, o] of seen.objects) {
    const now = heap.get(id)
    if (now === o) continue
    if (now === undefined || !same(now, o)) return true
    seen.objects.set(id, now)
  }
  return false
}

function findChange(steps: Step[], start: Base, from: number, target: Target) {
  const walk: Base = { frames: new Map(start.frames), heap: new Map(start.heap) }
  const first = resolve(steps[from]!.stack, walk, target)
  const seen = first === undefined ? undefined : { value: first, objects: reach(first, walk.heap) }
  for (let k = from + 1; k < steps.length; k++) {
    apply(walk, steps[k]!)
    const value = resolve(steps[k]!.stack, walk, target)
    if (value === undefined) continue
    if (seen === undefined || changed(seen, value, walk.heap)) return k
  }
  return null
}

const historyBatch = 256 // synthetic-5000: up to 15 ms a walk => ~0.8 ms between step requests

export async function changeHistory(steps: Step[], target: Target) {
  const walk: Base = { frames: new Map(), heap: new Map() }
  const changes: Change[] = []
  let seen: Seen | undefined
  for (let k = 0; k < steps.length; k++) {
    if (k % historyBatch === historyBatch - 1) await new Promise((resolve) => setTimeout(resolve))
    apply(walk, steps[k]!)
    const value = resolve(steps[k]!.stack, walk, target)
    if (value === undefined) continue
    if (seen !== undefined && !changed(seen, value, walk.heap)) continue
    changes.push({ step: k, before: seen?.value ?? null, value })
    seen = { value, objects: reach(value, walk.heap) }
  }
  return changes
}

function findPreviousChange(
  steps: Step[],
  base: (k: number) => Base,
  from: number,
  target: Target,
) {
  for (let k = from - 1; k > 0; k--) {
    const now = base(k)
    const value = resolve(steps[k]!.stack, now, target)
    if (value === undefined) continue
    const previous = base(k - 1)
    const before = resolve(steps[k - 1]!.stack, previous, target)
    if (
      before === undefined ||
      changed({ value: before, objects: reach(before, previous.heap) }, value, now.heap)
    ) {
      return k
    }
  }
  return null
}

export function findStep(steps: Step[], base: (k: number) => Base, from: number, jump: Jump) {
  const { stack } = steps[from]!
  const depth = stack.length
  const frame = stack[depth - 1]
  switch (jump.kind) {
    case 'over':
      return firstAfter(steps, from, (s) => s.stack.length <= depth || s.stack[depth - 1] !== frame)
    case 'out':
      return firstAfter(steps, from, (s) => s.stack[depth - 1] !== frame)
    case 'line':
      return firstAfter(
        steps,
        from,
        (s) => (s.event === 'line' || s.event === 'call') && jump.lines.includes(s.line),
      )
    case 'change':
      return findChange(steps, base(from), from, jump.target)
    case 'previousChange':
      return findPreviousChange(steps, base, from, jump.target)
    case 'call':
      return firstAfter(steps, from, (s) => s.event === 'call' && callee(s) === jump.name)
    case 'print':
      return firstAfter(steps, from, (s) => s.stdout !== '' || s.stderr !== '')
    case 'error':
      return firstAfter(steps, from, (s) => s.error !== null)
  }
}
