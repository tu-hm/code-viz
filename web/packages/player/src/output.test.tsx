import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { usePlayer } from './store.ts'
import { renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const counter = (step: number, of: number) => screen.findByText(`Step ${step} of ${of}`)

async function compareWith(expected: string, options: Parameters<typeof renderPlayer>[1] = {}) {
  const { stepCount } = renderPlayer('cpp-binary-search', options)
  await counter(1, stepCount)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Expected output' }), {
    target: { value: expected },
  })
}

test('the first wrong character leads to the step that printed it, where it is marked', async () => {
  await compareWith('7\n')
  expect(screen.getByText(/^First difference/).textContent).toBe(
    'First difference: line 1, char 1: expected "7", got "6". It was printed at step 19 (line 15).',
  )
  const output = within(screen.getByRole('region', { name: 'Stdout / Stderr' }))
  expect(output.queryByText(/differs at char/)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Jump to step 19' }))
  await counter(19, 20)
  expect(output.getByText(/differs at char/).textContent).toBe('  ◀ differs at char 1')
})

test('trailing spaces and line endings are ignored unless Exact is on', async () => {
  await compareWith('6  \r\n\r\n')
  expect(screen.getByText(/^Matches/).textContent).toBe(
    'Matches the expected output, ignoring trailing spaces and line endings.',
  )

  fireEvent.click(screen.getByRole('checkbox', { name: 'Exact' }))
  expect(screen.getByText(/^First difference/).textContent).toBe(
    'First difference: line 1, char 2: expected " ", got end of line. It was printed at step 19 (line 15).',
  )
})

test('output that ends early counts the missing lines and leads to the last print', async () => {
  await compareWith('6\n7\n8\n')
  expect(screen.getByText(/^Output ended early/).textContent).toBe(
    'Output ended early: 2 more lines expected. The last print was at step 19 (line 15).',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Jump to step 19' }))
  await counter(19, 20)
})

test('output printed after the last traced step is compared, with no step to jump to', async () => {
  await compareWith('6\n8\n', { tail: '7\n' })
  expect(screen.getByText(/^First difference/).textContent).toBe(
    'First difference: line 2, char 1: expected "8", got "7". It was printed after the last traced step, so no step shows it.',
  )
  expect(screen.queryByRole('button', { name: /^Jump to step/ })).toBeNull()
})

test('the problem’s sample output opens the compare filled in', async () => {
  const { stepCount } = renderPlayer('cpp-binary-search', { expected: '6\n' })
  await counter(1, stepCount)
  expect(screen.getByRole('checkbox', { name: 'Compare' })).toHaveProperty('checked', true)
  expect(screen.getByRole('textbox', { name: 'Expected output' })).toHaveProperty('value', '6\n')
  expect(screen.getByText(/^Matches/)).toBeDefined()
})

test('an empty paste box asks for the expected output', async () => {
  await compareWith('')
  expect(screen.getByText('Paste the expected output to compare.')).toBeDefined()
})
