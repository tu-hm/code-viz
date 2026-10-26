import ELK from 'elkjs/lib/elk-api.js'
import workerUrl from 'elkjs/lib/elk-worker.min.js?url'

// its own worker: the bundled build sets self.onmessage, which would take the engine worker's messages
export function createElk() {
  return new ELK({ workerUrl })
}
