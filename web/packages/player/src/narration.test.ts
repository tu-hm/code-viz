// @vitest-environment node
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { expect, test } from 'vitest'
import { narrate } from './narration.ts'
import { parseSource } from './parse.ts'

async function described(name: string) {
  const fixture = loadFixture(name)
  const facts = await parseSource(fixture.source, fixture.header.language.id)
  return narrate(fixture.chunks.flat(), fixture.stdin, facts, fixture.header.language.id)
}

test.each(fixtureNames)('%s gives every step a narration', { timeout: 30_000 }, async (name) => {
  const { narrations } = await described(name)
  expect(narrations).toHaveLength(loadFixture(name).chunks.flat().length)
  expect(narrations.every((line) => line.length > 0)).toBe(true)
})

test('error wins over output and changes', async () => {
  const fixture = loadFixture('python-error-index')
  const steps = fixture.chunks
    .flat()
    .map((step) => (step.i === 9 ? { ...step, stdout: 'noise' } : step))
  const facts = await parseSource(fixture.source, fixture.header.language.id)
  const { narrations } = await narrate(steps, fixture.stdin, facts, fixture.header.language.id)
  expect(narrations[9]).toMatch(/^Index out of range: grid\[r\]\[2\]/)
})

test('call and return use the frame arguments and result', async () => {
  const { narrations } = await described('python-aliasing')
  expect(narrations[8]).toBe('Call square(x = 5)')
  expect(narrations[9]).toBe('square returns 25')
})

test('input wins over assignments and shows the token count', async () => {
  const { narrations, input } = await described('cpp-binary-search')
  expect(narrations[1]).toBe('Read 8 and 13 from input (tokens 1–2 of 10) (inferred)')
  expect(input[1]).toMatchObject({ token: 2, from: 0, inferred: true })
  expect(input[3]).toMatchObject({ token: 10, from: 2, inferred: true })
  expect(input.at(-1)?.token).toBe(10)
})

test('input wins over output from the same step', async () => {
  const fixture = loadFixture('cpp-binary-search')
  const steps = fixture.chunks
    .flat()
    .map((step) => (step.i === 1 ? { ...step, stdout: 'noise' } : step))
  const facts = await parseSource(fixture.source, fixture.header.language.id)
  expect(
    (await narrate(steps, fixture.stdin, facts, fixture.header.language.id)).narrations[1],
  ).toMatch(/^Read 8 and 13/)
})

test('Python input positions are exact', async () => {
  const { narrations, input } = await described('python-aliasing')
  expect(narrations[3]).toBe('Read 5 from input (token 1 of 1)')
  expect(input[3]).toMatchObject({ token: 1, inferred: false })
})

test.each([
  {
    name: 'scanf counts conversions',
    source: 'int main() {\nscanf("%d %d", &a, &b);\n}',
    stdin: '7 8\n',
    want: 'Read 7 and 8 from input (tokens 1–2 of 2) (inferred)',
  },
  {
    name: 'getline consumes through the newline',
    source: 'int main() {\ngetline(cin, line);\n}',
    stdin: 'hello world\n',
    want: 'Read hello and world from input (tokens 1–2 of 2) (inferred)',
  },
])('C++ without stdinPos: $name', async ({ source, stdin, want }) => {
  const steps = loadFixture('cpp-binary-search').chunks.flat().slice(0, 2)
  steps[1] = { ...steps[1]!, prevLine: 2, stdinPos: undefined }
  const facts = await parseSource(source, 'cpp17-gcc')
  expect((await narrate(steps, stdin, facts, 'cpp17-gcc')).narrations[1]).toBe(want)
})

test('output wins over other changes', async () => {
  const { narrations } = await described('cpp-binary-search')
  expect(narrations[18]).toBe('Printed "6\\n"')
})

test('a matrix assignment names the old value and inferred reads', async () => {
  const { narrations } = await described('cpp-dp-grid')
  expect(narrations[21]).toBe('dp[2][3] = 10 (was ·), from dp[1][3] = 4 and dp[2][2] = 6')
})

test('a scalar assignment names the old value and inputs', async () => {
  const { narrations } = await described('cpp-binary-search')
  expect(narrations[10]).toBe('mid = 5 (was ·), from l = 4 and r = 7')
})

test('a list mutation names the changed cell through its alias', async () => {
  const { narrations } = await described('python-aliasing')
  expect(narrations[7]).toBe('b[3] = 5 (was ·)')
})

test('a loop re-entry and a branch name the control flow', async () => {
  const { narrations } = await described('cpp-binary-search')
  expect(narrations[9]).toBe('Loop at line 8: pass 2')
  expect(narrations[7]).toBe('Condition on line 10 was false → else')
  expect(narrations[15]).toBe('Condition on line 10 was true')
})

test('four changes show three and a count', async () => {
  const fixture = loadFixture('cpp-binary-search')
  const steps = fixture.chunks.flat().map((step) => {
    if (step.i !== 4) return step
    const frame = step.frames.f0!
    return {
      ...step,
      frames: {
        f0: {
          ...frame,
          locals: [...frame.locals, { name: 'q', value: { t: 'int' as const, v: '1' } }],
        },
      },
    }
  })
  const facts = await parseSource(fixture.source, fixture.header.language.id)
  expect(
    (await narrate(steps, fixture.stdin, facts, fixture.header.language.id)).narrations[4],
  ).toBe('l = 0 (was ·) · r = 7 (was ·) · ans = -1 (was ·) · +1 more')
})

test('nothing else uses the line fallback', async () => {
  const { narrations } = await described('python-aliasing')
  expect(narrations[0]).toBe('Call <module>()')
  expect(narrations[1]).toBe('Line 1 ran')
})
