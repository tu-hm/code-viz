import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { LoopPasses } from './loop-passes.tsx'
import { usePlayer } from './store.ts'
import { renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const passes = Array.from({ length: 8 }, (_, k) => 10 + 5 * k)
const chips = () =>
  screen.getByRole('navigation', { name: 'Passes of the loop on line 6' }).textContent

test.each([
  { name: 'before the first pass: 1 2 3 … 8', step: 2, want: 'pass123…8' },
  { name: 'in pass 5: its neighbours too', step: 31, want: 'pass123456…8' },
  { name: 'in the last pass', step: 46, want: 'pass123…78' },
])('$name', ({ step, want }) => {
  render(<LoopPasses line={6} passes={passes} step={step} onGo={vi.fn<(step: number) => void>()} />)
  expect(chips()).toBe(want)
})

test('a chip jumps to the step its pass starts on, and marks the current one', () => {
  const onGo = vi.fn<(step: number) => void>()
  render(<LoopPasses line={6} passes={passes} step={31} onGo={onGo} />)
  expect(screen.getByRole('button', { name: 'Pass 5 of 8' }).getAttribute('aria-current')).toBe(
    'step',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Pass 8 of 8' }))
  expect(onGo).toHaveBeenCalledWith(45)
})

test('in the player: cpp-binary-search on its while line offers three passes', async () => {
  history.replaceState(null, '', '/?step=13')
  renderPlayer('cpp-binary-search')
  const nav = await screen.findByRole('navigation', { name: 'Passes of the loop on line 8' })
  fireEvent.click(within(nav).getByRole('button', { name: 'Pass 3 of 3' }))
  await screen.findByText('Step 14 of 20')
  act(() => usePlayer.getState().go(0))
  await screen.findByText('Step 1 of 20')
  expect(screen.queryByRole('navigation', { name: /^Passes/ })).toBeNull()
})
