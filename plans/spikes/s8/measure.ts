// S8: run the player's tree-sitter facts over the corpus and score them against labels.txt.
// node plans/spikes/s8/measure.ts [--verbose]   (Node 24, after pnpm install in web/)
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  collectFacts,
  indexText,
  lineFacts,
  type SourceFacts,
} from '../../../web/packages/player/src/source-facts.ts'

const here = import.meta.dirname
const repo = join(here, '../../..')
const require = createRequire(join(repo, 'web/packages/player/package.json'))
const { Parser, Language } = await import(require.resolve('web-tree-sitter'))
const verbose = process.argv.includes('--verbose')

type Access = { mode: string; array: string; indices: string[] }
type Program = { file: string; trace: string | null; labels: Map<number, Access[]> }

function splitAccess(text: string): Access {
  const [mode, rest] = [text.slice(0, text.indexOf(' ')), text.slice(text.indexOf(' ') + 1)]
  const open = rest.indexOf('[')
  const indices: string[] = []
  let depth = 0
  let current = ''
  for (const ch of rest.slice(open)) {
    if (ch === '[' && depth++ === 0) continue
    if (ch === ']' && --depth === 0) {
      indices.push(current.replace(/\s+/g, ''))
      current = ''
      continue
    }
    if (depth > 0) current += ch
  }
  return { mode, array: rest.slice(0, open), indices }
}

function readLabels(): Program[] {
  const programs: Program[] = []
  for (const raw of readFileSync(join(here, 'labels.txt'), 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('== ')) {
      const [file, trace] = line.slice(3).split(' ')
      programs.push({ file: file!, trace: trace ?? null, labels: new Map() })
      continue
    }
    const [n, list] = line.split(': ')
    programs.at(-1)!.labels.set(Number(n), list!.split('; ').map(splitAccess))
  }
  return programs
}

const evaluable = /^([A-Za-z_]\w*)([+-]\d+)?$|^\d+$/

function canonical(index: string) {
  const swapped = /^(\d+)\+([A-Za-z_]\w*)$/.exec(index)
  return swapped ? `${swapped[2]}+${swapped[1]}` : index
}

function markers(accesses: Access[]) {
  const out = new Map<string, string>()
  for (const a of accesses) {
    a.indices.forEach((raw, axis) => {
      const index = canonical(raw)
      const m = evaluable.exec(index)
      if (!m || m[1] === undefined) return
      const key = `${a.array}|${axis}|${m[1]}`
      const label = `${a.array}|${axis}|${index}`
      if (!out.has(key) || index === m[1]) out.set(key, label)
    })
  }
  return new Set(out.values())
}

function reads(accesses: Access[], drawable: boolean) {
  return new Set(
    accesses
      .filter((a) => a.mode !== 'w')
      .filter((a) => !drawable || a.indices.every((i) => evaluable.test(canonical(i))))
      .map((a) => `${a.array}[${a.indices.map(canonical).join('][')}]`),
  )
}

function parsed(facts: SourceFacts, line: number): Access[] {
  return lineFacts(facts, line).subscripts.map((s) => ({
    mode: s.mode,
    array: s.array,
    indices: s.indices.map(indexText),
  }))
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((x) => b.has(x))
}

type Steps = { line: number; prevLine: number | null }[]

function loadSteps(trace: string): Steps {
  const path = join(repo, trace)
  if (trace.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8')).steps
  return readdirSync(path)
    .filter((f) => f.startsWith('chunk-'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(path, f), 'utf8')))
}

const tLoad = performance.now()
await Parser.init()
const grammars = {
  cpp: await Language.load(require.resolve('tree-sitter-cpp/tree-sitter-cpp.wasm')),
  py: await Language.load(require.resolve('tree-sitter-python/tree-sitter-python.wasm')),
}
const loadMs = performance.now() - tLoad

const groups = {
  traced: { lines: 0, ok: 0 },
  written: { lines: 0, ok: 0 },
}
const totals = { lines: 0, linesOk: 0, steps: 0, stepsOk: 0, accessSteps: 0, accessStepsOk: 0 }
const markerMiss = { lines: 0, steps: 0 }
const readMiss = { lines: 0, steps: 0 }
const parseMs: number[] = []
const misses: string[] = []

for (const program of readLabels()) {
  const source = readFileSync(join(here, 'corpus', program.file), 'utf8')
  const parser = new Parser()
  parser.setLanguage(program.file.endsWith('.py') ? grammars.py : grammars.cpp)
  const t0 = performance.now()
  const tree = parser.parse(source)
  const facts = collectFacts(tree.rootNode)
  parseMs.push(performance.now() - t0)
  tree.delete()
  parser.delete()

  const expected = (line: number) => program.labels.get(line) ?? []
  const markersOk = (line: number | null) =>
    line === null || sameSet(markers(expected(line)), markers(parsed(facts, line)))
  const readsOk = (line: number | null) =>
    line === null || sameSet(reads(expected(line), false), reads(parsed(facts, line), true))

  const lines = source.split('\n').length
  for (let line = 1; line <= lines; line++) {
    const [m, r] = [markersOk(line), readsOk(line)]
    totals.lines++
    if (m && r) totals.linesOk++
    if (!m) markerMiss.lines++
    if (!r) readMiss.lines++
    if (expected(line).length + parsed(facts, line).length > 0) {
      const g = groups[program.trace === null ? 'written' : 'traced']
      g.lines++
      if (m && r) g.ok++
    }
    if (m && r) continue
    const got = parsed(facts, line).map((a) => `${a.mode} ${a.array}[${a.indices.join('][')}]`)
    const want = expected(line).map((a) => `${a.mode} ${a.array}[${a.indices.join('][')}]`)
    misses.push(
      `${program.file}:${line} ${m ? '' : 'markers '}${r ? '' : 'reads '}want {${want.join('; ')}} got {${got.join('; ')}}`,
    )
  }

  if (program.trace === null) continue
  for (const step of loadSteps(program.trace)) {
    const m = markersOk(step.line) && markersOk(step.prevLine)
    const r = readsOk(step.prevLine)
    const touches =
      parsed(facts, step.line).length +
        expected(step.line).length +
        (step.prevLine === null
          ? 0
          : parsed(facts, step.prevLine).length + expected(step.prevLine).length) >
      0
    totals.steps++
    if (m && r) totals.stepsOk++
    if (!m) markerMiss.steps++
    if (!r) readMiss.steps++
    if (touches) {
      totals.accessSteps++
      if (m && r) totals.accessStepsOk++
    }
  }
}

const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}% (${a}/${b})`
const sorted = parseMs.toSorted((a, b) => a - b)
console.log(`programs: ${parseMs.length}`)
console.log(`lines correct: ${pct(totals.linesOk, totals.lines)}`)
console.log(`  lines with a wrong marker: ${markerMiss.lines}, wrong reads: ${readMiss.lines}`)
console.log(`steps correct (traced programs): ${pct(totals.stepsOk, totals.steps)}`)
console.log(`  steps with a wrong marker: ${markerMiss.steps}, wrong reads: ${readMiss.steps}`)
console.log(
  `steps touching a subscript line correct: ${pct(totals.accessStepsOk, totals.accessSteps)}`,
)
console.log(`lines with a subscript, traced programs: ${pct(groups.traced.ok, groups.traced.lines)}`)
console.log(`lines with a subscript, written programs: ${pct(groups.written.ok, groups.written.lines)}`)
console.log(`runtime + both grammars loaded in ${loadMs.toFixed(0)} ms`)
console.log(
  `parse + facts, ms: median ${sorted[sorted.length >> 1]!.toFixed(2)}, max ${sorted.at(-1)!.toFixed(2)} (first includes warm-up)`,
)
if (verbose) for (const m of misses) console.log(`  miss ${m}`)
