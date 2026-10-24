import type { Print } from './compare.ts'
import { ending } from './ending.ts'
import { createEngine } from './engine.ts'
import type { Step } from './gen/trace.ts'
import { loadTrace, type FileSource, type Manifest, type TraceSource } from './load.ts'
import { calledFunctions, findStep, type Jump } from './search.ts'

const prefetch = [1, -1, 2, -2]

export function createWorkerApi() {
  let trace: { steps: Step[]; engine: ReturnType<typeof createEngine> } | null = null

  async function open(source: TraceSource) {
    const { header, steps, tail } = await loadTrace(source)
    const engine = createEngine(steps)
    trace = { steps, engine }
    const prints = steps
      .filter((s) => s.stdout !== '' || s.stderr !== '')
      .map((s): Print => ({ i: s.i, line: s.prevLine, stdout: s.stdout, stderr: s.stderr }))
    return {
      header,
      stepCount: steps.length,
      prints,
      tail,
      functions: calledFunctions(steps),
      ending: ending(steps, engine.state),
    }
  }

  return {
    openFile: (file: FileSource) => open(file),
    // Comlink proxies a function only as a top-level argument, so refresh can't ride inside source
    openManifest: (manifest: Manifest, refresh: () => Promise<Manifest>) =>
      open({ manifest, refresh }),
    step(k: number) {
      if (trace === null) throw new Error('step before open')
      const { state, stepCount } = trace.engine
      const result = state(k)
      setTimeout(() => {
        for (const d of prefetch) if (k + d >= 0 && k + d < stepCount) state(k + d)
      })
      return result
    },
    find(from: number, jump: Jump) {
      if (trace === null) throw new Error('find before open')
      return findStep(trace.steps, trace.engine.base, from, jump)
    },
  }
}

export type WorkerApi = ReturnType<typeof createWorkerApi>
