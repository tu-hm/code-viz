import { callTree } from './calls.ts'
import type { Print } from './compare.ts'
import { ending } from './ending.ts'
import { createEngine } from './engine.ts'
import type { Step } from './gen/trace.ts'
import { loadTrace, type FileSource, type Manifest, type TraceSource } from './load.ts'
import { narrate } from './narration.ts'
import { callSteps, changeHistory, findStep, type Jump, type Target } from './search.ts'
import type { SourceFacts } from './source-facts.ts'

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
      calls: callSteps(steps),
      tree: callTree(steps),
      errors: steps.flatMap((s) => (s.error === null ? [] : [s.i])),
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
    async parse(code: string, languageId: string) {
      const { parseSource } = await import('./parse.ts')
      return parseSource(code, languageId)
    },
    narrate(stdin: string, facts: SourceFacts | null, languageId: string) {
      if (trace === null) throw new Error('narrate before open')
      return narrate(trace.steps, stdin, facts, languageId)
    },
    find(from: number, jump: Jump) {
      if (trace === null) throw new Error('find before open')
      return findStep(trace.steps, trace.engine.base, from, jump)
    },
    history(target: Target) {
      if (trace === null) throw new Error('history before open')
      return changeHistory(trace.steps, target)
    },
  }
}

export type WorkerApi = ReturnType<typeof createWorkerApi>
