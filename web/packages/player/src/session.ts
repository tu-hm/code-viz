import { proxy } from 'comlink'
import { useEffect, useState } from 'react'
import type { TraceHeader, TraceSource } from './load.ts'
import { spawnEngine } from './spawn-engine.ts'
import { stepFromUrl } from './step-param.ts'
import { usePlayer } from './store.ts'

type Session =
  | { status: 'loading' }
  | { status: 'ready'; header: TraceHeader; stepCount: number }
  | { status: 'failed'; error: unknown }

export function useSession(source: TraceSource): Session {
  const [session, setSession] = useState<Session>({ status: 'loading' })

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
        usePlayer.setState({ current: state })
        if (usePlayer.getState().step !== k) show()
      }, fail)
    }

    async function start() {
      const { header, stepCount } = await ('manifest' in source
        ? remote.openManifest(source.manifest, proxy(source.refresh))
        : remote.openFile(source))
      replied = true
      if (!alive) return
      usePlayer.setState({
        step: stepFromUrl(location.search, stepCount),
        current: null,
        playing: false,
        breakpoints: [],
      })
      ready = true
      setSession({ status: 'ready', header, stepCount })
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
