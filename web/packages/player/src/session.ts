import { proxy } from 'comlink'
import type { CallNode } from './calls.ts'
import { useEffect, useEffectEvent, useState } from 'react'
import type { Print } from './compare.ts'
import type { Ending } from './ending.ts'
import { same, type StepState } from './engine.ts'
import type { TraceHeader, TraceSource } from './load.ts'
import { createElk } from './elk.ts'
import { isUndirected, layoutGraph, type GraphLayout, type GraphRequest } from './graph.ts'
import type { NarratedTrace } from './narration.ts'
import { targetText, type Change, type Jump, type Target } from './search.ts'
import { spawnEngine } from './spawn-engine.ts'
import { stepFromUrl } from './step-param.ts'
import { usePlayer } from './store.ts'

export type LoadedTrace = NarratedTrace & {
  header: TraceHeader
  stepCount: number
  prints: Print[]
  tail: string
  calls: Record<string, number[]>
  tree: CallNode[]
  errors: number[]
  ending: Ending
  find: (from: number, jump: Jump) => Promise<number | null>
  history: (target: Target) => Promise<Change[]>
  passes: (at: number, header: number, loop: [number, number]) => Promise<number[]>
  graphLayout: (request: GraphRequest) => Promise<GraphLayout>
}

type Session =
  { status: 'loading' } | ({ status: 'ready' } & LoadedTrace) | { status: 'failed'; error: unknown }

// worker sends a fresh copy => keep unchanged objects, so memoized cards and frames skip them
function reuse(prev: StepState | null, next: StepState): StepState {
  if (prev === null) return next
  const heap: StepState['heap'] = {}
  for (const [id, o] of Object.entries(next.heap)) {
    const old = prev.heap[id]
    heap[id] = old !== undefined && same(old, o) ? old : o
  }
  const frames = new Map(prev.stack.map((f) => [f.id, f]))
  const stack = next.stack.map((f) => {
    const old = frames.get(f.id)
    return old !== undefined && same(old, f) ? old : f
  })
  return { ...next, heap, stack }
}

export function useSession(
  source: TraceSource,
  expected: string,
  code: string,
  stdin: string,
): Session {
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const prefilled = useEffectEvent(() => expected)
  const sourceCode = useEffectEvent(() => code)
  const sourceInput = useEffectEvent(() => stdin)

  useEffect(() => {
    let alive = true
    let elk: ReturnType<typeof createElk> | null = null
    let replied = false
    let ready = false
    let busy = false
    const fail = (error: unknown) => {
      replied = true
      if (alive) setSession({ status: 'failed', error })
    }
    const { remote, terminate } = spawnEngine((e) => {
      if (replied) return
      fail(
        new Error(
          `the trace engine did not start: ${e instanceof ErrorEvent ? e.message : e.type}`,
        ),
      )
    })

    function show() {
      const k = usePlayer.getState().step
      busy = true
      remote.step(k).then((state) => {
        busy = false
        if (!alive) return
        usePlayer.setState(({ current }) => ({ current: reuse(current, state) }))
        if (usePlayer.getState().step !== k) show()
      }, fail)
    }

    async function start() {
      const opened = await ('manifest' in source
        ? remote.openManifest(source.manifest, proxy(source.refresh))
        : remote.openFile(source))
      replied = true
      if (!alive) return
      const expected = prefilled()
      usePlayer.setState({
        step: stepFromUrl(location.search, opened.stepCount),
        current: null,
        facts: null,
        playing: false,
        breakpoints: [],
        expected,
        comparing: expected !== '',
        exact: false,
        jumpLine: '',
        jumpChange: '',
        jumpWhere: '',
        jumpCall: null,
        lane: null,
        notice: null,
        revealed: null,
      })
      ready = true
      const histories = new Map<string, Promise<Change[]>>()
      const layouts = new Map<string, Promise<GraphLayout>>()
      setSession({
        status: 'ready',
        ...opened,
        narrations: [],
        input: [],
        inputReads: [],
        find: (from, jump) => remote.find(from, jump),
        passes: (at, header, loop) => remote.passes(at, header, loop),
        graphLayout(request) {
          const key = JSON.stringify(request)
          let layout = layouts.get(key)
          if (layout === undefined) {
            layout = remote.graphUnion(request).then(({ nodes, edges }) => {
              if (elk === null) elk = createElk()
              const undirected =
                request.visits === null && (request.undirected ?? isUndirected(edges))
              return layoutGraph(request.nodes ?? nodes, edges, undirected, elk)
            })
            layouts.set(key, layout)
          }
          return layout
        },
        history(target) {
          const key = targetText(target)
          let changes = histories.get(key)
          if (changes === undefined) {
            changes = remote.history(target)
            histories.set(key, changes)
          }
          return changes
        },
      })
      show()
      const describe = (facts: Awaited<ReturnType<typeof remote.parse>>) => {
        remote.narrate(sourceInput(), facts, opened.header.language.id).then((described) => {
          if (alive)
            setSession((session) =>
              session.status === 'ready' ? { ...session, ...described } : session,
            )
        }, fail)
      }
      remote.parse(sourceCode(), opened.header.language.id).then(
        (facts) => {
          if (!alive) return
          usePlayer.setState({ facts })
          describe(facts)
        },
        (error: unknown) => {
          if (!alive) return
          const reason = error instanceof Error ? error.message : String(error)
          usePlayer.setState({ notice: `Couldn't parse the source for markers: ${reason}` })
          describe(null)
        },
      )
    }

    start().catch(fail)
    const unsubscribe = usePlayer.subscribe((s, prev) => {
      if (ready && !busy && s.step !== prev.step) show()
    })
    return () => {
      alive = false
      unsubscribe()
      terminate()
      elk?.terminateWorker()
    }
  }, [source])

  return session
}
