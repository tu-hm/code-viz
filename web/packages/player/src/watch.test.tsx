import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { usePlayer } from './store.ts'
import { python, renderPlayer } from './test-player.tsx'

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const counter = (step: number, of: number) => screen.findByText(`Step ${step} of ${of}`)
const button = (name: string) => screen.getByRole('button', { name })

async function openAt(name: string, step: number, language = {}) {
  history.replaceState(null, '', `/?step=${step}`)
  const { stepCount } = renderPlayer(name, language)
  await counter(step, stepCount)
  return stepCount
}

function watchPanel() {
  return within(screen.getByRole('region', { name: 'Watch' }))
}

async function pin(text: string) {
  fireEvent.click(watchPanel().getByRole('button', { name: '+ Pin' }))
  const form = within(await screen.findByRole('dialog', { name: 'Pin to watch' }))
  fireEvent.change(form.getByLabelText('Watch'), { target: { value: text } })
  fireEvent.click(form.getByRole('button', { name: 'Pin' }))
}

async function watchRow(name: string) {
  const header = await watchPanel().findByRole('rowheader', {
    name: new RegExp(`^${name}( auto)?$`),
  })
  return header.closest('tr')!
}

async function cells(name: string) {
  const row = await watchRow(name)
  return within(row)
    .getAllByRole('cell')
    .slice(0, 2)
    .map((c) => c.textContent)
}

test('pins at step 11 of the binary search match the §19.3 watch mock', async () => {
  await openAt('cpp-binary-search', 11)
  for (const name of ['l', 'r', 'mid', 'ans']) await pin(name)
  await vi.waitFor(async () => expect(await cells('ans')).toEqual(['-1', '-1 (unchanged)']))
  expect(await cells('l')).toEqual(['4', '0 → 4'])
  expect(await cells('r')).toEqual(['7', '7 (unchanged)'])
  expect(await cells('mid')).toEqual(['5* (changed)', '3 → 5'])
})

test('auto-watch adds the current line’s variables and drops them when the line changes', async () => {
  await openAt('cpp-binary-search', 11)
  await vi.waitFor(() => expect(watchPanel().getAllByText('auto')).toHaveLength(2))
  expect(await cells('mid')).toEqual(['5* (changed)', '3 → 5'])
  expect(await cells('x')).toEqual(['13', '13 (unchanged)'])

  fireEvent.click(button('Next step'))
  await counter(12, 20)
  await watchRow('l')
  expect(watchPanel().queryByRole('rowheader', { name: /^x( auto)?$/ })).toBeNull()
})

test('an auto row can be pinned and then stays after the line changes', async () => {
  await openAt('cpp-binary-search', 11)
  fireEvent.click(await watchPanel().findByRole('button', { name: 'Pin x' }))
  await watchPanel().findByRole('button', { name: 'Unpin x' })
  fireEvent.click(button('Next step'))
  await counter(12, 20)
  expect(await cells('x')).toEqual(['13', '13 (unchanged)'])
})

test('a pin out of scope is greyed as not in scope', async () => {
  await openAt('cpp-binary-search', 9)
  await pin('mid')
  expect(await cells('mid')).toEqual(['not in scope', ''])
})

test('a cell of an array can be pinned', async () => {
  await openAt('cpp-binary-search', 11)
  await pin('a[5]')
  await vi.waitFor(async () => expect(await cells('a\\[5\\]')).toEqual(['11', '0 → 11']))
})

test('a pin that is neither a variable nor a cell says what to enter', async () => {
  await openAt('cpp-binary-search', 11)
  await pin('a[i]')
  expect(await screen.findByText('Enter a variable or a cell such as a[2]')).toBeDefined()
})

test('pins last for the session, per visualization', async () => {
  await openAt('cpp-binary-search', 11)
  await pin('mid')
  await watchPanel().findByRole('button', { name: 'Unpin mid' })
  cleanup()

  await openAt('cpp-binary-search', 11)
  expect(await watchPanel().findByRole('button', { name: 'Unpin mid' })).toBeDefined()
  cleanup()

  await openAt('python-aliasing', 1, { language: python })
  expect(watchPanel().queryByRole('button', { name: 'Unpin mid' })).toBeNull()
})

test('Unpin removes the row and its lane', async () => {
  await openAt('cpp-binary-search', 11)
  await pin('r')
  await screen.findByRole('group', { name: 'Changes of r' })
  fireEvent.click(watchPanel().getByRole('button', { name: 'Unpin r' }))
  expect(screen.queryByRole('group', { name: 'Changes of r' })).toBeNull()
})

test('the context menu pins a local from its row', async () => {
  await openAt('cpp-binary-search', 11)
  const stack = within(screen.getByRole('region', { name: 'Stack' }))
  fireEvent.contextMenu(stack.getByRole('rowheader', { name: 'r' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Pin r to watch' }))
  expect(await cells('r')).toEqual(['7', '7 (unchanged)'])
})

test('the context menu pins one cell of an array', async () => {
  await openAt('cpp-binary-search', 11)
  const heap = within(screen.getByRole('region', { name: 'Heap' }))
  fireEvent.contextMenu(heap.getByText('[3]'))
  fireEvent.click(await screen.findByRole('button', { name: 'Pin a[3] to watch' }))
  await vi.waitFor(async () => expect(await cells('a\\[3\\]')).toEqual(['7', '0 → 7']))
})

test('a pinned variable’s lane marks each change and jumps to it', async () => {
  await openAt('cpp-binary-search', 1)
  await pin('l')
  const lane = within(await screen.findByRole('group', { name: 'Changes of l' }))
  const marks = await lane.findAllByRole('button')
  expect(marks.map((m) => m.getAttribute('aria-label')!.split(':')[0])).toEqual([
    'l set or changed at step 5',
    'l set or changed at step 9',
    'l set or changed at step 13',
  ])
  fireEvent.click(marks[1]!)
  await counter(9, 20)
})

test('Prev and Next change follow the selected lane', async () => {
  await openAt('cpp-binary-search', 11)
  await pin('l')
  await pin('mid')
  fireEvent.click(await screen.findByRole('button', { name: 'Lane mid' }))
  await screen.findByRole('group', { name: 'Changes of mid' })
  await vi.waitFor(() => expect(button('Next change of mid')).toHaveProperty('disabled', false))
  fireEvent.click(button('Prev change of mid'))
  await counter(7, 20)
  fireEvent.click(button('Next change of mid'))
  await counter(11, 20)
  fireEvent.click(button('Next change of mid'))
  await counter(15, 20)
  expect(button('Next change of mid')).toHaveProperty('disabled', true)
})

test.each([
  { name: 'a print', fixture: 'cpp-binary-search', label: 'Printed at step 19', want: 19 },
  {
    name: 'a call of the first function',
    fixture: 'cpp-fib-memo',
    label: 'Call of fib at step 5',
    want: 5,
  },
  { name: 'an error', fixture: 'python-exception', label: 'Error at step 6', want: 6 },
])('the timeline marks $name and jumps there', async ({ fixture, label, want }) => {
  const stepCount = await openAt(fixture, 1)
  const marker = await screen.findByRole('button', { name: new RegExp(`^${label}:`) })
  fireEvent.click(marker)
  await counter(want, stepCount)
})

test('a crowded timeline keeps one marker per slot', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe() {
        this.callback(
          [{ contentRect: DOMRect.fromRect({ width: 48 }) } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }
      disconnect() {}
    },
  )
  await openAt('cpp-binary-search', 1)
  await pin('l')
  const lane = within(await screen.findByRole('group', { name: 'Changes of l' }))
  const marks = await lane.findAllByRole('button')
  expect(marks.map((m) => [m.getAttribute('aria-label')!.split(':')[0], m.style.left])).toEqual([
    ['l set or changed at step 5', `${(0.5 / 3) * 100}%`],
    ['l set or changed at step 9, 1 more nearby', `${(1.5 / 3) * 100}%`],
  ])
})
