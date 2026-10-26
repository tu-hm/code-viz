// @vitest-environment node
import { expect, test } from 'vitest'
import { holds, parseCondition, type Scope } from './condition.ts'
import type { Value } from './gen/trace.ts'

const values: Record<string, Value> = {
  i: { t: 'int', v: '3' },
  j: { t: 'int', v: '0' },
  big: { t: 'int', v: '9007199254740993' },
  f: { t: 'float', v: '1.5' },
  c: { t: 'char', v: 'a', code: 97 },
  flag: { t: 'bool', v: 'true' },
  dp: { t: 'ref', id: 'o1' },
}
const rows: Record<string, Value[]> = {
  o1: [
    { t: 'ref', id: 'o2' },
    { t: 'ref', id: 'o3' },
  ],
  o2: [{ t: 'int', v: '1' }],
  o3: [{ t: 'int', v: '120' }],
}
const scope: Scope = {
  name: (name) => values[name],
  index: (value, index) => (value.id === undefined ? undefined : rows[value.id]?.[index]),
}

function check(text: string) {
  const parsed = parseCondition(text)
  if ('error' in parsed) throw new Error(parsed.error)
  return holds(parsed.expr, scope)
}

test.each([
  { name: 'equality', text: 'i == 3', want: true },
  { name: 'multiplication binds tighter', text: '1 + 2 * 3 == 7', want: true },
  { name: 'parentheses', text: '(1 + 2) * 3 == 9', want: true },
  { name: 'not and and', text: '!(i < 3) && j != 0', want: false },
  { name: 'or', text: 'i > 5 || j == 0', want: true },
  { name: 'Python words', text: 'i > 1 and not j', want: true },
  { name: 'integer division truncates', text: '-7 / 2 == -3', want: true },
  { name: 'floor division floors', text: '-7 // 2 == -4', want: true },
  { name: 'remainder', text: 'i % 2 == 1', want: true },
  { name: '64-bit ints stay exact', text: 'big == 9007199254740993', want: true },
  { name: 'and off by one is not equal', text: 'big == 9007199254740992', want: false },
  { name: 'a float compares with an int', text: 'f > 1 && f < 2', want: true },
  { name: 'a char is its code', text: 'c == 97', want: true },
  { name: 'a bool is 1 or 0', text: 'flag == 1 && True', want: true },
  { name: 'a hex literal', text: '0x10 == 16', want: true },
  { name: 'a cell of a 2-d array', text: 'dp[1][0] > 100', want: true },
  { name: 'a subscript from a variable', text: 'dp[i - 2][j] == 120', want: true },
  { name: 'a name out of scope is false', text: 'k == 0', want: false },
  { name: 'an index past the end is false', text: 'dp[5][0] == 0', want: false },
  { name: 'division by zero is false', text: 'i / j == 1', want: false },
  { name: 'an array is not a number', text: 'dp == 1', want: false },
])('$name: $text', ({ text, want }) => {
  expect(check(text)).toBe(want)
})

test.each([
  { text: '', error: 'enter a condition such as i == 5' },
  { text: 'i ==', error: 'expected a value at the end' },
  { text: 'i 5', error: 'expected an operator before “5”' },
  { text: 'a[i', error: 'expected “]” at the end' },
  { text: '(i + 1', error: 'expected “)” at the end' },
  { text: 'i # 2', error: "can't read “#” at character 3" },
  { text: 'i = 5', error: 'use == to compare, not = (character 3)' },
])('“$text” is an error: $error', ({ text, error }) => {
  expect(parseCondition(text)).toEqual({ error })
})
