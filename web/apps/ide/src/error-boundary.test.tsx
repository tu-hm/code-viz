import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { PlayerErrorBoundary } from './error-boundary.tsx'

function Broken(): never {
  throw new Error('render failed')
}

test('a crash inside the player shows the fallback with the trace ID', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <PlayerErrorBoundary traceId="trc_8c1f4e2a9b7d6c35">
      <Broken />
    </PlayerErrorBoundary>,
  )
  expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
  expect(screen.getByText('Trace ID: trc_8c1f4e2a9b7d6c35')).toBeDefined()
})
