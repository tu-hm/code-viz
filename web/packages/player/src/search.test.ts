// @vitest-environment node
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { describe, expect, test } from 'vitest'
import { createEngine, type StepState } from './engine.ts'
import type { HeapObject, Step, Value } from './gen/trace.ts'
import { callSteps, changeHistory, findStep, type Jump, type Target } from './search.ts'

function find(name: string, from: number, jump: Jump) {
  const steps = loadFixture(name).chunks.flat()
  return findStep(steps, createEngine(steps).base, from, jump)
}

const target = (name: string, ...indices: number[]): Target => ({ name, indices })

test.each([
  { name: 'step over skips the call a line makes', fixture: 'python-aliasing', from: 7, want: 10 },
  { name: 'step over stays in a call’s own frame', fixture: 'python-aliasing', from: 8, want: 9 },
  {
    name: 'step over from a return lands in the caller',
    fixture: 'python-aliasing',
    from: 9,
    want: 10,
  },
  { name: 'step over skips every nested call', fixture: 'cpp-fib-memo', from: 3, want: 28 },
  {
    name: 'step over finds nothing after the last step',
    fixture: 'cpp-fib-memo',
    from: 31,
    want: null,
  },
])('$name', ({ fixture, from, want }) => {
  expect(find(fixture, from, { kind: 'over' })).toBe(want)
})

test.each([
  { name: 'step out leaves the frame', fixture: 'python-aliasing', from: 8, want: 10 },
  { name: 'step out skips the frame’s own return', fixture: 'cpp-fib-memo', from: 5, want: 25 },
  { name: 'step out of the module finds nothing', fixture: 'python-aliasing', from: 3, want: null },
  { name: 'step out of main finds nothing', fixture: 'cpp-fib-memo', from: 29, want: null },
])('$name', ({ fixture, from, want }) => {
  expect(find(fixture, from, { kind: 'out' })).toBe(want)
})

test.each([
  { name: 'the next pass of a loop header', lines: [8], from: 4, want: 8 },
  { name: 'the pass after that', lines: [8], from: 8, want: 12 },
  { name: 'nothing once the loop has ended', lines: [8], from: 16, want: null },
  { name: 'the first of several breakpoint lines', lines: [11, 13], from: 0, want: 7 },
  { name: 'a breakpoint line not run yet', lines: [11, 13], from: 12, want: 15 },
])('next time a line runs: $name', ({ lines, from, want }) => {
  expect(find('cpp-binary-search', from, { kind: 'line', lines })).toBe(want)
})

test('a return step is not another run of its line', () => {
  expect(find('python-aliasing', 8, { kind: 'line', lines: [2] })).toBeNull()
})

test.each([
  {
    name: 'a variable’s first value',
    fixture: 'cpp-binary-search',
    t: target('mid'),
    from: 0,
    want: 6,
  },
  {
    name: 'a variable, past steps where it is out of scope',
    fixture: 'cpp-binary-search',
    t: target('mid'),
    from: 6,
    want: 10,
  },
  {
    name: 'a variable that never changes again',
    fixture: 'cpp-binary-search',
    t: target('mid'),
    from: 14,
    want: null,
  },
  {
    name: 'one cell, past writes to its neighbours',
    fixture: 'cpp-dp-grid',
    t: target('dp', 2, 3),
    from: 2,
    want: 21,
  },
  { name: 'a row of a 2-D array', fixture: 'cpp-dp-grid', t: target('dp', 2), from: 3, want: 17 },
  {
    name: 'a whole 2-D array, any cell',
    fixture: 'cpp-dp-grid',
    t: target('dp'),
    from: 4,
    want: 7,
  },
  {
    name: 'a list changed through an alias',
    fixture: 'python-aliasing',
    t: target('b'),
    from: 5,
    want: 7,
  },
  {
    name: 'a copy the alias did not touch',
    fixture: 'python-aliasing',
    t: target('c'),
    from: 6,
    want: null,
  },
  {
    name: 'an outer variable seen from inside a call',
    fixture: 'python-aliasing',
    t: target('n'),
    from: 7,
    want: null,
  },
  {
    name: 'the innermost frame’s variable in a recursion',
    fixture: 'cpp-fib-memo',
    t: target('n'),
    from: 1,
    want: 4,
  },
  {
    name: 'a global from inside a call',
    fixture: 'cpp-fib-memo',
    t: target('memo'),
    from: 1,
    want: 17,
  },
  { name: 'a name no frame has', fixture: 'cpp-fib-memo', t: target('nope'), from: 0, want: null },
])('next change of $name', ({ fixture, t, from, want }) => {
  expect(find(fixture, from, { kind: 'change', target: t })).toBe(want)
})

test.each([
  {
    name: 'scalar at the current step is skipped',
    fixture: 'cpp-binary-search',
    t: target('mid'),
    from: 10,
    want: 6,
  },
  {
    name: 'matrix cell skips other cells',
    fixture: 'cpp-dp-grid',
    t: target('dp', 2, 3),
    from: 23,
    want: 21,
  },
  {
    name: 'alias finds the mutation',
    fixture: 'python-aliasing',
    t: target('b'),
    from: 8,
    want: 7,
  },
  {
    name: 'no earlier change',
    fixture: 'cpp-binary-search',
    t: target('mid'),
    from: 6,
    want: null,
  },
])('previous change of $name', ({ fixture, t, from, want }) => {
  expect(find(fixture, from, { kind: 'previousChange', target: t })).toBe(want)
})

test.each([
  { name: 'the first call', fixture: 'cpp-fib-memo', from: 0, want: 1 },
  { name: 'a call after a return', fixture: 'cpp-fib-memo', from: 13, want: 15 },
  { name: 'nothing after the last call', fixture: 'cpp-fib-memo', from: 25, want: null },
  { name: 'a call in Python', fixture: 'python-aliasing', from: 0, want: 8 },
])('next call: $name', ({ fixture, from, want }) => {
  const [name] = Object.keys(callSteps(loadFixture(fixture).chunks.flat()))
  expect(find(fixture, from, { kind: 'call', name: name! })).toBe(want)
})

test.each([
  { name: 'the step that prints', fixture: 'cpp-binary-search', from: 0, want: 18 },
  { name: 'nothing after the last print', fixture: 'cpp-binary-search', from: 18, want: null },
  { name: 'a step that writes only stderr', fixture: 'python-exception', from: 0, want: 8 },
])('next print: $name', ({ fixture, from, want }) => {
  expect(find(fixture, from, { kind: 'print' })).toBe(want)
})

test.each([
  { name: 'the first error step', from: 0, want: 5 },
  { name: 'the error re-raised in the caller', from: 5, want: 7 },
  { name: 'nothing after the last error', from: 7, want: null },
])('error step: $name', ({ from, want }) => {
  expect(find('python-exception', from, { kind: 'error' })).toBe(want)
})

test.each([
  { fixture: 'cpp-fib-memo', want: { fib: [1, 4, 7, 10, 13, 15, 18, 21, 25] } },
  { fixture: 'python-aliasing', want: { square: [8] } },
  { fixture: 'cpp-binary-search', want: {} },
])('$fixture calls $want', ({ fixture, want }) => {
  expect(callSteps(loadFixture(fixture).chunks.flat())).toEqual(want)
})

test.each([
  { name: 'a sparse cell set back to its default', cell: 3, want: 2 },
  { name: 'a sparse cell left at its default', cell: 9, want: null },
])('next change of $name', ({ cell, want }) => {
  const int = (v: number): Value => ({ t: 'int', v: String(v) })
  const step = (i: number, o1: HeapObject): Step => ({
    i,
    event: 'line',
    prevLine: i === 0 ? null : 1,
    line: 1,
    keyframe: i === 0,
    stack: ['f0'],
    frames:
      i === 0
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
    heap: { o1 },
    removedObjects: [],
    stdout: '',
    stderr: '',
    error: null,
  })
  const steps = [
    step(0, { kind: 'sequence', length: 100, sparse: { default: int(0), items: { '3': int(1) } } }),
    step(1, { kind: 'sequence', length: 100, patch: { '5': int(2) } }),
    step(2, { kind: 'sequence', length: 100, patch: { '3': int(0) } }),
  ]
  const jump: Jump = { kind: 'change', target: target('a', cell) }
  expect(findStep(steps, createEngine(steps).base, 0, jump)).toBe(want)
})

function deep(value: Value, heap: Record<string, HeapObject>, seen = new Set<string>()): string {
  if (value.t !== 'ref' || value.id === undefined) return JSON.stringify(value)
  if (seen.has(value.id)) return `#${value.id}`
  seen.add(value.id)
  const o = heap[value.id]
  const children = [...(o?.items ?? []), ...(o?.fields ?? []).map((f) => f.value)]
  return JSON.stringify([value.id, o, children.map((v) => deep(v, heap, seen))])
}

function valueIn(state: StepState, name: string) {
  const frame = state.stack.findLast((f) => f.locals.some((l) => l.name === name))
  return frame?.locals.find((l) => l.name === name)!.value
}

function firstChange(values: (string | undefined)[], from: number) {
  for (let k = from + 1; k < values.length; k++) {
    if (values[k] !== undefined && values[k] !== values[from]) return k
  }
  return null
}

describe.each(fixtureNames)('%s', (name) => {
  const steps = loadFixture(name).chunks.flat()
  const engine = createEngine(steps)
  const states = steps.map((_, k) => engine.state(k))
  const inner = states.flatMap((s) => s.stack.at(-1)?.locals.map((l) => l.name) ?? [])
  const outer = states.at(-1)!.stack[0]!.locals.map((l) => l.name)
  const names = [...new Set([...inner.slice(0, 4), ...outer.slice(0, 6)])]

  test.each(names)(
    'next change of %s matches replaying every step',
    { timeout: 30_000 },
    (variable) => {
      const values = states.map((s) => {
        const v = valueIn(s, variable)
        return v === undefined ? undefined : deep(v, s.heap)
      })
      for (const from of [0, Math.floor(steps.length / 3), Math.floor((2 * steps.length) / 3)]) {
        const jump: Jump = { kind: 'change', target: target(variable) }
        expect(findStep(steps, engine.base, from, jump), `from ${from}`).toBe(
          firstChange(values, from),
        )
      }
    },
  )

  test.each(names)('the change history of %s matches replaying every step', async (variable) => {
    const values = states.map((s) => {
      const v = valueIn(s, variable)
      return v === undefined ? undefined : deep(v, s.heap)
    })
    let last: string | undefined
    const want: number[] = []
    for (const [k, v] of values.entries()) {
      if (v === undefined || v === last) continue
      want.push(k)
      last = v
    }
    expect((await changeHistory(steps, target(variable))).map((c) => c.step)).toEqual(want)
  })
})
