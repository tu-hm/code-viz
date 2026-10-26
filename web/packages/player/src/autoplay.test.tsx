import { act, fireEvent, screen } from '@testing-library/react'
import { loadFixture } from '@viz/fixtures'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { usePlayer } from './store.ts'
import { renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
})

const counter = (step: number, of: number) => screen.findByText(`Step ${step} of ${of}`)

async function tick(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

async function playUntilPaused(name: string, stepMs = 500) {
  const steps = loadFixture(name).chunks.flat().length
  for (let n = 0; n <= steps && usePlayer.getState().playing; n++) {
    const before = usePlayer.getState().step
    await tick(stepMs)
    if (usePlayer.getState().step !== before) await counter(usePlayer.getState().step + 1, steps)
  }
  return usePlayer.getState().step
}

test('1× moves two steps a second, and each speed scales it', async () => {
  const { stepCount } = renderPlayer('cpp-dp-grid')
  await counter(1, stepCount)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  await tick(499)
  expect(usePlayer.getState().step).toBe(0)
  await tick(1)
  await counter(2, stepCount)
  await tick(500)
  await counter(3, stepCount)

  act(() => usePlayer.getState().updateSettings({ autoplaySpeed: 4 }))
  await tick(125)
  await counter(4, stepCount)
  act(() => usePlayer.getState().updateSettings({ autoplaySpeed: 0.5 }))
  await tick(999)
  expect(usePlayer.getState().step).toBe(3)
  await tick(1)
  await counter(5, stepCount)
})

test('stops at the first error step', async () => {
  const { stepCount } = renderPlayer('python-exception')
  await counter(1, stepCount)
  const errorStep = loadFixture('python-exception')
    .chunks.flat()
    .findIndex((s) => s.error !== null)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(await playUntilPaused('python-exception')).toBe(errorStep)
  expect(screen.getByRole('button', { name: 'Play' })).toBeDefined()
})

test('play on an error step moves past it', async () => {
  const { stepCount } = renderPlayer('python-exception')
  await counter(1, stepCount)
  const errorSteps = loadFixture('python-exception')
    .chunks.flat()
    .flatMap((s) => (s.error !== null ? [s.i] : []))
  act(() => usePlayer.getState().go(errorSteps[0]!))
  await counter(errorSteps[0]! + 1, stepCount)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(await playUntilPaused('python-exception')).toBe(errorSteps[1])
})

test('stops at a breakpoint line', async () => {
  const steps = loadFixture('cpp-binary-search').chunks.flat()
  const { stepCount } = renderPlayer('cpp-binary-search')
  await counter(1, stepCount)
  const target = steps.findIndex((s, i) => i > 3 && s.line !== steps[0]!.line)
  act(() => {
    usePlayer.setState({ breakpoints: [steps[target]!.line] })
  })
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  const stopped = await playUntilPaused('cpp-binary-search')
  expect(stopped).toBe(steps.findIndex((s, i) => i > 0 && s.line === steps[target]!.line))
})

test('stops at the last step, and play there starts over', async () => {
  const { stepCount } = renderPlayer('python-aliasing')
  await counter(1, stepCount)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(await playUntilPaused('python-aliasing')).toBe(stepCount - 1)

  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  await counter(1, stepCount)
  expect(usePlayer.getState().playing).toBe(true)
})

test.each([
  { name: 'Next', act: () => fireEvent.click(screen.getByRole('button', { name: 'Next step' })) },
  { name: '→', act: () => fireEvent.keyDown(document.body, { key: 'ArrowRight' }) },
  { name: 'Home', act: () => fireEvent.keyDown(document.body, { key: 'Home' }) },
  {
    name: 'the slider',
    act: () =>
      fireEvent.change(screen.getByRole('slider', { name: 'Step' }), { target: { value: '7' } }),
  },
])('$name pauses autoplay', async ({ act: navigate }) => {
  const { stepCount } = renderPlayer('cpp-fib-memo')
  await counter(1, stepCount)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  await tick(500)
  await counter(2, stepCount)
  navigate()
  await tick(16)
  expect(await screen.findByRole('button', { name: 'Play' })).toBeDefined()
  const at = usePlayer.getState().step
  await tick(2000)
  expect(usePlayer.getState().step).toBe(at)
})

test('Space plays and pauses', async () => {
  const { stepCount } = renderPlayer('cpp-fib-memo')
  await counter(1, stepCount)
  fireEvent.keyDown(document.body, { key: ' ' })
  expect(await screen.findByRole('button', { name: 'Pause' })).toBeDefined()
  fireEvent.keyDown(document.body, { key: ' ' })
  expect(await screen.findByRole('button', { name: 'Play' })).toBeDefined()
})
