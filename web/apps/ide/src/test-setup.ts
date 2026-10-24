import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// jsdom has no layout for ranges; CodeMirror measures text through them
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

// jsdom has no reportError; rethrow, so vitest fails on what a browser would report
if (typeof window !== 'undefined') {
  window.reportError = (e: unknown) => {
    throw e
  }
}
