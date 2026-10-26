import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import type { spawnEngine } from './spawn-engine.ts'

afterEach(cleanup)

// jsdom has no Worker: serve the worker's API in-thread over a MessageChannel, so Comlink still clones
vi.mock('./spawn-engine.ts', async () => {
  const { expose, wrap } = await import('comlink')
  const { createWorkerApi } = await import('./worker-api.ts')
  const spawn: typeof spawnEngine = () => {
    const { port1, port2 } = new MessageChannel()
    expose(createWorkerApi(), port1)
    return {
      remote: wrap(port2),
      terminate: () => {
        port1.close()
        port2.close()
      },
    }
  }
  return { spawnEngine: spawn }
})

// jsdom has no Worker: lay graphs out in-thread with the bundled build's fake worker
vi.mock('./elk.ts', async () => {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  return { createElk: () => Object.assign(new ELK(), { terminateWorker: () => {} }) }
})

// jsdom can't fetch the grammars' ?url paths; under Node, Language.load reads a file path itself
vi.mock('./grammars.ts', async () => {
  const { createRequire } = await import('node:module')
  const { Language, Parser } = await import('web-tree-sitter')
  const require = createRequire(import.meta.url)
  const files = {
    cpp: 'tree-sitter-cpp/tree-sitter-cpp.wasm',
    python: 'tree-sitter-python/tree-sitter-python.wasm',
  }
  return {
    grammars: files,
    loadGrammar: async (grammar: keyof typeof files) => {
      await Parser.init()
      return Language.load(require.resolve(files[grammar]))
    },
  }
})

// jsdom has no matchMedia; the theme setting reads prefers-color-scheme through it
if (typeof window !== 'undefined') {
  window.matchMedia = (media: string) =>
    Object.assign(new EventTarget(), {
      matches: false,
      media,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })
}

// jsdom has no layout for ranges; CodeMirror measures text through them
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

// jsdom has no scrollIntoView; the state pane keeps the active frame in view with it
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom has no ResizeObserver; the arrow overlay redraws on resize with it
if (typeof window !== 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
