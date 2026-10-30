import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { usePlayer } from './store.ts'
import { cpp, python, renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const counter = (step: number, of: number) => screen.findByText(`Step ${step} of ${of}`)
const code = () => screen.getByRole('textbox', { name: 'Code' })
const sourceLine = (name: string, n: number) => loadFixture(name).source.split('\n')[n - 1]!

function putCaret(line: number) {
  code().focus()
  document.getSelection()!.collapse(code().querySelectorAll('.cm-line')[line - 1]!, 0)
  document.dispatchEvent(new Event('selectionchange'))
}

describe.each(fixtureNames)('%s', (name) => {
  test('shows the source, labelling the line the first step runs next', async () => {
    const { stepCount } = renderPlayer(name)
    await counter(1, stepCount)
    const first = loadFixture(name).chunks[0]![0]!.line
    expect(code().textContent).toContain(`Line ${first}, runs next: ${sourceLine(name, first)}`)
    expect(screen.getByText('▷', { selector: '.cm-marks span' })).toBeDefined()
  })
})

test.each([
  {
    name: '§19.3 binary search, step 11',
    fixture: 'cpp-binary-search',
    step: 11,
    ran: 9,
    next: 10,
  },
  { name: '§5.3 call square(x=5)', fixture: 'python-aliasing', step: 9, ran: 9, next: 2 },
  { name: 'a return, which has no next line', fixture: 'python-aliasing', step: 10, ran: 2 },
])('$name marks the line just run and the next one', async ({ fixture, step, ran, next }) => {
  history.replaceState(null, '', `/?step=${step}`)
  const { stepCount } = renderPlayer(fixture)
  await counter(step, stepCount)
  const text = code().textContent
  expect(text).toContain(`Line ${ran}, just ran: ${sourceLine(fixture, ran)}`)
  if (next === undefined) expect(text).not.toContain('runs next')
  else expect(text).toContain(`Line ${next}, runs next: ${sourceLine(fixture, next)}`)
})

test('§5.6: the step that raised marks only the error line', async () => {
  const steps = loadFixture('python-exception').chunks.flat()
  const raised = steps.find((s) => s.error !== null)!
  history.replaceState(null, '', `/?step=${raised.i + 1}`)
  renderPlayer('python-exception')
  await counter(raised.i + 1, steps.length)
  const text = code().textContent
  expect(text).toContain(`Line 2, error: ${sourceLine('python-exception', 2)}`)
  expect(text).not.toContain('just ran')
  expect(text).not.toContain('runs next')
  expect(screen.getByText('!', { selector: '.cm-marks span' })).toBeDefined()
})

test('clicking a line number toggles its breakpoint', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  fireEvent.click(screen.getByText('9', { selector: '.cm-lineNumbers span' }))
  expect(usePlayer.getState().breakpoints).toEqual([9])
  await waitFor(() => expect(code().textContent).toContain('Line 9, breakpoint: '))
  expect(screen.getByText(/^Breakpoint on line 9 stops autoplay/).textContent).toContain(
    '“Start tracing from line…” offers them on the next run',
  )

  fireEvent.click(screen.getByText('9', { selector: '.cm-lineNumbers span' }))
  expect(usePlayer.getState().breakpoints).toEqual([])
  await screen.findByText('Click a line number, or press Enter on a line, to set a breakpoint.')
})

test('Enter toggles a breakpoint on the caret’s line, and the step keys still step', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  putCaret(10)
  fireEvent.keyDown(code(), { key: 'Enter' })
  putCaret(13)
  fireEvent.keyDown(code(), { key: 'Enter' })
  expect(usePlayer.getState().breakpoints).toEqual([10, 13])
  await screen.findByText(/^Breakpoints on lines 10, 13 stop autoplay/)

  fireEvent.keyDown(code(), { key: 'ArrowRight' })
  await counter(2, 20)
  fireEvent.keyDown(code(), { key: 'End' })
  await counter(20, 20)
})

test('breakpoints stay with their trace', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  fireEvent.click(screen.getByText('9', { selector: '.cm-lineNumbers span' }))
  cleanup()
  renderPlayer('cpp-dp-grid')
  await counter(1, 38)
  expect(usePlayer.getState().breakpoints).toEqual([])
})

test('hit counts tint the hottest lines and show their share on hover and focus', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  const hottest = screen.getByText('×9', { selector: '.cm-hits span' })
  expect(hottest.className).toContain('bg-trace-heat/40')
  expect(screen.getByText('×2', { selector: '.cm-hits span' }).className).not.toContain('heat')

  fireEvent.mouseEnter(hottest)
  expect(await screen.findByText('ran 9 times · 35% of all lines run')).toBeDefined()
  fireEvent.mouseLeave(hottest)
  await waitFor(() => expect(screen.queryByText(/^ran \d+ times/)).toBeNull())

  putCaret(4)
  expect(await screen.findByText('ran once · 4% of all lines run')).toBeDefined()
})

test('a click in the code does not leave the share over the line above', async () => {
  renderPlayer('cpp-binary-search')
  await counter(1, 20)
  putCaret(4)
  expect(await screen.findByText('ran once · 4% of all lines run')).toBeDefined()

  const view = EditorView.findFromDOM(code())!
  act(() => {
    view.dispatch({
      selection: { anchor: view.state.doc.line(6).from },
      userEvent: 'select.pointer',
    })
  })
  await waitFor(() => expect(screen.queryByText(/^ran \d+ times|^ran once/)).toBeNull())
})

test('lines that all ran equally often get no tint', async () => {
  renderPlayer('python-exception')
  await counter(1, 9)
  for (const once of screen.getAllByText('×1', { selector: '.cm-hits span' })) {
    expect(once.className).not.toContain('heat')
  }
})

test('hit counts from the recorded steps say so', async () => {
  const { summary } = loadFixture('cpp-binary-search').header
  renderPlayer('cpp-binary-search', {
    header: { summary: { ...summary, lineHitsSource: 'trace' } },
  })
  await counter(1, 20)
  expect(screen.getByText('Hit counts (×n) cover the recorded steps only.')).toBeDefined()
  fireEvent.mouseEnter(screen.getByText('×9', { selector: '.cm-hits span' }))
  expect(
    await screen.findByText('ran 9 times · 35% of all lines run · recorded steps only'),
  ).toBeDefined()
})

test('a trace without line hits has no hit-count column', async () => {
  renderPlayer('synthetic-1000')
  await counter(1, 1000)
  expect(screen.queryByText(/^×\d/)).toBeNull()
  expect(screen.queryByText(/recorded steps only/)).toBeNull()
})

test.each([
  { fixture: 'cpp-binary-search', language: cpp, keyword: 'while', string: '"\\n"' },
  { fixture: 'python-aliasing', language: python, keyword: 'def', string: '"k"' },
])('$language.displayName gets keyword and string colours', async (c) => {
  const { stepCount } = renderPlayer(c.fixture, { language: c.language })
  await counter(1, stepCount)
  expect(await screen.findByText(c.keyword, { selector: '.text-syntax-keyword' })).toBeDefined()
  expect(screen.getAllByText(c.string, { selector: '.text-syntax-string' })).not.toHaveLength(0)
})

test('an editor mode the player has no highlighter for shows plain text', async () => {
  renderPlayer('cpp-binary-search', { language: { ...cpp, editorMode: 'golang' } })
  await counter(1, 20)
  expect(code().textContent).toContain('while (l <= r) {')
  expect(code().querySelector('[class*="text-syntax"]')).toBeNull()
  expect(screen.queryByText(/Syntax highlighting didn’t load/)).toBeNull()
})

test('a language pack that fails to load leaves plain text and says so', async () => {
  vi.doMock('@codemirror/lang-python', () => Promise.reject(new Error('chunk failed')))
  renderPlayer('python-aliasing', { language: python })
  await counter(1, 19)
  expect(
    await screen.findByText('Syntax highlighting didn’t load, so the code is shown as plain text.'),
  ).toBeDefined()
  expect(code().textContent).toContain('def square(x):')
  vi.doUnmock('@codemirror/lang-python')
})
