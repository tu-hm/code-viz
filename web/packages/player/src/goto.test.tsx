import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { shortcuts } from './goto.ts'
import { usePlayer } from './store.ts'
import { renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

afterEach(() => {
  vi.useRealTimers()
})

const counter = (step: number, of: number) => screen.findByText(`Step ${step} of ${of}`)
const press = (key: string, shiftKey = false) => fireEvent.keyDown(document.body, { key, shiftKey })

async function openAt(name: string, step: number) {
  history.replaceState(null, '', `/?step=${step}`)
  const { stepCount } = renderPlayer(name)
  await counter(step, stepCount)
  return stepCount
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Go to…' }))
  return within(await screen.findByRole('dialog', { name: 'Go to' }))
}

test('Shift + → steps over the call a line makes', async () => {
  await openAt('python-aliasing', 8)
  press('ArrowRight', true)
  await counter(11, 19)
})

test('Shift + ↑ steps out of a call', async () => {
  await openAt('cpp-fib-memo', 6)
  press('ArrowUp', true)
  await counter(26, 32)
})

test('Shift-click on Next steps over', async () => {
  await openAt('python-aliasing', 8)
  fireEvent.click(screen.getByRole('button', { name: 'Next step' }), { shiftKey: true })
  await counter(11, 19)
})

test.each([
  { name: 'P goes to the next print', key: 'p', fixture: 'cpp-binary-search', from: 1, want: 19 },
  { name: 'E goes to the error step', key: 'e', fixture: 'python-exception', from: 1, want: 6 },
  { name: 'F goes to the next call', key: 'f', fixture: 'cpp-fib-memo', from: 1, want: 2 },
  { name: 'capitals work too', key: 'P', fixture: 'cpp-binary-search', from: 1, want: 19 },
])('$name', async ({ key, fixture, from, want }) => {
  const stepCount = await openAt(fixture, from)
  press(key)
  await counter(want, stepCount)
})

test('L goes to the next breakpoint when no line is entered', async () => {
  await openAt('cpp-binary-search', 6)
  act(() => {
    usePlayer.setState({ breakpoints: [8] })
  })
  press('l')
  await counter(9, 20)
})

test('C goes to the next change of the variable entered in Go to…', async () => {
  await openAt('cpp-binary-search', 7)
  const menu = await openMenu()
  fireEvent.change(menu.getByRole('combobox', { name: 'Variable or cell' }), {
    target: { value: 'mid' },
  })
  press('Escape')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  press('c')
  await counter(11, 20)
})

test('D goes to the step that printed the first wrong character', async () => {
  await openAt('cpp-binary-search', 1)
  act(() => {
    usePlayer.setState({ expected: '7\n' })
  })
  press('d')
  await counter(19, 20)
})

test('a jump with nothing after the current step says so instead of doing nothing', async () => {
  await openAt('cpp-binary-search', 20)
  press('p')
  expect((await screen.findByRole('status')).textContent).toBe(
    'Next print to output: not found after step 20',
  )
  expect(usePlayer.getState().step).toBe(19)
})

test('a jump that needs a value says what to enter', async () => {
  await openAt('cpp-binary-search', 1)
  press('c')
  expect((await screen.findByRole('status')).textContent).toBe(
    'Next change: enter a variable, a cell such as a[2], or an array',
  )
})

test('the notice goes away when the student moves, or after 4 s', async () => {
  await openAt('cpp-binary-search', 20)
  press('p')
  const status = await screen.findByRole('status')
  await waitFor(() => expect(status.textContent).not.toBe(''))
  press('ArrowLeft')
  await counter(19, 20)
  expect(status.textContent).toBe('')

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  act(() => {
    usePlayer.setState({ notice: 'Error step: not found after step 19' })
  })
  await act(() => vi.advanceTimersByTimeAsync(3999))
  expect(status.textContent).not.toBe('')
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(status.textContent).toBe('')
})

test('the Go to… menu lists every jump with its shortcut, and disables the ones with no match', async () => {
  await openAt('cpp-binary-search', 1)
  const menu = await openMenu()
  for (const keys of [...Object.values(shortcuts), '→ / ←']) expect(menu.getByText(keys))

  const entry = (name: string) => menu.getByRole('button', { name })
  await waitFor(() => expect(entry('Error step')).toHaveProperty('disabled', true))
  for (const name of [
    'Step out',
    'Next time a line runs',
    'Next change',
    'Next call',
    'First difference from expected output',
  ]) {
    expect(entry(name), name).toHaveProperty('disabled', true)
  }
  expect(entry('Step over')).toHaveProperty('disabled', false)
  expect(entry('Next print to output')).toHaveProperty('disabled', false)
})

test('typing a line number checks whether that line runs again', async () => {
  await openAt('cpp-binary-search', 13)
  const menu = await openMenu()
  const line = menu.getByRole('textbox', { name: 'Line number' })

  fireEvent.change(line, { target: { value: '9' } })
  const entry = await menu.findByRole('button', { name: 'Next time line 9 runs' })
  await waitFor(() => expect(entry).toHaveProperty('disabled', false))
  fireEvent.change(line, { target: { value: '4' } })
  const gone = await menu.findByRole('button', { name: 'Next time line 4 runs' })
  await waitFor(() => expect(gone).toHaveProperty('disabled', true))
})

test('a menu entry jumps and closes the menu', async () => {
  await openAt('python-aliasing', 6)
  const menu = await openMenu()
  fireEvent.change(menu.getByRole('combobox', { name: 'Variable or cell' }), {
    target: { value: 'b' },
  })
  const entry = await menu.findByRole('button', { name: 'Next change of b' })
  await waitFor(() => expect(entry).toHaveProperty('disabled', false))
  fireEvent.click(entry)
  await counter(8, 19)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('the function list offers every function the run calls', async () => {
  await openAt('cpp-fib-memo', 1)
  const menu = await openMenu()
  const select = menu.getByRole('combobox', { name: 'Function' })
  expect(
    within(select)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['fib'])
  fireEvent.click(menu.getByRole('button', { name: 'Next call of fib' }))
  await counter(2, 32)
})
