// @vitest-environment node
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { describe, expect, test } from 'vitest'
import { callTree, callView, type CallRow, type CallView } from './calls.ts'
import type { Frame, HeapObject, Step, Value } from './gen/trace.ts'

const int = (v: number): Value => ({ t: 'int', v: String(v) })

function text(row: CallRow) {
  if (row.kind === 'more') return `${row.prefix}+${row.count} calls`
  if (row.kind === 'levels') return `${row.prefix}… ${row.count} more levels`
  const { node, status, active, folded } = row
  const args = node.args.map((a) => a.value.v ?? a.value.id).join(', ')
  const end = {
    running: ' …',
    returned: node.value === null ? ' ✓' : ` → ${node.value.v}`,
    raised: ' ✕',
    left: ' (no return)',
  }[status]
  return [
    `${row.prefix}${node.name}(${args})${end}`,
    node.repeated ? ' ↺' : '',
    active ? ' ▶' : '',
    folded > 0 ? ` (${folded} hidden)` : '',
  ].join('')
}

function viewAt(steps: Step[], k: number, options: Partial<Parameters<typeof callView>[3]> = {}) {
  return callView(callTree(steps), k, steps[k]!.stack.at(-1), {
    collapseRepeated: false,
    expanded: new Set(),
    ...options,
  })
}

const rows = (view: CallView) => view.rows.map(text)

type Op =
  | { call: string; args: Value[] }
  | { ret: Value | null }
  | { line: true }
  | { raise: true }
  | { heap: Record<string, HeapObject> }

function steps(ops: Op[]): Step[] {
  const stack: { frame: Frame; callId: number }[] = []
  let heap: Record<string, HeapObject> = {}
  let next = 0
  return ops
    .flatMap((op, i): Step[] => {
      if ('heap' in op) {
        heap = op.heap
        return []
      }
      const base = {
        prevLine: null,
        line: 1,
        keyframe: false,
        heap,
        removedObjects: [],
        stdout: '',
        stderr: '',
        error: null,
      }
      heap = {}
      if ('call' in op) {
        const id = next++
        const frame: Frame = {
          id: `f${id}`,
          name: op.call,
          kind: 'function',
          line: 1,
          locals: op.args.map((value, k) => ({ name: `a${k}`, value })),
          returnValue: null,
        }
        const parent = stack.at(-1)?.callId
        stack.push({ frame, callId: id })
        return [
          {
            ...base,
            i,
            event: 'call',
            stack: stack.map((s) => s.frame.id),
            frames: { [frame.id]: frame },
            callId: id,
            parentCallId: parent,
          },
        ]
      }
      const top = stack.at(-1)!
      const at = stack.map((s) => s.frame.id)
      if ('line' in op) return [{ ...base, i, event: 'line', stack: at, frames: {} }]
      if ('raise' in op) return [{ ...base, i, event: 'exception', stack: at, frames: {} }]
      stack.pop()
      const frame = { ...top.frame, returnValue: op.ret }
      return [
        {
          ...base,
          i,
          event: 'return',
          stack: at,
          frames: { [frame.id]: frame },
          callId: top.callId,
        },
      ]
    })
    .map((s, i) => ({ ...s, i, keyframe: i === 0 }))
}

describe('§19.4.4 call tree', () => {
  test('cpp-fib-memo step 26 matches the mock: repeated calls, the active one, the footer', () => {
    const fib = loadFixture('cpp-fib-memo').chunks.flat()
    const view = viewAt(fib, 25)
    expect(rows(view)).toEqual([
      'fib(5) …',
      '├─ fib(4) → 3',
      '│  ├─ fib(3) → 2',
      '│  │  ├─ fib(2) → 1',
      '│  │  │  ├─ fib(1) → 1',
      '│  │  │  └─ fib(0) → 0',
      '│  │  └─ fib(1) → 1 ↺',
      '│  └─ fib(2) → 1 ↺',
      '└─ fib(3) … ↺ ▶',
    ])
    expect([view.depth, view.maxDepth, view.calls]).toEqual([2, 5, 9])
  })

  test('a call shows its return value from the return step on, not before', () => {
    const fib = loadFixture('cpp-fib-memo').chunks.flat()
    expect(rows(viewAt(fib, 13)).at(-1)).toBe('         └─ fib(1) … ▶')
    expect(rows(viewAt(fib, 14)).at(-1)).toBe('         └─ fib(1) → 1 ▶')
  })

  test('the entry call is the root the tree hangs from, not a node', () => {
    const fib = loadFixture('cpp-fib-memo').chunks.flat()
    const view = viewAt(fib, 0)
    expect(view.rows).toEqual([])
    expect([view.depth, view.maxDepth, view.calls]).toEqual([0, 0, 0])
    expect(viewAt(fib, 31).active).toBeNull()
  })

  test.each(fixtureNames)(
    '%s: every call and return pairs up in one tree',
    { timeout: 30_000 },
    (name) => {
      const all = loadFixture(name).chunks.flat()
      const tree = callTree(all)
      expect(tree.filter((n) => n.depth === 0).length).toBeLessThanOrEqual(1)
      for (const node of tree) {
        if (node.ret !== null) expect(all[node.ret]!.callId).toBe(node.id)
        expect(all[node.call]!.callId).toBe(node.id)
      }
    },
  )

  test('more than 8 siblings fold into "+N calls", but the active one stays', () => {
    const ops: Op[] = [{ call: 'main', args: [] }]
    for (let k = 0; k < 11; k++) ops.push({ call: 'dfs', args: [int(k)] }, { ret: null })
    ops.push({ call: 'dfs', args: [int(11)] }, { line: true })
    const view = viewAt(steps(ops), ops.length - 1)
    expect(rows(view)).toEqual([
      ...Array.from({ length: 8 }, (_, k) => `dfs(${k}) ✓`),
      '+3 calls',
      'dfs(11) … ▶',
    ])
    expect(rows(viewAt(steps(ops), ops.length - 1, { expanded: new Set([-1]) }))).toHaveLength(12)
  })

  test('more than 50 levels show the first and last 10 around "more levels"', () => {
    const ops: Op[] = [{ call: 'main', args: [] }]
    for (let k = 1; k <= 60; k++) ops.push({ call: 'go', args: [int(k)] })
    const view = viewAt(steps(ops), ops.length - 1)
    const lines = rows(view)
    expect(lines).toHaveLength(21)
    expect(lines[9]).toMatch(/└─ go\(10\) …$/)
    expect(lines[10]).toMatch(/└─ … 40 more levels$/)
    expect(lines[11]).toMatch(/└─ go\(51\) …$/)
    expect(lines.at(-1)).toMatch(/└─ go\(60\) … ▶$/)
    expect([view.depth, view.maxDepth, view.calls]).toEqual([60, 60, 60])
  })

  test('50 levels are drawn whole', () => {
    const ops: Op[] = [{ call: 'main', args: [] }]
    for (let k = 1; k <= 50; k++) ops.push({ call: 'go', args: [int(k)] })
    expect(rows(viewAt(steps(ops), ops.length - 1))).toHaveLength(50)
  })

  test('collapse repeated calls hides their subtrees, except the active path', () => {
    const fib = loadFixture('cpp-fib-memo').chunks.flat()
    const plain = loadFixture('cpp-fib-memo').chunks.flat()
    const view = viewAt(fib, 25, { collapseRepeated: true })
    expect(rows(view)).toEqual(rows(viewAt(plain, 25)))
    const ops: Op[] = [
      { call: 'main', args: [] },
      { call: 'f', args: [int(2)] },
      { call: 'f', args: [int(1)] },
      { ret: int(1) },
      { ret: int(1) },
      { call: 'f', args: [int(2)] },
      { call: 'f', args: [int(1)] },
      { ret: int(1) },
      { ret: int(1) },
      { line: true },
    ]
    expect(rows(viewAt(steps(ops), ops.length - 1, { collapseRepeated: true }))).toEqual([
      'f(2) → 1',
      '└─ f(1) → 1',
      'f(2) → 1 ↺ (1 hidden)',
    ])
  })

  test('a call whose referenced object changed in between is not a repeat', () => {
    const list = (...items: number[]): HeapObject => ({
      kind: 'sequence',
      type: 'list',
      length: items.length,
      items: items.map(int),
    })
    const ref: Value = { t: 'ref', id: 'o1' }
    const ops: Op[] = [
      { call: 'main', args: [] },
      { heap: { o1: list(1) } },
      { call: 'f', args: [ref] },
      { ret: null },
      { call: 'f', args: [ref] },
      { ret: null },
      { heap: { o1: list(1, 2) } },
      { call: 'f', args: [ref] },
      { ret: null },
    ]
    const all = steps(ops)
    expect(callTree(all).map((n) => n.repeated)).toEqual([false, false, true, false])
  })

  test('a call left by an exception reads raised; one the run died in stays running', () => {
    const ops: Op[] = [
      { call: 'main', args: [] },
      { call: 'f', args: [int(1)] },
      { raise: true },
      { ret: null },
      { call: 'g', args: [int(2)] },
      { line: true },
    ]
    expect(rows(viewAt(steps(ops), 5))).toEqual(['f(1) ✕', 'g(2) … ▶'])
  })
})
