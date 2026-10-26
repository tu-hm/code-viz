import type { Frame, HeapObject, Step } from '@viz/player'

export type Snapshot = Pick<Step, 'event' | 'prevLine' | 'line' | 'stdout' | 'stderr' | 'error'> &
  Partial<Pick<Step, 'access' | 'stdinPos' | 'callId' | 'parentCallId'>> & {
    stack: Frame[]
    heap: Record<string, HeapObject>
  }

export const keyframeInterval = 50
export const chunkSize = 250

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

function withoutCells(o: HeapObject) {
  return { ...o, sparse: { ...o.sparse, items: undefined } }
}

function sparsePatch(before: HeapObject, after: HeapObject): HeapObject {
  if (!before.sparse || !after.sparse || !same(withoutCells(before), withoutCells(after))) {
    return after
  }
  const patch: NonNullable<HeapObject['patch']> = {}
  for (const k of new Set([
    ...Object.keys(before.sparse.items),
    ...Object.keys(after.sparse.items),
  ])) {
    const cell = after.sparse.items[k] ?? after.sparse.default
    if (!same(before.sparse.items[k] ?? before.sparse.default, cell)) patch[k] = cell
  }
  return { kind: after.kind, type: after.type, length: after.length, patch }
}

export function encode(snapshots: Snapshot[]): Step[][] {
  const steps: Step[] = []
  let prevFrames: Record<string, Frame> = {}
  let prevHeap: Record<string, HeapObject> = {}

  snapshots.forEach((snap, i) => {
    const keyframe = i % keyframeInterval === 0
    const frames: Step['frames'] = {}
    for (const f of snap.stack) {
      if (keyframe || !same(prevFrames[f.id], f)) frames[f.id] = f
    }
    const heap: Step['heap'] = {}
    for (const [id, obj] of Object.entries(snap.heap)) {
      const before = prevHeap[id]
      if (keyframe || !before) heap[id] = obj
      else if (!same(before, obj)) heap[id] = sparsePatch(before, obj)
    }

    const { access, stdinPos, callId, parentCallId } = snap
    steps.push({
      i,
      event: snap.event,
      prevLine: snap.prevLine,
      line: snap.line,
      keyframe,
      stack: snap.stack.map((f) => f.id),
      frames,
      heap,
      removedObjects: keyframe ? [] : Object.keys(prevHeap).filter((id) => !(id in snap.heap)),
      stdout: snap.stdout,
      stderr: snap.stderr,
      error: snap.error,
      ...(access && { access }),
      ...(stdinPos && { stdinPos }),
      ...(callId !== undefined && { callId }),
      ...(parentCallId !== undefined && { parentCallId }),
    })
    prevFrames = Object.fromEntries(snap.stack.map((f) => [f.id, f]))
    prevHeap = snap.heap
  })

  const chunks: Step[][] = []
  for (let k = 0; k < steps.length; k += chunkSize) chunks.push(steps.slice(k, k + chunkSize))
  return chunks
}
