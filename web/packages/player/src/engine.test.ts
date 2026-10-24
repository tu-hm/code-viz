// @vitest-environment node
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { describe, expect, test } from 'vitest'
import { createEngine } from './engine.ts'
import type { Frame, HeapObject, Step } from './gen/trace.ts'
import { createLru } from './lru.ts'

function replay(steps: Step[]) {
  const frames = new Map<string, Frame>()
  const heap = new Map<string, HeapObject>()
  return steps.map((step) => {
    if (step.keyframe) {
      frames.clear()
      heap.clear()
    }
    for (const id of step.removedObjects) heap.delete(id)
    for (const [id, f] of Object.entries(step.frames)) frames.set(id, f)
    for (const [id, o] of Object.entries(step.heap)) {
      const before = heap.get(id)
      if (!o.patch) {
        heap.set(id, o)
        continue
      }
      const items = { ...before!.sparse!.items }
      for (const [k, v] of Object.entries(o.patch)) {
        if (JSON.stringify(v) === JSON.stringify(before!.sparse!.default)) delete items[k]
        else items[k] = v
      }
      heap.set(id, { ...before!, sparse: { ...before!.sparse!, items } })
    }
    return { stack: step.stack.map((id) => frames.get(id)!), heap: Object.fromEntries(heap) }
  })
}

function shuffled(n: number, seed: number) {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    const j = seed % (i + 1)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

describe.each(fixtureNames)('%s', (name) => {
  const steps = loadFixture(name).chunks.flat()

  test('random access equals sequential replay', { timeout: 30_000 }, () => {
    const want = replay(steps)
    const sequential = createEngine(steps)
    const random = createEngine(steps)
    const forward = steps.map((_, k) => sequential.state(k))
    for (const k of shuffled(steps.length, 7)) {
      const got = random.state(k)
      expect({ stack: got.stack, heap: got.heap }, `step ${k}`).toStrictEqual(want[k])
      expect(got, `step ${k}`).toStrictEqual(forward[k])
    }
  })

  test('output up to a step is every earlier print, with this step marked current', () => {
    const engine = createEngine(steps)
    for (const step of steps) {
      const { output } = engine.state(step.i)
      const printed = steps.slice(0, step.i + 1).map((s) => s.stdout + s.stderr)
      expect(output.map((s) => s.text).join('')).toBe(printed.join(''))
      expect(output.filter((s) => s.current).map((s) => s.text)).toEqual(
        [step.stdout, step.stderr].filter((t) => t !== ''),
      )
    }
  })

  test('new objects are the ones the previous step did not have', () => {
    const want = replay(steps)
    const engine = createEngine(steps)
    for (let k = 1; k < steps.length; k++) {
      const added = Object.keys(want[k]!.heap).filter((id) => !(id in want[k - 1]!.heap))
      expect(engine.state(k).newObjects, `step ${k}`).toEqual(added)
    }
  })
})

describe('changed values', () => {
  const steps = loadFixture('python-aliasing').chunks.flat()
  const engine = createEngine(steps)

  test('a call step marks every argument of the new frame', () => {
    const call = steps.find((s) => s.i > 0 && s.event === 'call')!
    const { stack, changed } = engine.state(call.i)
    const frame = stack.at(-1)!
    expect(changed.locals[frame.id]).toEqual(frame.locals.map((l) => l.name))
  })

  test('a step that changes nothing marks nothing', () => {
    expect(engine.state(0).changed).toEqual({ locals: {}, cells: {} })
  })

  test('only the locals whose value differs are marked', () => {
    for (let k = 1; k < steps.length; k++) {
      const prev = engine.state(k - 1)
      const { stack, changed } = engine.state(k)
      for (const frame of stack) {
        const before = prev.stack.find((f) => f.id === frame.id)
        if (!before) continue
        const differ = frame.locals
          .filter(
            (l) =>
              JSON.stringify(before.locals.find((b) => b.name === l.name)?.value) !==
              JSON.stringify(l.value),
          )
          .map((l) => l.name)
        expect(changed.locals[frame.id] ?? [], `step ${k} ${frame.id}`).toEqual(differ)
      }
    }
  })
})

describe('changed cells', () => {
  const int = (v: number) => ({ t: 'int', v: String(v) })
  const step = (i: number, heap: Record<string, HeapObject>, keyframe = i === 0): Step => ({
    i,
    event: 'line',
    prevLine: i === 0 ? null : 1,
    line: 1,
    keyframe,
    stack: ['f0'],
    frames: keyframe
      ? {
          f0: {
            id: 'f0',
            name: 'main',
            kind: 'function',
            line: 1,
            locals: [{ name: 'a', value: { t: 'ref', id: 'o1' } }],
            returnValue: null,
          },
        }
      : {},
    heap,
    removedObjects: [],
    stdout: '',
    stderr: '',
    error: null,
  })

  test.each([
    {
      name: 'a sequence reports the index that changed, offset by its window',
      before: { kind: 'sequence', items: [int(1), int(2)], window: { start: 10, count: 2 } },
      after: { kind: 'sequence', items: [int(1), int(5)], window: { start: 10, count: 2 } },
      want: ['11'],
    },
    {
      name: 'a sparse patch reports the cells it set and the cells it reset to default',
      before: {
        kind: 'sequence',
        length: 100,
        sparse: { default: int(0), items: { '3': int(1), '7': int(2) } },
      },
      after: { kind: 'sequence', length: 100, patch: { '3': int(0), '50': int(9) } },
      want: ['3', '50'],
    },
    {
      name: 'a record reports the field that changed',
      before: { kind: 'record', fields: [{ name: 'val', value: int(1) }] },
      after: { kind: 'record', fields: [{ name: 'val', value: int(2) }] },
      want: ['val'],
    },
    {
      name: 'a mapping reports the position of a new or changed entry',
      before: { kind: 'mapping', entries: [{ key: int(1), value: int(1) }] },
      after: {
        kind: 'mapping',
        entries: [
          { key: int(0), value: int(0) },
          { key: int(1), value: int(1) },
        ],
      },
      want: ['0'],
    },
    {
      name: 'a set reports the position of an added item',
      before: { kind: 'set', items: [int(1), int(3)] },
      after: { kind: 'set', items: [int(1), int(2), int(3)] },
      want: ['1'],
    },
    {
      name: 'a kind with no cells reports the object with no cell',
      before: { kind: 'opaque', summary: 'a' },
      after: { kind: 'opaque', summary: 'b' },
      want: [],
    },
  ] satisfies { name: string; before: HeapObject; after: HeapObject; want: string[] }[])(
    '$name',
    ({ before, after, want }) => {
      const engine = createEngine([step(0, { o1: before }), step(1, { o1: after })])
      expect(engine.state(1).changed.cells).toEqual({ o1: want })
    },
  )

  test('an unchanged object resent whole by a keyframe is not marked', () => {
    const o1: HeapObject = { kind: 'sequence', items: [int(1)] }
    const engine = createEngine([step(0, { o1 }), step(1, { o1: { ...o1 } }, true)])
    expect(engine.state(1).changed.cells).toEqual({})
  })
})

test('the LRU keeps the most recently used entries', () => {
  const lru = createLru<number, string>(2)
  lru.set(1, 'a')
  lru.set(2, 'b')
  lru.get(1)
  lru.set(3, 'c')
  expect([lru.get(1), lru.get(2), lru.get(3), lru.size]).toEqual(['a', undefined, 'c', 2])
})
