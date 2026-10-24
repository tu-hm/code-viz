import type { HeapObject, Step, Trace } from './gen/trace.ts'
import { isRecord } from './is-record.ts'

export type TraceHeader = Omit<Trace, 'steps'>
export type FileSource = { header: TraceHeader; chunks: Step[][] }
export type Manifest = {
  header: TraceHeader
  chunks: { sha256: string; url: string }[]
  urlsExpireAt: string
}
export type TraceSource = FileSource | { manifest: Manifest; refresh: () => Promise<Manifest> }

// a name, not a class: Comlink rebuilds a worker's error as a plain Error with name and message only
const errorNames = ['ChecksumError', 'NetworkError', 'VersionError'] as const
type TraceError = Error & { name: (typeof errorNames)[number] }

export function isTraceError(e: unknown): e is TraceError {
  return e instanceof Error && (errorNames as readonly string[]).includes(e.name)
}

function traceError(name: TraceError['name'], message: string) {
  const e = new Error(message)
  e.name = name
  return e
}

export const kinds = [
  'sequence',
  'set',
  'mapping',
  'record',
  'function',
  'class',
  'opaque',
] as const

function isKnownKind(kind: string) {
  return (kinds as readonly string[]).includes(kind)
}

function opaque(o: HeapObject): HeapObject {
  return { kind: 'opaque', type: o.type ?? o.kind, summary: o.summary ?? `${o.kind} object` }
}

// unknown kind => opaque (§9.7)
function withKnownKinds(step: Step): Step {
  if (Object.values(step.heap).every((o) => isKnownKind(o.kind))) return step
  const heap = Object.entries(step.heap).map(([id, o]): [string, HeapObject] => [
    id,
    isKnownKind(o.kind) ? o : opaque(o),
  ])
  return { ...step, heap: Object.fromEntries(heap) }
}

function checkVersion(version: string) {
  if (!/^1\.\d+$/.test(version)) {
    throw traceError(
      'VersionError',
      `trace format ${version} is not 1.x, the version this player reads`,
    )
  }
}

function isStep(x: unknown): x is Step {
  return (
    isRecord(x) &&
    typeof x.i === 'number' &&
    typeof x.keyframe === 'boolean' &&
    Array.isArray(x.stack) &&
    isRecord(x.frames) &&
    isRecord(x.heap) &&
    Array.isArray(x.removedObjects) &&
    typeof x.stdout === 'string' &&
    typeof x.stderr === 'string'
  )
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function text(bytes: Uint8Array<ArrayBuffer>) {
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!gzip) return new TextDecoder().decode(bytes)
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text()
}

async function download(url: string, index: number) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    throw traceError(
      'NetworkError',
      `chunk ${index}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

async function fetchChunk(link: Manifest['chunks'][number], index: number) {
  const bytes = await download(link.url, index)
  const hash = await sha256(bytes)
  if (hash !== link.sha256) {
    throw traceError(
      'ChecksumError',
      `chunk ${index}: sha256 is ${hash}, manifest says ${link.sha256}`,
    )
  }
  const steps: unknown = JSON.parse(await text(bytes))
  if (!Array.isArray(steps) || !steps.every(isStep)) {
    throw new Error(`chunk ${index}: not an array of trace steps`)
  }
  return steps
}

export async function loadTrace(source: TraceSource, now = Date.now) {
  let header: TraceHeader
  let steps: Step[]
  if ('chunks' in source) {
    header = source.header
    checkVersion(header.version)
    steps = source.chunks.flat()
  } else {
    let manifest = source.manifest
    header = manifest.header
    checkVersion(header.version)
    steps = []
    for (let index = 0; index < manifest.chunks.length; index++) {
      if (now() >= Date.parse(manifest.urlsExpireAt)) manifest = await source.refresh()
      steps.push(...(await fetchChunk(manifest.chunks[index]!, index)))
    }
  }
  steps.forEach((s, k) => {
    if (s.i !== k) throw new Error(`step ${k} has i = ${s.i}; chunks out of order`)
  })
  return { header, steps: steps.map(withKnownKinds) }
}
