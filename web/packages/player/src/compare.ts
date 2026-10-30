export type Print = { i: number; line: number | null; stdout: string; stderr: string }

export type Origin = { step: number; line: number | null; offset: number } | 'untraced'

export type Comparison =
  | { kind: 'match' }
  | {
      kind: 'differ'
      line: number
      char: number
      expected: string | null
      got: string | null
      from: Origin | null
    }
  | { kind: 'short'; missing: number; from: Origin | null }

type Normalized = { text: string; raw: (i: number) => number }

function normalize(raw: string, exact: boolean): Normalized {
  if (exact) return { text: raw, raw: (i) => i }
  const lines: { start: number; text: string; rawLength: number }[] = []
  let start = 0
  for (const line of raw.split('\n')) {
    lines.push({ start, text: line.trimEnd(), rawLength: line.length })
    start += line.length + 1
  }
  while (lines.at(-1)?.text === '') lines.pop()
  return {
    text: lines.map((l) => l.text).join('\n'),
    raw(i) {
      for (const l of lines) {
        if (i < l.text.length) return l.start + i
        if (i === l.text.length) return l.start + l.rawLength
        i -= l.text.length + 1
      }
      throw new Error('offset past the end of the output')
    },
  }
}

function origin(offset: number, prints: Print[]): Origin {
  let start = 0
  for (const p of prints) {
    if (offset < start + p.stdout.length) return { step: p.i, line: p.line, offset: offset - start }
    start += p.stdout.length
  }
  return 'untraced'
}

function missingLines(expected: string, got: string) {
  const boundary = got === '' || got.endsWith('\n') || expected[got.length] === '\n'
  if (!boundary) return 0
  const rest = expected.slice(got.length).replace(/^\n/, '')
  if (rest === '') return 0
  return rest.split('\n').length - (rest.endsWith('\n') ? 1 : 0)
}

export function compareOutput(
  expected: string,
  exact: boolean,
  prints: Print[],
  tail: string,
): Comparison {
  const e = normalize(expected, exact).text
  const got = normalize(prints.map((p) => p.stdout).join('') + tail, exact)
  const g = got.text
  let i = 0
  while (i < e.length && i < g.length && e[i] === g[i]) i++
  if (i === e.length && i === g.length) return { kind: 'match' }
  if (i === e.length && g[i] === '\n' && i + 1 < g.length) i++ // extra lines: their first char

  const last = g === '' ? null : origin(got.raw(Math.min(i, g.length - 1)), prints)
  const missing = i === g.length ? missingLines(e, g) : 0
  if (missing > 0) return { kind: 'short', missing, from: last }

  const before = g.slice(0, i)
  return {
    kind: 'differ',
    line: before.split('\n').length,
    char: i - before.lastIndexOf('\n'),
    expected: e[i] ?? null,
    got: g[i] ?? null,
    from: last,
  }
}

export function shownAt(prints: Print[], { step, offset }: { step: number; offset: number }) {
  let at = offset
  for (const p of prints) {
    if (p.i >= step) break
    at += p.stdout.length + p.stderr.length
  }
  return at
}

export function jumpTarget(c: Comparison, lastStep: number) {
  if (c.kind === 'match' || c.from === 'untraced') return null
  return c.from === null ? lastStep : c.from.step
}
