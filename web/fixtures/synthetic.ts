import type { Frame, HeapObject, Local, Step, Trace, Value } from '@viz/player'
import { encode, keyframeInterval, type Snapshot } from './encode.ts'

const lineCount = 40

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const int = (n: number): Value => ({ t: 'int', v: String(n) })
const uninit: Local = { name: 'x', value: { t: 'uninit' } }

function makeObject(id: number, rand: () => number): HeapObject {
  const n = () => Math.floor(rand() * 1000)
  switch (id % 6) {
    case 0:
      return {
        kind: 'sequence',
        type: 'vector<int>',
        length: 16,
        items: Array.from({ length: 16 }, () => int(n())),
        meta: { capacity: 16 },
      }
    case 1:
      return {
        kind: 'record',
        type: 'Node',
        fields: [
          { name: 'val', value: int(n()) },
          { name: 'w', value: { t: 'float', v: (rand() * 100).toFixed(3) } },
          { name: 'tag', value: { t: 'char', v: 'a', code: 97 } },
          { name: 'seen', value: { t: 'bool', v: 'false' } },
          { name: 'cache', value: { t: 'unavailable', reason: 'optimized_out' } },
          { name: 'next', value: { t: 'ptr', addr: '0x0', type: 'Node*' } },
        ],
      }
    case 2:
      return {
        kind: 'mapping',
        type: 'map<string,int>',
        length: 4,
        ordered: true,
        entries: ['ab', 'cd', 'ef', 'gh'].map((k) => ({
          key: { t: 'str', v: k },
          value: int(n()),
        })),
      }
    case 3:
      return {
        kind: 'set',
        type: 'set<int>',
        length: 5,
        ordered: true,
        items: [1, 2, 3, 5, 8].map(int),
      }
    case 4:
      return {
        kind: 'sequence',
        type: 'int[100005]',
        length: 100005,
        fixed: true,
        sparse: { default: int(0), items: { '1': int(1), '7': int(2) } },
        window: { start: 0, count: 16 },
      }
    default:
      return {
        kind: 'opaque',
        type: 'priority_queue<int>',
        summary: 'std::priority_queue with 3 elements',
      }
  }
}

function mutate(o: HeapObject, rand: () => number): HeapObject {
  const k = Math.floor(rand() * 16)
  const v = int(Math.floor(rand() * 1000))
  if (o.sparse)
    return { ...o, sparse: { ...o.sparse, items: { ...o.sparse.items, [k * 6151]: v } } }
  if (o.items && o.kind === 'sequence')
    return { ...o, items: o.items.map((x, i) => (i === k ? v : x)) }
  if (o.fields)
    return { ...o, fields: o.fields.map((f) => (f.name === 'val' ? { ...f, value: v } : f)) }
  if (o.entries)
    return { ...o, entries: o.entries.map((e, i) => (i === k % 4 ? { ...e, value: v } : e)) }
  return o
}

export function synthesize(stepCount: number, objectCount: number, seed: number) {
  const rand = mulberry32(seed)
  let nextObject = 1
  let nextFrame = 2
  let nextCall = 1
  const heap: Record<string, HeapObject> = {}
  for (; nextObject <= objectCount; nextObject++)
    heap[`o${nextObject}`] = makeObject(nextObject, rand)

  const globals = (): Frame => ({
    id: 'f0',
    name: 'globals',
    kind: 'global',
    line: 1,
    locals: Object.keys(heap).map((id): Local => ({ name: `g_${id}`, value: { t: 'ref', id } })),
    returnValue: null,
  })
  const calls: { frame: Frame; callId: number }[] = [
    {
      frame: {
        id: 'f1',
        name: 'main',
        kind: 'function',
        line: 2,
        locals: [{ name: 'i', value: int(0) }, uninit],
        returnValue: null,
      },
      callId: 0,
    },
  ]
  let global = globals()
  let line = 2
  let stdinBytes = 0
  const snapshots: Snapshot[] = []

  for (let i = 0; i < stepCount; i++) {
    const prevLine = i === 0 ? null : line
    line = 2 + Math.floor(rand() * (lineCount - 1))
    const top = calls[calls.length - 1]!
    const roll = rand()
    let snap: Partial<Snapshot> = {
      event: i === 0 ? 'call' : 'line',
      ...(i === 0 && { callId: 0 }),
    }

    if (i > 0 && roll < 0.08 && calls.length < 9) {
      const callId = nextCall++
      calls.push({
        frame: {
          id: `f${nextFrame++}`,
          name: 'dfs',
          kind: 'function',
          line,
          locals: [{ name: 'u', value: int(callId) }],
          returnValue: null,
        },
        callId,
      })
      snap = { event: 'call', callId, parentCallId: top.callId }
    } else if (i > 0 && roll < 0.16 && calls.length > 1) {
      top.frame = { ...top.frame, returnValue: int(Math.floor(rand() * 100)) }
      snap = { event: 'return', callId: top.callId }
    } else if (roll < 0.2) {
      const victim = `o${1 + Math.floor(rand() * (nextObject - 1))}`
      if (heap[victim]) {
        delete heap[victim]
        heap[`o${nextObject}`] = makeObject(nextObject, rand)
        nextObject++
        global = globals()
      }
    } else if (roll < 0.8) {
      const ids = Object.keys(heap)
      for (let m = 0; m < 1 + Math.floor(rand() * 3); m++) {
        const id = ids[Math.floor(rand() * ids.length)]!
        heap[id] = mutate(heap[id]!, rand)
      }
    }

    const inner = calls[calls.length - 1]!
    inner.frame = { ...inner.frame, line }
    calls[0]!.frame = { ...calls[0]!.frame, locals: [{ name: 'i', value: int(i) }, uninit] }
    const reading = rand() < 0.05
    if (reading) stdinBytes += 3

    snapshots.push({
      event: snap.event!,
      prevLine,
      line,
      stack: [global, ...calls.map((c) => c.frame)],
      heap: { ...heap },
      stdout: rand() < 0.05 ? `${i}\n` : '',
      stderr: '',
      error: null,
      ...(reading && { stdinPos: { bytes: stdinBytes, token: stdinBytes / 3, inferred: true } }),
      ...(snap.callId !== undefined && { callId: snap.callId }),
      ...(snap.parentCallId !== undefined && { parentCallId: snap.parentCallId }),
    })
    if (snap.event === 'return') calls.pop()
  }

  const header: Omit<Trace, 'steps'> = {
    version: '1.1',
    id: `trc_${seed.toString(16).padStart(32, '0')}`,
    language: { id: 'cpp17-gcc', runtime: 'GCC 13.2', adapter: 'synthetic/1.0.0' },
    source: { file: 'main.cpp', lineCount },
    options: { maxSteps: 5000, startAtLines: [] },
    summary: {
      stepCount,
      truncated: false,
      truncation: null,
      exit: { kind: 'normal', code: 0, signal: null, message: null },
    },
    encoding: { mode: 'delta', keyframeInterval },
  }
  const source =
    Array.from({ length: lineCount }, (_, n) => `// synthetic line ${n + 1}`).join('\n') + '\n'
  const chunks: Step[][] = encode(snapshots)
  return { header, chunks, source, stdin: '', tail: '' }
}
