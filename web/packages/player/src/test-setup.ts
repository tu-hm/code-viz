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
