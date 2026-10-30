// @vitest-environment node
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { describe, expect, test } from 'vitest'
import { compareOutput, shownAt, type Print } from './compare.ts'

const print = (i: number, stdout: string, line: number | null = i): Print => ({
  i,
  line,
  stdout,
  stderr: '',
})

test.each([
  {
    name: 'the §19.7 mock: a wrong digit on line 2',
    expected: '1 2 3\n4 5 6\n',
    prints: [print(100, '1 2 3\n'), print(214, '4 5 7\n', 23)],
    want: {
      kind: 'differ',
      line: 2,
      char: 5,
      expected: '6',
      got: '7',
      from: { step: 214, line: 23, offset: 4 },
    },
  },
  {
    name: 'trailing spaces, CRLF and blank lines at the end are ignored',
    expected: '1 2 3  \r\n4 5 6\r\n\r\n',
    prints: [print(1, '1 2 3\n'), print(2, '4 5 6\n')],
    want: { kind: 'match' },
  },
  {
    name: 'stderr is not compared',
    expected: '6',
    prints: [{ i: 1, line: 1, stdout: '6\n', stderr: 'warning\n' }],
    want: { kind: 'match' },
  },
  {
    name: 'extra output is a difference at its first character',
    expected: '6',
    prints: [print(1, '6\n'), print(2, '7\n')],
    want: {
      kind: 'differ',
      line: 2,
      char: 1,
      expected: null,
      got: '7',
      from: { step: 2, line: 2, offset: 0 },
    },
  },
  {
    name: 'output that ends early counts the missing lines',
    expected: '1\n2\n3\n4\n',
    prints: [print(5, '1\n')],
    want: { kind: 'short', missing: 3, from: { step: 5, line: 5, offset: 0 } },
  },
  {
    name: 'a line cut short is a difference, not missing lines',
    expected: '1 2 3',
    prints: [print(4, '1 2')],
    want: {
      kind: 'differ',
      line: 1,
      char: 4,
      expected: ' ',
      got: null,
      from: { step: 4, line: 4, offset: 2 },
    },
  },
  {
    name: 'nothing printed',
    expected: '6',
    prints: [],
    want: { kind: 'short', missing: 1, from: null },
  },
])('$name', ({ expected, prints, want }) => {
  expect(compareOutput(expected, false, prints, '')).toEqual(want)
})

test.each([
  {
    name: 'exact: trailing spaces count',
    expected: '1 2 3  \n',
    prints: [print(1, '1 2 3\n')],
    want: { kind: 'differ', line: 1, char: 6, expected: ' ', got: '\n' },
  },
  {
    name: 'exact: a missing final line break counts',
    expected: '6\n',
    prints: [print(1, '6')],
    want: { kind: 'differ', line: 1, char: 2, expected: '\n', got: null },
  },
  {
    name: 'exact: CRLF differs from LF',
    expected: '6\r\n',
    prints: [print(1, '6\n')],
    want: { kind: 'differ', line: 1, char: 2, expected: '\r', got: '\n' },
  },
])('$name', ({ expected, prints, want }) => {
  expect(compareOutput(expected, true, prints, '')).toMatchObject(want)
})

test('a difference in the untraced tail has no step', () => {
  const result = compareOutput('1\n2\n3\n', false, [print(7, '1\n')], '2\n9\n')
  expect(result).toEqual({
    kind: 'differ',
    line: 3,
    char: 1,
    expected: '3',
    got: '9',
    from: 'untraced',
  })
})

test('output that ends in the untraced tail ends early with no step', () => {
  const result = compareOutput('1\n2\n3\n', false, [print(7, '1\n')], '2\n')
  expect(result).toEqual({ kind: 'short', missing: 1, from: 'untraced' })
})

test('a step’s output starts after every earlier step’s stdout and stderr', () => {
  const prints = [{ i: 1, line: 1, stdout: 'a\n', stderr: 'E\n' }, print(3, 'bc'), print(9, 'z')]
  expect(shownAt(prints, { step: 3, offset: 1 })).toBe(5)
  expect(shownAt(prints, { step: 1, offset: 0 })).toBe(0)
})

describe.each(fixtureNames)('%s', (name) => {
  const prints = loadFixture(name)
    .chunks.flat()
    .filter((s) => s.stdout !== '' || s.stderr !== '')
    .map((s) => ({ i: s.i, line: s.prevLine, stdout: s.stdout, stderr: s.stderr }))
  const stdout = prints.map((p) => p.stdout).join('')

  test('its own output matches', () => {
    expect(compareOutput(stdout, true, prints, '')).toEqual({ kind: 'match' })
  })

  test('a changed character is traced to the step that printed it', () => {
    for (let at = 0; at < Math.min(stdout.length, 200); at++) {
      if (/\s/.test(stdout[at]!)) continue
      const expected = stdout.slice(0, at) + '#' + stdout.slice(at + 1)
      const result = compareOutput(expected, false, prints, '')
      if (result.kind !== 'differ' || result.from === null || result.from === 'untraced') {
        throw new Error(`char ${at}: ${JSON.stringify(result)}`)
      }
      const { step, offset } = result.from
      expect(prints.find((p) => p.i === step)!.stdout[offset], `char ${at}`).toBe(stdout[at])
      expect(result.got).toBe(stdout[at])
    }
  })
})
