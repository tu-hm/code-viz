import type { Step, Trace } from '@viz/player'
import { synthesize } from './synthetic.ts'

export type Fixture = {
  header: Omit<Trace, 'steps'>
  chunks: Step[][]
  source: string
  stdin: string
  tail: string
}

type Header = Fixture['header']

const headers = import.meta.glob<Header>('./*/header.json', { eager: true, import: 'default' })
const chunkFiles = import.meta.glob<Step[]>('./*/chunk-*.json', { eager: true, import: 'default' })
const sources = import.meta.glob<string>('./*/main.*', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const stdins = import.meta.glob<string>('./*/stdin', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const tails = import.meta.glob<string>('./*/tail.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const synthetic: Record<string, [steps: number, objects: number, seed: number]> = {
  'synthetic-1000': [1000, 100, 1],
  'synthetic-5000': [5000, 500, 2],
}

export const fixtureNames = [
  ...Object.keys(headers).map((path) => path.split('/')[1]!),
  ...Object.keys(synthetic),
]

const generated = new Map<string, Fixture>()

function inDir<T>(files: Record<string, T>, name: string) {
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`./${name}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, file]) => file)
}

export function loadFixture(name: string): Fixture {
  const header = headers[`./${name}/header.json`]
  if (header) {
    const [source] = inDir(sources, name)
    const [stdin] = inDir(stdins, name)
    const [tail] = inDir(tails, name)
    if (source === undefined) throw new Error(`fixture ${name}: no main.* source file`)
    return { header, chunks: inDir(chunkFiles, name), source, stdin: stdin ?? '', tail: tail ?? '' }
  }

  const params = synthetic[name]
  if (!params) throw new Error(`no fixture named ${name}; have ${fixtureNames.join(', ')}`)
  let fixture = generated.get(name)
  if (!fixture) {
    fixture = synthesize(...params)
    generated.set(name, fixture)
  }
  return fixture
}
