import { act, fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import type { LanguageInfo } from './player.tsx'
import { usePlayer } from './store.ts'
import { python, renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

async function openAt(name: string, step: number, language?: LanguageInfo) {
  renderPlayer(name, { language })
  await screen.findByText(/^Step 1 of/)
  act(() => usePlayer.getState().go(step - 1))
  await screen.findByText(new RegExp(`^Step ${step} of`))
}

const tree = () => screen.getByRole('list', { name: 'Call tree' })

test('cpp-fib-memo step 26: the tree, the active call and the footer', async () => {
  await openAt('cpp-fib-memo', 26)
  const items = within(tree()).getAllByRole('listitem')
  expect(items.map((li) => li.textContent)).toEqual([
    'fib(5) …still running',
    '├─ fib(4) → 3',
    '│  ├─ fib(3) → 2',
    '│  │  ├─ fib(2) → 1',
    '│  │  │  ├─ fib(1) → 1',
    '│  │  │  └─ fib(0) → 0',
    '│  │  └─ fib(1) → 1 ↺ repeated',
    '│  └─ fib(2) → 1 ↺ repeated',
    '└─ fib(3) …still running ↺ repeated · ▶ active (line 7)',
  ])
  expect(screen.getByText('depth 2 now · max depth 5 · 9 calls so far')).toBeDefined()
})

test('a click goes to the call, Shift-click and the return value to the return', async () => {
  await openAt('cpp-fib-memo', 26)
  const fib4 = within(tree()).getByRole('button', { name: 'fib(4)' })
  fireEvent.click(fib4)
  await screen.findByText(/^Step 5 of/)
  fireEvent.click(within(tree()).getByRole('button', { name: 'fib(4)' }), { shiftKey: true })
  await screen.findByText(/^Step 25 of/)
  fireEvent.click(within(tree()).getByRole('button', { name: 'fib returns 1: go to step 15' }))
  await screen.findByText(/^Step 15 of/)
})

test('Stack lists the frames innermost last, with the active one marked', async () => {
  await openAt('cpp-fib-memo', 26)
  fireEvent.click(screen.getByRole('button', { name: 'Stack' }))
  const frames = within(screen.getByRole('list', { name: 'Stack, innermost last' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
  expect(frames).toEqual(['main()line 13', 'fib(5)line 9', 'fib(3)line 7▶ active'])
})

test('Stack folds the middle of more than 20 frames', async () => {
  await openAt('python-recursion', 25, python)
  fireEvent.click(screen.getByRole('button', { name: 'Stack' }))
  const frames = within(screen.getByRole('list', { name: 'Stack, innermost last' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
  expect(frames).toHaveLength(21)
  expect(frames[0]).toMatch(/^<module>\(\)/)
  expect(frames[10]).toBe('… 2 more frames')
  expect(frames.at(-1)).toMatch(/^down\(20\)line \d+▶ active$/)
})

test('Python: the module is the root, calls hang from it', async () => {
  await openAt('python-recursion', 6, python)
  expect(
    within(tree())
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['down(0) …still running', '└─ down(1) …still running ▶ active (line 7)'])
})

test('a run without calls has no Calls panel', async () => {
  renderPlayer('cpp-binary-search')
  await screen.findByText(/^Step 1 of/)
  expect(screen.queryByRole('heading', { name: 'Calls' })).toBeNull()
})
