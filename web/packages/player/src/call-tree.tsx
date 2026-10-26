import { Button, cn } from '@viz/ui'
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { callView, type CallNode, type CallRow } from './calls.ts'
import type { Frame } from './gen/trace.ts'
import { shown } from './narration.ts'

const modes = ['tree', 'stack'] as const

type CallsPanelProps = {
  tree: CallNode[]
  step: number
  line: number
  stack: Frame[]
  languageId: string
  onGo: (step: number) => void
}

const shownFrames = 20 // §19.4.4
const keptFrames = 10

function args(node: CallNode, languageId: string, named: boolean) {
  return node.args.map((a) => (named ? `${a.name} = ` : '') + shown(a.value, languageId)).join(', ')
}

function CallLabel({
  node,
  languageId,
  onGo,
}: {
  node: CallNode
  languageId: string
  onGo: (step: number) => void
}) {
  const go = (e: MouseEvent) => onGo(e.shiftKey && node.ret !== null ? node.ret : node.call)
  const where =
    node.ret === null
      ? `Go to the call, step ${node.call + 1}`
      : `Go to the call, step ${node.call + 1}; Shift-click: the return, step ${node.ret + 1}`
  return (
    <button
      type="button"
      title={`${node.name}(${args(node, languageId, true)}) · ${where}`}
      onClick={go}
      className="rounded-sm hover:underline"
    >
      {node.name}({args(node, languageId, false)})
    </button>
  )
}

function Row({
  row,
  line,
  languageId,
  onGo,
  onExpand,
}: {
  row: CallRow
  line: number
  languageId: string
  onGo: (step: number) => void
  onExpand: (parent: number) => void
}) {
  const prefix = (
    <span aria-hidden className="whitespace-pre text-faint">
      {row.prefix}
    </span>
  )
  if (row.kind === 'more') {
    return (
      <li>
        {prefix}
        <button
          type="button"
          onClick={() => onExpand(row.parent)}
          className="rounded-sm text-muted-foreground hover:underline"
        >
          +{row.count.toLocaleString('en')} calls
        </button>
      </li>
    )
  }
  if (row.kind === 'levels') {
    return (
      <li className="text-muted-foreground">
        {prefix}… {row.count.toLocaleString('en')} more levels
      </li>
    )
  }
  const { node, status, active, folded } = row
  return (
    <li data-active={active || undefined} className={cn(active && 'font-semibold')}>
      {prefix}
      <CallLabel node={node} languageId={languageId} onGo={onGo} />{' '}
      {status === 'running' && (
        <span>
          <span aria-hidden>…</span>
          <span className="sr-only">still running</span>
        </span>
      )}
      {(status === 'returned' || status === 'raised') && (
        <button
          type="button"
          aria-label={`${node.name} ${status === 'raised' ? 'raised' : `returns ${node.value === null ? 'nothing' : shown(node.value, languageId)}`}: go to step ${node.ret! + 1}`}
          onClick={() => onGo(node.ret!)}
          className="rounded-sm hover:underline"
        >
          {status === 'raised'
            ? '✕ raised'
            : node.value === null
              ? '✓'
              : `→ ${shown(node.value, languageId)}`}
        </button>
      )}
      {status === 'left' && <span className="text-muted-foreground">(no return)</span>}
      {node.repeated && <span className="font-normal text-muted-foreground"> ↺ repeated</span>}
      {active && (
        <span className="font-normal text-brand">
          {node.repeated ? ' ·' : ''} ▶ active (line {line})
        </span>
      )}
      {folded > 0 && (
        <span className="font-normal text-muted-foreground">
          {' '}
          · {folded.toLocaleString('en')} {folded === 1 ? 'call' : 'calls'} hidden
        </span>
      )}
    </li>
  )
}

function StackList({
  tree,
  stack,
  languageId,
  onGo,
}: Pick<CallsPanelProps, 'tree' | 'stack' | 'languageId' | 'onGo'>) {
  const nodes = new Map(tree.map((n) => [n.frame, n]))
  const frames = stack.filter((f) => f.kind !== 'global' || nodes.has(f.id))
  const cut = frames.length > shownFrames
  const head = cut ? frames.slice(0, keptFrames) : frames
  const tail = cut ? frames.slice(-keptFrames) : []
  const item = (f: Frame) => {
    const node = nodes.get(f.id)
    const active = f === frames.at(-1)
    return (
      <li
        key={f.id}
        className={cn(
          'flex items-baseline gap-2 rounded-lg bg-card px-2 py-0.5',
          active && 'outline-2 -outline-offset-2 outline-brand',
        )}
      >
        {node === undefined ? (
          <span>{f.name}()</span>
        ) : (
          <CallLabel node={node} languageId={languageId} onGo={onGo} />
        )}
        <span className="text-xs text-muted-foreground">line {f.line}</span>
        {active && <span className="text-xs text-brand">▶ active</span>}
      </li>
    )
  }
  return (
    <ol aria-label="Stack, innermost last" className="flex flex-col gap-1">
      {head.map(item)}
      {cut && (
        <li className="px-2 text-muted-foreground">
          … {(frames.length - 2 * keptFrames).toLocaleString('en')} more frames
        </li>
      )}
      {tail.map(item)}
    </ol>
  )
}

export function CallsPanel({ tree, step, line, stack, languageId, onGo }: CallsPanelProps) {
  const headingId = useId()
  const [mode, setMode] = useState<(typeof modes)[number]>('tree')
  const [collapseRepeated, setCollapseRepeated] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const list = useRef<HTMLDivElement>(null)
  const view = callView(tree, step, stack.at(-1)?.id, { collapseRepeated, expanded })
  const activeId = view.active?.id

  useEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('[data-active]')
    if (!box || !row) return
    const top = row.offsetTop - box.offsetTop
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + row.offsetHeight - box.clientHeight
    }
  }, [activeId, mode])

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="mono-label text-muted-foreground">
          Calls
        </h2>
        <div role="group" aria-label="Show calls as" className="flex gap-1">
          {modes.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={m === mode ? 'secondary' : 'ghost'}
              aria-pressed={m === mode}
              onClick={() => setMode(m)}
            >
              {m === 'tree' ? 'Tree' : 'Stack'}
            </Button>
          ))}
        </div>
        {mode === 'tree' && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            aria-pressed={collapseRepeated}
            onClick={() => setCollapseRepeated(!collapseRepeated)}
          >
            Collapse repeated calls
          </Button>
        )}
      </div>
      <div
        ref={list}
        className="max-h-72 overflow-auto font-mono text-(length:--code-font-size) leading-(--code-line-height)"
      >
        {mode === 'stack' ? (
          <StackList tree={tree} stack={stack} languageId={languageId} onGo={onGo} />
        ) : view.rows.length === 0 ? (
          <p className="font-sans text-muted-foreground">No calls yet.</p>
        ) : (
          <ul aria-label="Call tree">
            {view.rows.map((row, i) => (
              <Row
                key={row.kind === 'call' ? row.node.id : `${row.kind}${i}`}
                row={row}
                line={line}
                languageId={languageId}
                onGo={onGo}
                onExpand={(parent) => setExpanded(new Set([...expanded, parent]))}
              />
            ))}
          </ul>
        )}
      </div>
      {mode === 'tree' && (
        <p className="flex flex-wrap gap-x-6 font-mono text-xs text-muted-foreground">
          <span>↺ same arguments as an earlier call</span>
          <span>▶ active call</span>
          <span>… still running</span>
        </p>
      )}
      <p className="font-mono text-xs text-muted-foreground">
        depth {view.depth} now · max depth {view.maxDepth} · {view.calls.toLocaleString('en')}{' '}
        {view.calls === 1 ? 'call' : 'calls'} so far
      </p>
    </section>
  )
}
