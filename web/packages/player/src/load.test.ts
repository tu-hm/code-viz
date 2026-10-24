// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { describe, expect, test } from 'vitest'
import { createEngine } from './engine.ts'
import type { Step } from './gen/trace.ts'
import { isTraceError, kinds, loadTrace } from './load.ts'
import { stepDetail, valueText } from './step-label.ts'

const schema = JSON.parse(
  readFileSync(new URL('../../../../backend/schema/trace.v1.schema.json', import.meta.url), 'utf8'),
) as { $defs: { heapObject: { properties: { kind: { enum: string[] } } } } }

test.each(fixtureNames)('%s loads with every step in order', async (name) => {
  const { header, chunks } = loadFixture(name)
  const trace = await loadTrace({ header, chunks })
  expect(trace.header).toBe(header)
  expect(trace.steps.map((s) => s.i)).toEqual(chunks.flat().map((_, i) => i))
  expect(trace.steps).toHaveLength(header.summary.stepCount)
})

describe('format versions (§9.7)', () => {
  const { header, chunks } = loadFixture('python-aliasing')

  test.each(['1.0', '1.1', '1.27'])('%s loads', async (version) => {
    await expect(loadTrace({ header: { ...header, version }, chunks })).resolves.toBeDefined()
  })

  test.each(['2.0', '10.1', 'v1'])('%s is refused as a VersionError', async (version) => {
    const error: unknown = await loadTrace({ header: { ...header, version }, chunks }).catch(
      (e: unknown) => e,
    )
    expect(isTraceError(error) && error.name).toBe('VersionError')
  })
})

describe('newer minor versions', () => {
  const { header, chunks } = loadFixture('python-aliasing')
  const steps = chunks.flat()

  test('the known kinds are the schema’s', () => {
    expect([...kinds]).toEqual(schema.$defs.heapObject.properties.kind.enum)
  })

  test('an unknown kind becomes an opaque object with its type', async () => {
    const graph = { kind: 'graph', type: 'Graph', nodes: [1, 2] }
    const edited: Step[] = steps.map((s) =>
      s.i === 0 ? { ...s, heap: { ...s.heap, o99: graph } } : s,
    )
    const trace = await loadTrace({ header, chunks: [edited] })
    expect(trace.steps[0]!.heap.o99).toEqual({
      kind: 'opaque',
      type: 'Graph',
      summary: 'graph object',
    })
    expect(steps[0]!.heap.o99).toBeUndefined()
  })

  test('unknown fields change nothing the player shows', async () => {
    const extra = steps.map((s) => ({ ...s, futureField: { x: 1 } }))
    const plain = createEngine((await loadTrace({ header, chunks: [steps] })).steps)
    const withExtra = createEngine((await loadTrace({ header, chunks: [extra] })).steps)
    for (const s of steps) expect(withExtra.state(s.i)).toEqual(plain.state(s.i))
  })

  test('an unknown value type is shown as its plain text', () => {
    expect(valueText({ t: 'complex', v: '(1+2j)' })).toBe('(1+2j)')
    expect(valueText({ t: 'decimal' })).toBe('decimal')
  })
})

test.each([
  { name: 'python-aliasing', step: 8, want: 'call square(x=5)' },
  { name: 'python-aliasing', step: 9, want: 'return 25 from square()' },
  { name: 'python-exception', step: 5, want: 'exception in f()' },
  { name: 'python-exception', step: 7, want: 'exception in <module>' },
  { name: 'cpp-binary-search', step: 10, want: 'line 9 → 10' },
  { name: 'cpp-binary-search', step: 0, want: 'call main()' },
])('$name step $step reads "$want"', ({ name, step, want }) => {
  const engine = createEngine(loadFixture(name).chunks.flat())
  expect(stepDetail(engine.state(step))).toBe(want)
})
