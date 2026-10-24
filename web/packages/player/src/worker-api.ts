import { createEngine } from './engine.ts'
import { loadTrace, type FileSource, type Manifest, type TraceSource } from './load.ts'

const prefetch = [1, -1, 2, -2]

export function createWorkerApi() {
  let engine: ReturnType<typeof createEngine> | null = null

  async function open(source: TraceSource) {
    const { header, steps } = await loadTrace(source)
    engine = createEngine(steps)
    return { header, stepCount: steps.length }
  }

  return {
    openFile: (file: FileSource) => open(file),
    // Comlink proxies a function only as a top-level argument, so refresh can't ride inside source
    openManifest: (manifest: Manifest, refresh: () => Promise<Manifest>) =>
      open({ manifest, refresh }),
    step(k: number) {
      if (engine === null) throw new Error('step before open')
      const { state, stepCount } = engine
      const result = state(k)
      setTimeout(() => {
        for (const d of prefetch) if (k + d >= 0 && k + d < stepCount) state(k + d)
      })
      return result
    },
  }
}

export type WorkerApi = ReturnType<typeof createWorkerApi>
