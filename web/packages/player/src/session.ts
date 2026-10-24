import { proxy } from 'comlink'
import { useEffect, useEffectEvent, useState } from 'react'
import type { Print } from './compare.ts'
import type { Ending } from './ending.ts'
import { same, type StepState } from './engine.ts'
import type { TraceHeader, TraceSource } from './load.ts'
import type { Jump } from './search.ts'
import { spawnEngine } from './spawn-engine.ts'
import { stepFromUrl } from './step-param.ts'
import { usePlayer } from './store.ts'

export type LoadedTrace = {
  header: TraceHeader
  stepCount: number
  prints: Print[]
  tail: string
  functions: string[]
  ending: Ending
  find: (from: number, jump: Jump) => Promise<number | null>
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

export function useSession(source: TraceSource, expected: string): Session {
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const prefilled = useEffectEvent(() => expected)

  useEffect(() => {
    let alive = true
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
        playing: false,
        breakpoints: [],
        expected,
        comparing: expected !== '',
        exact: false,
        jumpLine: '',
        jumpChange: '',
        jumpCall: null,
        notice: null,
        revealed: null,
      })
      ready = true
      setSession({ status: 'ready', ...opened, find: (from, jump) => remote.find(from, jump) })
      show()
    }

    start().catch(fail)
    const unsubscribe = usePlayer.subscribe((s, prev) => {
      if (ready && !busy && s.step !== prev.step) show()
    })
    return () => {
      alive = false
      unsubscribe()
      terminate()
    }
  }, [source])

  return session
}
