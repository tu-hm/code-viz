import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Player } from './player.tsx'
import { usePlayer } from './store.ts'
import { cpp, renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const counter = (step: number, of: number) => screen.findByText(`Step ${step} of ${of}`)
const button = (name: string) => screen.getByRole('button', { name })

describe.each(fixtureNames)('%s', (name) => {
  test(
    'opens at the first step and walks to the last with the controls',
    { timeout: 30_000 },
    async () => {
      const { stepCount } = renderPlayer(name)
      await counter(1, stepCount)
      expect(screen.getByText(`Ready · ${stepCount.toLocaleString('en')} steps`, { exact: false }))
      expect(button('Previous step')).toHaveProperty('disabled', true)

      fireEvent.click(button('Next step'))
      await counter(2, stepCount)
      fireEvent.click(button('Last step'))
      await counter(stepCount, stepCount)
      expect(button('Next step')).toHaveProperty('disabled', true)
      fireEvent.click(button('Previous step'))
      await counter(stepCount - 1, stepCount)
      fireEvent.click(button('First step'))
      await counter(1, stepCount)
    },
  )

  test('the §5.9 keys step, jump and close', { timeout: 30_000 }, async () => {
    const { stepCount, onClose } = renderPlayer(name)
    await counter(1, stepCount)

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    await counter(2, stepCount)
    fireEvent.keyDown(document.body, { key: 'End' })
    await counter(stepCount, stepCount)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    await counter(stepCount - 1, stepCount)
    fireEvent.keyDown(document.body, { key: 'Home' })
    await counter(1, stepCount)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    await counter(1, stepCount)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  test(
    'the output panel holds everything printed up to the current step',
    { timeout: 30_000 },
    async () => {
      const { chunks } = loadFixture(name)
      const steps = chunks.flat()
      const { stepCount } = renderPlayer(name)
      await counter(1, stepCount)
      fireEvent.keyDown(document.body, { key: 'End' })
      await counter(stepCount, stepCount)

      const output = screen.getByRole('region', { name: 'Stdout / Stderr' })
      const printed = steps.map((s) => s.stdout + s.stderr).join('')
      expect(output.querySelector('pre')!.textContent).toBe(printed || '(nothing printed yet)')
    },
  )
})

test('typing in an input leaves the shortcuts alone', async () => {
  const { header, chunks, source } = loadFixture('python-aliasing')
  const onClose = () => {
    throw new Error('closed while typing')
  }
  render(
    <>
      <input aria-label="Notes" />
      <Player source={{ header, chunks }} code={source} stdin="" language={cpp} onClose={onClose} />
    </>,
  )
  await counter(1, 19)
  const notes = screen.getByRole('textbox', { name: 'Notes' })
  for (const key of ['ArrowRight', 'End', ' ', 'Escape']) fireEvent.keyDown(notes, { key })
  fireEvent.keyDown(document.body, { key: 'ArrowRight' })
  await counter(2, 19)
  expect(usePlayer.getState().playing).toBe(false)
})

test('the slider scrubs to a step', async () => {
  const { stepCount } = renderPlayer('cpp-dp-grid')
  await counter(1, stepCount)
  fireEvent.change(screen.getByRole('slider', { name: 'Step' }), { target: { value: '22' } })
  await counter(22, stepCount)
  expect(await screen.findByText(/line \d+ → \d+/)).toBeDefined()
})

test('?step= opens the player at that step and follows navigation', async () => {
  history.replaceState(null, '', '/?step=9')
  renderPlayer('python-aliasing')
  await counter(9, 19)
  expect(await screen.findByText('· call square(x=5)')).toBeDefined()

  fireEvent.click(button('Next step'))
  await counter(10, 19)
  await waitFor(() => expect(location.search).toBe('?step=10'))
})

test('closing drops ?step=, so the next trace opens at its first step', async () => {
  history.replaceState(null, '', '/?step=9')
  renderPlayer('python-aliasing')
  await counter(9, 19)
  cleanup()
  expect(location.search).toBe('')

  renderPlayer('python-aliasing')
  await counter(1, 19)
})

test.each([
  { name: 'past the last step clamps to it', search: '?step=500', want: 'Step 19 of 19' },
  { name: 'zero clamps to the first step', search: '?step=0', want: 'Step 1 of 19' },
])('?step= $name', async ({ search, want }) => {
  history.replaceState(null, '', `/${search}`)
  renderPlayer('python-aliasing')
  expect(await screen.findByText(want)).toBeDefined()
})

test('?step= that is not a number stops the player with the allowed range', async () => {
  history.replaceState(null, '', '/?step=nine')
  renderPlayer('python-aliasing')
  expect((await screen.findByRole('alert')).textContent).toContain(
    '?step=nine: want a step number from 1 to 19',
  )
})

test('stderr is red and the current step’s text is marked', async () => {
  const { stepCount } = renderPlayer('python-exception')
  await counter(1, stepCount)
  fireEvent.keyDown(document.body, { key: 'End' })
  await counter(stepCount, stepCount)
  const output = within(screen.getByRole('region', { name: 'Stdout / Stderr' }))
  const traceback = output.getByText(/IndexError: list index out of range/)
  expect(traceback.className).toContain('text-danger')
  expect(traceback.className).toContain('font-semibold')

  fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
  await counter(stepCount - 1, stepCount)
  expect(output.getByText('(nothing printed yet)')).toBeDefined()
})

test('stdin is shown read-only', async () => {
  const { stdin, stepCount } = renderPlayer('cpp-binary-search')
  await counter(1, stepCount)
  const panel = screen.getByRole('region', { name: 'Input' })
  expect(panel.querySelector('pre')!.textContent).toBe(stdin)
  expect(within(panel).queryByRole('textbox')).toBeNull()
})

test('binary search marks the read tokens and reaches 10 of 10', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  fireEvent.click(button('Last step'))
  await counter(20, 20)
  const input = within(screen.getByRole('region', { name: 'Input' }))
  await waitFor(() => expect(input.getByText('10 of 10 tokens read (inferred)')).toBeDefined())
  expect(input.queryAllByText(/\d+/, { selector: '[aria-current="true"]' })).toHaveLength(0)
  expect(input.getAllByText('13', { selector: 'span' })[0]!.className).toContain(
    'text-muted-foreground',
  )
  fireEvent.click(button('First step'))
  await counter(1, 20)
  fireEvent.click(button('Next step'))
  await counter(2, 20)
  await waitFor(() => expect(input.getByText('2 of 10 tokens read (inferred)')).toBeDefined())
  expect(input.getByText('13', { selector: '[aria-current="true"]' })).toBeDefined()
})

test('input markers show narration and jump to their step', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  const read = await screen.findByRole('button', { name: /^Input read at step 4:/ })
  fireEvent.focus(read)
  expect(screen.getByRole('tooltip').textContent).toMatch(/^Step 4: Read 8 tokens/)
  fireEvent.click(read)
  await counter(4, 20)
  expect(screen.getByRole('region', { name: 'Input' }).textContent).toContain(
    '10 of 10 tokens read',
  )
})

test('Python highlights the exact token read at this step', async () => {
  renderPlayer('python-aliasing')
  await counter(1, 19)
  fireEvent.click(button('Next step'))
  await counter(2, 19)
  fireEvent.click(button('Next step'))
  await counter(3, 19)
  fireEvent.click(button('Next step'))
  await counter(4, 19)
  const input = within(screen.getByRole('region', { name: 'Input' }))
  expect(input.getByText('1 of 1 tokens read')).toBeDefined()
  expect(input.getByText('5', { selector: '[aria-current="true"]' })).toBeDefined()
})

test('hovering the timeline narrates any step', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  await waitFor(() => expect(button('Story')).toHaveProperty('disabled', false))
  const slider = screen.getByRole('slider', { name: 'Step' })
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, width: 190 }))
  fireEvent.pointerMove(slider, { clientX: 100 })
  expect(screen.getByRole('tooltip').textContent).toMatch(/^Step 11: mid = 5/)
})

test('the narration and Story jump to a previous narrated step', async () => {
  renderPlayer('python-aliasing')
  await counter(1, 19)
  fireEvent.click(button('Last step'))
  await counter(19, 19)
  await waitFor(() => expect(button('Story')).toHaveProperty('disabled', false))
  fireEvent.click(button('Story'))
  const story = within(await screen.findByRole('dialog', { name: 'Story' }))
  expect(story.getAllByRole('listitem')).toHaveLength(19)
  fireEvent.click(story.getByRole('button', { name: '9 » Call square(x = 5)' }))
  await counter(9, 19)
  expect(screen.getByRole('paragraph', { name: 'Step narration' }).textContent).toBe(
    '» Call square(x = 5)',
  )
})

test('Story keeps the last 20 narrations', async () => {
  const { stepCount } = renderPlayer('cpp-dp-grid')
  await counter(1, stepCount)
  fireEvent.click(button('Last step'))
  await counter(stepCount, stepCount)
  await waitFor(() => expect(button('Story')).toHaveProperty('disabled', false))
  fireEvent.click(button('Story'))
  const story = within(await screen.findByRole('dialog', { name: 'Story' }))
  expect(story.getAllByRole('listitem')).toHaveLength(20)
  expect(story.getAllByRole('button')[0]!.textContent).toMatch(new RegExp(`^${stepCount - 19} »`))
})

test('a trace in a newer major format is refused with a reason', async () => {
  renderPlayer('python-aliasing', { header: { version: '2.0' } })
  expect((await screen.findByRole('alert')).textContent).toContain('needs a newer visualizer')
})

test('the divider resizes the panes from the keyboard', async () => {
  renderPlayer('python-aliasing')
  await counter(1, 19)
  const divider = screen.getByRole('separator', { name: 'Resize panes' })
  fireEvent.keyDown(divider, { key: 'ArrowRight' })
  expect(divider.getAttribute('aria-valuenow')).toBe('55')
  await counter(1, 19)
  expect(JSON.parse(localStorage.getItem('viz-player')!)).toMatchObject({ state: { split: 0.55 } })
})
