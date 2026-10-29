import { describe, expect, test } from 'vitest'
import { friendly, type Part, type StepError } from './friendly.ts'

const text = (parts: Part[]) => parts.map((p) => (typeof p === 'string' ? p : p.code)).join('')

const error = (kind: StepError['kind'], values: StepError['values']): StepError => ({
  type: 'X',
  message: 'raw',
  line: 1,
  kind,
  values,
})

describe('§19.6 message templates fill in what the tracer could read', () => {
  test.each([
    {
      name: 'a C array has no name',
      error: error('index_out_of_range', { index: '5', size: 5, type: 'int [5]' }),
      message: 'Index 5 is out of range for int [5], which has size 5 (valid indices 0–4).',
    },
    {
      name: 'an index Python could not read',
      error: error('index_out_of_range', { name: 'row', size: 3, type: 'list' }),
      message: 'An index out of range was used on row, which has size 3 (valid indices 0–2).',
    },
    {
      name: 'an empty container has no valid index',
      error: error('index_out_of_range', { index: '0', name: 'a', size: 0 }),
      message: 'a[0] was used, but a has size 0 (it is empty).',
    },
    {
      name: '*s.begin() on an empty set',
      error: error('empty_container', { call: 'operator*', name: 's', type: 'std::set<int>' }),
      message: '*s.begin() on an empty set.',
    },
    {
      name: 'a unary overflow',
      error: error('signed_overflow', {
        op: '-',
        operands: ['-9223372036854775808'],
        type: 'long long',
        max: '9223372036854775807',
      }),
      message: '-(-9223372036854775808) does not fit in long long (max 9,223,372,036,854,775,807).',
    },
    {
      name: 'Python’s default recursion limit',
      error: error('recursion_too_deep', { depth: 997, limit: 1000 }),
      message: 'Python stops at 1,000 nested calls by default.',
    },
  ])('$name', ({ error, message }) => {
    expect(text(friendly(error)!.message)).toBe(message)
  })

  test.each([
    { name: 'no kind', kind: undefined },
    { name: 'a kind from a newer tracer', kind: 'use_after_free' as StepError['kind'] },
  ])('$name falls back to the raw message', ({ kind }) => {
    expect(friendly(error(kind, {}))).toBeNull()
  })
})
