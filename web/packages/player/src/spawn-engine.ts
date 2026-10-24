import { wrap } from 'comlink'
import type { WorkerApi } from './worker-api.ts'

export function spawnEngine(onError: (e: Event) => void) {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('error', onError)
  return { remote: wrap<WorkerApi>(worker), terminate: () => worker.terminate() }
}
