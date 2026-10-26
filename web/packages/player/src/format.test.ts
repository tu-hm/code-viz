// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { formatterFor } from './format.ts'
import type { HeapObject, Value } from './gen/trace.ts'

const cpp = formatterFor('cpp17-gcc')
const python = formatterFor('python3')

type Case = { name: string; value: Value; text: string; detail?: string }

describe('C++', () => {
  test.each<Case>([
    {
      name: 'char as quoted, code on hover',
      value: { t: 'char', v: 'a', code: 97 },
      text: "'a'",
      detail: '97',
    },
    {
      name: 'char newline escaped',
      value: { t: 'char', v: '\n', code: 10 },
      text: "'\\n'",
      detail: '10',
    },
    {
      name: 'char NUL escaped',
      value: { t: 'char', v: '\u0000', code: 0 },
      text: "'\\0'",
      detail: '0',
    },
    {
      name: 'char quote escaped',
      value: { t: 'char', v: "'", code: 39 },
      text: "'\\''",
      detail: '39',
    },
  ])('char: $name', ({ value, text, detail }) => {
    expect(cpp.value(value)).toEqual({ text, detail })
  })

  test.each<Case>([
    { name: 'true', value: { t: 'bool', type: 'bool', v: 'true' }, text: 'true' },
    { name: 'false', value: { t: 'bool', type: 'bool', v: 'false' }, text: 'false' },
  ])('bool: $name', ({ value, text }) => {
    expect(cpp.value(value)).toEqual({ text })
  })

  test('enum: the enumerator name, with no separators', () => {
    expect(cpp.value({ t: 'int', type: 'Color', v: 'BLUE' })).toEqual({ text: 'BLUE' })
  })

  test.each<Case>([
    {
      name: 'long long keeps all 19 digits',
      value: { t: 'int', type: 'long long', v: '-9223372036854775808' },
      text: '-9223372036854775808',
      detail: '-9,223,372,036,854,775,808',
    },
    {
      name: 'unsigned long long past 2^53',
      value: { t: 'int', type: 'unsigned long long', v: '18446744073709551615' },
      text: '18446744073709551615',
      detail: '18,446,744,073,709,551,615',
    },
    { name: 'three digits get no separators', value: { t: 'int', v: '-999' }, text: '-999' },
    { name: 'four digits do', value: { t: 'int', v: '1000' }, text: '1000', detail: '1,000' },
  ])('integers: $name', ({ value, text, detail }) => {
    expect(cpp.value(value)).toEqual(detail === undefined ? { text } : { text, detail })
  })

  test.each<Case>([
    {
      name: 'six significant digits',
      value: { t: 'float', v: '3.14159265358979' },
      text: '3.14159',
      detail: '3.14159265358979',
    },
    { name: 'short value as is', value: { t: 'float', v: '2.5' }, text: '2.5' },
    { name: 'whole number without a point', value: { t: 'float', v: '2' }, text: '2' },
    {
      name: 'large in exponent form',
      value: { t: 'float', v: '123456789' },
      text: '1.23457e+08',
      detail: '123456789',
    },
    {
      name: 'tiny in exponent form',
      value: { t: 'float', type: 'float', v: '1e-44' },
      text: '1e-44',
    },
    {
      name: 'rounds up into the next power',
      value: { t: 'float', v: '999999.5' },
      text: '1e+06',
      detail: '999999.5',
    },
    { name: 'inf stays as GDB wrote it', value: { t: 'float', v: '-inf' }, text: '-inf' },
  ])('floats: $name', ({ value, text, detail }) => {
    expect(cpp.value(value)).toEqual(detail === undefined ? { text } : { text, detail })
  })

  test.each<Case>([
    { name: 'escaped in double quotes', value: { t: 'str', v: 'a"b\n' }, text: '"a\\"b\\n"' },
    {
      name: 'cut, with the real length on hover',
      value: { t: 'str', v: 'zz', len: 1500, truncated: true },
      text: '"zz"…',
      detail: '1,500 characters, the first 2 shown',
    },
  ])('strings: $name', ({ value, text, detail }) => {
    expect(cpp.value(value)).toEqual(detail === undefined ? { text } : { text, detail })
  })

  test('type names drop std::', () => {
    expect(cpp.typeName('std::map<std::string, int>')).toBe('map<string, int>')
  })

  test.each<{ name: string; object: HeapObject; members: string[] | null }>([
    {
      name: 'pair',
      object: {
        kind: 'record',
        type: 'std::pair<int, int>',
        fields: [
          { name: 'first', value: { t: 'int', v: '4' } },
          { name: 'second', value: { t: 'int', v: '2' } },
        ],
      },
      members: ['first', 'second'],
    },
    {
      name: 'tuple',
      object: {
        kind: 'record',
        type: 'std::tuple<int>',
        fields: [{ name: '0', value: { t: 'int', v: '1' } }],
      },
      members: ['0'],
    },
    { name: 'struct', object: { kind: 'record', type: 'Edge', fields: [] }, members: null },
  ])('pair and tuple: $name', ({ object, members }) => {
    expect(cpp.tupleMembers(object)?.map((m) => m.name) ?? null).toEqual(members)
    expect(cpp.tupleText(['4', '2'])).toBe('(4, 2)')
  })
})

describe('Python', () => {
  test.each<Case>([
    { name: 'single quotes by default', value: { t: 'str', v: 'hi' }, text: "'hi'" },
    {
      name: 'double quotes around a single quote',
      value: { t: 'str', v: "it's" },
      text: '"it\'s"',
    },
    { name: 'both quotes: single, escaped', value: { t: 'str', v: 'a\'b"c' }, text: "'a\\'b\"c'" },
    { name: 'NUL as \\x00', value: { t: 'str', v: '\u0000' }, text: "'\\x00'" },
  ])('str repr: $name', ({ value, text }) => {
    expect(python.value(value)).toEqual({ text })
  })

  test('None', () => {
    expect(python.value({ t: 'none' })).toEqual({ text: 'None' })
  })

  test('big ints keep every digit', () => {
    expect(python.value({ t: 'int', v: '1267650600228229401496703205376' })).toEqual({
      text: '1267650600228229401496703205376',
      detail: '1,267,650,600,228,229,401,496,703,205,376',
    })
  })

  test.each<Case>([
    {
      name: 'six significant digits',
      value: { t: 'float', v: '0.30000000000000004' },
      text: '0.3',
      detail: '0.30000000000000004',
    },
    { name: 'a whole float keeps .0', value: { t: 'float', v: '2.0' }, text: '2.0' },
    { name: 'large whole float keeps .0', value: { t: 'float', v: '100000.0' }, text: '100000.0' },
    { name: 'repr exponent form', value: { t: 'float', v: '1e-05' }, text: '1e-05' },
    { name: 'nan as is', value: { t: 'float', v: 'nan' }, text: 'nan' },
  ])('floats: $name', ({ value, text, detail }) => {
    expect(python.value(value)).toEqual(detail === undefined ? { text } : { text, detail })
  })

  test('bool as Python spells it', () => {
    expect(python.value({ t: 'bool', v: 'True' })).toEqual({ text: 'True' })
  })

  test('a tuple is a pair-like row; one member keeps its comma', () => {
    const tuple: HeapObject = {
      kind: 'sequence',
      type: 'tuple',
      length: 1,
      fixed: true,
      items: [{ t: 'int', v: '4' }],
    }
    expect(python.tupleMembers(tuple)).toEqual([{ name: '0', value: { t: 'int', v: '4' } }])
    expect(python.tupleText(['4'])).toBe('(4,)')
    expect(python.tupleMembers({ ...tuple, type: 'list' })).toBeNull()
    expect(python.tupleMembers({ ...tuple, truncated: true })).toBeNull()
  })
})

test('a language with no formatter gets plain values', () => {
  const plain = formatterFor('rust-1.80')
  expect(plain.value({ t: 'str', v: 'a"b' })).toEqual({ text: '"a\\"b"' })
  expect(plain.value({ t: 'decimal', v: '1.50' })).toEqual({ text: '1.50' })
  expect(plain.tupleMembers({ kind: 'record', type: 'std::pair<int, int>', fields: [] })).toBeNull()
})
