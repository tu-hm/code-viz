import { fixtureNames, loadFixture } from '@viz/fixtures'
import { expect, test } from 'vitest'
import { parseSource } from './parse.ts'
import { indexText, lineFacts, type SourceFacts } from './source-facts.ts'

function accesses(facts: SourceFacts | null, line: number) {
  return lineFacts(facts, line).subscripts.map(
    (s) => `${s.mode} ${s.array}${s.indices.map((i) => `[${indexText(i)}]`).join('')}`,
  )
}

test.each(fixtureNames)('%s parses into facts for lines inside the source', async (name) => {
  const { header, source } = loadFixture(name)
  const facts = await parseSource(source, header.language.id)
  const lines = source.split('\n').length
  for (const line of Object.keys(facts ?? {})) expect(Number(line)).toBeLessThanOrEqual(lines)
})

test('the dp grid line writes one cell and reads two', async () => {
  const { source } = loadFixture('cpp-dp-grid')
  const facts = await parseSource(source, 'cpp17-gcc')
  expect(accesses(facts, 11)).toEqual(['w dp[i][j]', 'r dp[i-1][j]', 'r dp[i][j-1]'])
  expect(lineFacts(facts, 10).header).toBe('for')
  expect(lineFacts(facts, 12).subscripts.map((s) => s.indices.map(indexText))).toEqual([
    ['n-1', 'm-1'],
  ])
})

test('a loop header knows the lines its statement spans', async () => {
  const { source } = loadFixture('cpp-dp-grid')
  const facts = await parseSource(source, 'cpp17-gcc')
  expect([9, 10, 11].map((line) => lineFacts(facts, line).loop)).toEqual([[9, 11], [10, 11], null])
  const python = await parseSource(
    'while q:\n    u = q.pop()\n    for v in g[u]:\n        f(v)\nx = 1\n',
    'python3',
  )
  expect([1, 3].map((line) => lineFacts(python, line).loop)).toEqual([
    [1, 4],
    [3, 4],
  ])
  expect(lineFacts(facts, 7).loop).toEqual([7, 7])
})

test('binary search reads a[mid] in an if header and cin fills the input operands', async () => {
  const { source } = loadFixture('cpp-binary-search')
  const facts = await parseSource(source, 'cpp17-gcc')
  expect(accesses(facts, 10)).toEqual(['r a[mid]'])
  expect(lineFacts(facts, 10).header).toBe('if')
  expect(lineFacts(facts, 8).header).toBe('while')
  expect(lineFacts(facts, 4).inputs).toEqual(['n', 'x'])
  expect(lineFacts(facts, 9).identifiers).toEqual(expect.arrayContaining(['mid', 'l', 'r']))
})

test.each([
  { name: 'compound assignment reads and writes', code: 's[i] += 2;', want: ['rw s[i]'] },
  { name: 'increment reads and writes', code: 'cnt[a[i]]++;', want: ['rw cnt[?]', 'r a[i]'] },
  { name: 'cin writes its subscripts', code: 'cin >> n >> a[i + 1];', want: ['w a[i+1]'] },
  { name: 'scanf writes through &', code: 'scanf("%d %lld", &n, &a[i]);', want: ['w a[i]'] },
  { name: 'a constant index', code: 'x = a[3] + b[1 + j];', want: ['r a[3]', 'r b[j+1]'] },
])('C++: $name', async ({ code, want }) => {
  const facts = await parseSource(`int main() {\n${code}\n}`, 'cpp17-gcc')
  expect(accesses(facts, 2).sort()).toEqual(want.sort())
})

test('scanf conversions and cin operands are listed by line', async () => {
  const facts = await parseSource(
    'int main() {\nscanf("%d%% %lld %s", &n, &m, s);\ncin >> a >> b[i];\n}',
    'cpp17-gcc',
  )
  expect(lineFacts(facts, 2).scanf).toEqual(['%d', '%lld', '%s'])
  expect(lineFacts(facts, 3).inputs).toEqual(['a', 'b[i]'])
})

test.each([
  { name: 'assignment', code: 'dp[i][j] = dp[i-1][j] + 1', want: ['w dp[i][j]', 'r dp[i-1][j]'] },
  { name: 'augmented assignment', code: 'a[i] += a[i - 1]', want: ['rw a[i]', 'r a[i-1]'] },
  { name: 'swap', code: 'a[i], a[j] = a[j], a[i]', want: ['w a[i]', 'w a[j]', 'r a[j]', 'r a[i]'] },
  { name: 'a slice is not evaluable', code: 'b = a[l:r]', want: ['r a[?]'] },
])('Python: $name', async ({ code, want }) => {
  const facts = await parseSource(`${code}\n`, 'python3')
  expect(accesses(facts, 1).sort()).toEqual(want.sort())
})

test.each([
  { name: 'or-assignment of a shift', code: 'mask |= 1 << b;', want: ['mask'] },
  { name: 'and with a shifted bit', code: 'if (state & (1 << i)) f();', want: ['state'] },
  { name: 'a shifted variable', code: 'x = y << 2;', want: ['y'] },
  { name: 'either side of or', code: 'z = a | b;', want: ['a', 'b'] },
  { name: 'not a stream insertion', code: 'cout << n << (m & 1);', want: ['m'] },
])('C++ bit operands: $name', async ({ code, want }) => {
  const facts = await parseSource(`int main() {\n${code}\n}`, 'cpp17-gcc')
  expect(lineFacts(facts, 2).bitwise).toEqual(want)
})

test('Python bit operands', async () => {
  const facts = await parseSource('mask |= 1 << b\nif seen & (1 << v): pass\n', 'python3')
  expect([lineFacts(facts, 1).bitwise, lineFacts(facts, 2).bitwise]).toEqual([['mask'], ['seen']])
})

test('a language without a grammar has no facts', async () => {
  expect(await parseSource('x', 'brainfuck')).toBeNull()
})
