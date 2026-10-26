import { apply, same, type Base } from './engine.ts'
import type { HeapObject, Step, Value } from './gen/trace.ts'
import { reach } from './search.ts'

type Arg = { name: string; value: Value }

export type CallNode = {
  id: number
  parent: number | null
  name: string
  frame: string
  args: Arg[]
  call: number
  // null => never returned: still running at the last step, or the program died inside it
  ret: number | null
  value: Value | null
  raised: boolean
  // 0 => the program's entry (main, <module>), which the tree doesn't draw
  depth: number
  repeated: boolean
}

type CallStatus = 'running' | 'returned' | 'raised' | 'left'

export type CallRow =
  | {
      kind: 'call'
      node: CallNode
      prefix: string
      status: CallStatus
      active: boolean
      folded: number
    }
  | { kind: 'more'; parent: number; count: number; prefix: string }
  | { kind: 'levels'; count: number; prefix: string }

export type CallView = {
  rows: CallRow[]
  active: CallNode | null
  depth: number
  maxDepth: number
  calls: number
}

const maxSiblings = 8 // §19.4.4
const maxLevels = 50
const keptLevels = 10

// a keyframe resends every object => same content keeps its number, so a repeat across one still matches
function instanceNumbers() {
  const last = new Map<string, { o: HeapObject; n: number }>()
  let next = 0
  return (id: string, o: HeapObject) => {
    const seen = last.get(id)
    if (seen !== undefined && (seen.o === o || same(seen.o, o))) {
      seen.o = o
      return seen.n
    }
    last.set(id, { o, n: next })
    return next++
  }
}

function argKey(
  value: Value,
  heap: Map<string, HeapObject>,
  number: ReturnType<typeof instanceNumbers>,
) {
  if (value.t !== 'ref') return JSON.stringify(value)
  const objects = [...reach(value, heap)].map(([id, o]) => `${id}@${number(id, o)}`)
  return `ref ${objects.join(' ')}`
}

export function callTree(steps: Step[]): CallNode[] {
  const walk: Base = { frames: new Map(), heap: new Map() }
  const nodes: CallNode[] = []
  const byId = new Map<number, CallNode>()
  const seen = new Set<string>()
  const number = instanceNumbers()
  for (const [k, step] of steps.entries()) {
    apply(walk, step)
    if (step.callId === undefined) continue
    const frameId = step.stack.at(-1)!
    const frame = walk.frames.get(frameId)!
    if (step.event === 'return') {
      const node = byId.get(step.callId)
      if (node === undefined) continue
      const before = steps[k - 1]
      node.ret = k
      node.value = frame.returnValue
      node.raised = before?.event === 'exception' && before.stack.at(-1) === frameId
      continue
    }
    if (step.event !== 'call') continue
    const args = frame.locals
      .filter((l) => !l.internal && l.value.t !== 'uninit')
      .map((l) => ({ name: l.name, value: l.value }))
    const parent = step.parentCallId === undefined ? undefined : byId.get(step.parentCallId)
    const outermost = step.stack.slice(0, -1).every((id) => walk.frames.get(id)?.kind === 'global')
    const key = `${frame.name}(${args.map((a) => argKey(a.value, walk.heap, number)).join(', ')})`
    const node: CallNode = {
      id: step.callId,
      parent: parent?.id ?? null,
      name: frame.name,
      frame: frameId,
      args,
      call: k,
      ret: null,
      value: null,
      raised: false,
      depth: parent !== undefined ? parent.depth + 1 : k === 0 && outermost ? 0 : 1,
      repeated: seen.has(key),
    }
    seen.add(key)
    nodes.push(node)
    byId.set(node.id, node)
  }
  return nodes
}

export function callView(
  tree: CallNode[],
  step: number,
  frame: string | undefined,
  options: { collapseRepeated: boolean; expanded: ReadonlySet<number> },
): CallView {
  const visible = tree.filter((n) => n.call <= step && n.depth > 0)
  const children = new Map<number | null, CallNode[]>()
  for (const n of visible) {
    const parent = n.depth === 1 ? null : n.parent
    const list = children.get(parent)
    if (list === undefined) children.set(parent, [n])
    else list.push(n)
  }
  const byId = new Map(visible.map((n) => [n.id, n]))
  const active = visible.findLast((n) => n.frame === frame) ?? null
  const path = new Set<number>()
  for (let n = active; n !== null; n = n.depth > 1 ? (byId.get(n.parent!) ?? null) : null) {
    path.add(n.id)
  }

  const deepest = new Map<number, number>()
  const size = new Map<number, number>()
  for (const n of visible.toReversed()) {
    deepest.set(n.id, Math.max(deepest.get(n.id) ?? 0, n.depth))
    if (n.depth === 1 || n.parent === null) continue
    deepest.set(n.parent, Math.max(deepest.get(n.parent) ?? 0, deepest.get(n.id)!))
    size.set(n.parent, (size.get(n.parent) ?? 0) + (size.get(n.id) ?? 0) + 1)
  }

  const status = (n: CallNode): CallStatus => {
    if (n.ret !== null && n.ret <= step) return n.raised ? 'raised' : 'returned'
    return path.has(n.id) ? 'running' : 'left'
  }

  // toward the active call when it's below, else toward the deepest one
  const below = (n: CallNode, depth: number) => {
    let at = n
    while (at.depth < depth) {
      const kids = children.get(at.id) ?? []
      const deep = deepest.get(at.id)
      at = kids.find((k) => path.has(k.id)) ?? kids.find((k) => deepest.get(k.id) === deep)!
    }
    return at
  }

  const rows: CallRow[] = []
  const emit = (
    kids: CallNode[],
    parent: number | null,
    lead: string,
    top: boolean,
    elide: boolean,
  ) => {
    let shown: (CallNode | number)[] = kids
    if (kids.length > maxSiblings && !options.expanded.has(parent ?? -1)) {
      const first = kids.slice(0, maxSiblings)
      const late = kids.slice(maxSiblings).filter((k) => path.has(k.id))
      shown = [...first, kids.length - first.length - late.length, ...late]
    }
    shown.forEach((item, i) => {
      const last = i === shown.length - 1
      const prefix = top ? '' : `${lead}${last ? '└─ ' : '├─ '}`
      const inner = top ? '' : `${lead}${last ? '   ' : '│  '}`
      if (typeof item === 'number') {
        rows.push({ kind: 'more', parent: parent ?? -1, count: item, prefix })
        return
      }
      const fold = options.collapseRepeated && item.repeated && !path.has(item.id)
      rows.push({
        kind: 'call',
        node: item,
        prefix,
        status: status(item),
        active: item === active,
        folded: fold ? (size.get(item.id) ?? 0) : 0,
      })
      if (fold) return
      const leaf = path.has(item.id) ? active!.depth : deepest.get(item.id)!
      if (elide && item.depth === keptLevels && leaf > maxLevels) {
        const resume = below(item, leaf - keptLevels + 1)
        rows.push({ kind: 'levels', count: resume.depth - item.depth - 1, prefix: `${inner}└─ ` })
        emit([resume], resume.parent, `${inner}   `, false, false)
        return
      }
      emit(children.get(item.id) ?? [], item.id, inner, false, elide)
    })
  }
  emit(children.get(null) ?? [], null, '', true, true)

  return {
    rows,
    active,
    depth: active?.depth ?? 0,
    maxDepth: Math.max(0, ...visible.map((n) => n.depth)),
    calls: visible.length,
  }
}
