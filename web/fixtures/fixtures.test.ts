import { readFileSync } from 'node:fs'
import type { Frame, HeapObject, Value } from '@viz/player'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, test } from 'vitest'
import { chunkSize } from './encode.ts'
import { fixtureNames, loadFixture } from './index.ts'

const schema = JSON.parse(
  readFileSync(new URL('../../backend/schema/trace.v1.schema.json', import.meta.url), 'utf8'),
) as object
const validate = new Ajv2020({ allErrors: true }).compile(schema)

function targets(values: (Value | null | undefined)[]) {
  return values.flatMap((v) =>
    v?.t === 'ref' ? [v.id!] : v?.t === 'ptr' && v.target ? [v.target] : [],
  )
}

function children(o: HeapObject) {
  return targets([
    ...(o.items ?? []),
    ...(o.entries ?? []).flatMap((e) => [e.key, e.value]),
    ...(o.fields ?? []).map((f) => f.value),
    ...Object.values(o.sparse?.items ?? {}),
  ])
}

function reachable(stack: Frame[], heap: Map<string, HeapObject>) {
  const seen = new Set<string>()
  const todo = targets(stack.flatMap((f) => [...f.locals.map((l) => l.value), f.returnValue]))
  for (let id = todo.pop(); id !== undefined; id = todo.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    const o = heap.get(id)
    if (!o) throw new Error(`reference to ${id}, which is not in the heap`)
    todo.push(...children(o))
  }
  return seen
}

function patched(before: HeapObject, delta: HeapObject): HeapObject {
  if (!before.sparse) throw new Error('patch on a sequence that is not sparse')
  const items = { ...before.sparse.items }
  for (const [k, v] of Object.entries(delta.patch!)) {
    if (JSON.stringify(v) === JSON.stringify(before.sparse.default)) delete items[k]
    else items[k] = v
  }
  return { ...before, sparse: { ...before.sparse, items } }
}

describe.each(fixtureNames)('%s', (name) => {
  const { header, chunks } = loadFixture(name)
  const steps = chunks.flat()

  test('matches trace.v1.schema.json', () => {
    const ok = validate({ ...header, steps })
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
  })

  test('chunks hold 250 steps and start with a keyframe', () => {
    expect(header.summary.stepCount).toBe(steps.length)
    chunks.forEach((chunk, k) => {
      expect(chunk[0]?.i).toBe(k * chunkSize)
      expect(chunk[0]?.keyframe).toBe(true)
      if (k < chunks.length - 1) expect(chunk).toHaveLength(chunkSize)
    })
    steps.forEach((step, i) => {
      expect(step.i).toBe(i)
      expect(step.keyframe).toBe(i % header.encoding.keyframeInterval === 0)
    })
  })

  test('lines stay inside the source and calls carry a call id', () => {
    const inside = (line: number | null) =>
      line === null || (line >= 1 && line <= header.source.lineCount)
    for (const step of steps) {
      expect(inside(step.line) && inside(step.prevLine)).toBe(true)
      if (step.event === 'call' || step.event === 'return') expect(step.callId).toBeTypeOf('number')
    }
  })

  test('replayed heap is exactly what the stack reaches', () => {
    const frames = new Map<string, Frame>()
    const heap = new Map<string, HeapObject>()
    for (const step of steps) {
      if (step.keyframe) {
        frames.clear()
        heap.clear()
      }
      for (const id of step.removedObjects) {
        expect(heap.has(id), `step ${step.i} removes unknown ${id}`).toBe(true)
        heap.delete(id)
      }
      for (const [id, f] of Object.entries(step.frames)) frames.set(id, f)
      for (const [id, o] of Object.entries(step.heap))
        heap.set(id, o.patch ? patched(heap.get(id)!, o) : o)

      const stack = step.stack.map((id) => {
        const f = frames.get(id)
        if (!f) throw new Error(`step ${step.i}: frame ${id} is on the stack but was never sent`)
        return f
      })
      expect([...reachable(stack, heap)].sort(), `step ${step.i}`).toEqual([...heap.keys()].sort())
    }
  })
})
