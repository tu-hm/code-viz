import { fireEvent, render, screen, within } from '@testing-library/react'
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createEngine, type StepState } from './engine.ts'
import type { Frame, HeapObject, Local } from './gen/trace.ts'
import { StatePane } from './state-pane.tsx'
import { usePlayer, type Settings, type ViewAs } from './store.ts'
import { renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

type Options = {
  settings?: Partial<Pick<Settings, 'showInternals' | 'showUnreachable' | 'highlightChanges'>>
  views?: Record<string, ViewAs>
  onShowRange?: (variable: string) => void
}

const engines = new Map<string, ReturnType<typeof createEngine>>()

function stateAt(name: string, step: number) {
  let engine = engines.get(name)
  if (!engine) {
    engine = createEngine(loadFixture(name).chunks.flat())
    engines.set(name, engine)
  }
  return engine.state(step - 1)
}

function paneProps(state: StepState, languageId: string, options: Options = {}) {
  return {
    state,
    languageId,
    pointers: languageId.startsWith('cpp'),
    settings: {
      showInternals: false,
      showUnreachable: false,
      highlightChanges: true,
      ...options.settings,
    },
    views: options.views ?? {},
    onShowInternals: vi.fn<() => void>(),
    onFrameLine: vi.fn<(line: number) => void>(),
    onView: vi.fn<(variable: string, view: ViewAs) => void>(),
    onShowRange: options.onShowRange,
  }
}

function renderStep(name: string, step: number, options: Options = {}) {
  const props = paneProps(stateAt(name, step), loadFixture(name).header.language.id, options)
  const view = render(<StatePane {...props} />)
  return { ...props, ...view }
}

function renderState(state: StepState, languageId: string, options: Options = {}) {
  const props = paneProps(state, languageId, options)
  render(<StatePane {...props} />)
  return props
}

const frameTable = (name: string | RegExp) => screen.getByRole('table', { name })
const card = (id: string) => screen.getByRole('article', { name: new RegExp(`^#${id} `) })
const cardIds = () =>
  screen.queryAllByRole('article').map((a) => a.querySelector('h3')!.textContent.split(' ')[0])

function rows(table: HTMLElement) {
  return within(table)
    .getAllByRole('row')
    .map((r) =>
      [...r.children]
        .map((cell) =>
          cell.textContent
            .replace(/points to /g, '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .join(' '),
    )
}

function stepState(
  stack: Frame[],
  heap: Record<string, HeapObject>,
  rest: Partial<StepState> = {},
) {
  return {
    i: 0,
    event: 'line',
    prevLine: null,
    line: 1,
    error: null,
    stack,
    heap,
    changed: { locals: {}, cells: {} },
    newObjects: [],
    output: [],
    ...rest,
  } satisfies StepState
}

const frame = (locals: Local[], name = 'main', kind: Frame['kind'] = 'function'): Frame => ({
  id: `f-${name}`,
  name,
  kind,
  line: 3,
  locals,
  returnValue: null,
})
const ref = (name: string, id: string): Local => ({ name, value: { t: 'ref', id } })
const int = (v: number) => ({ t: 'int', v: String(v) })

const html = (el: Element) => el.innerHTML.replace(/(id|aria-labelledby)="[^"]*"/g, '$1=""')

function walkOrder(stepCount: number) {
  const reach = stepCount > 1000 ? 3 : stepCount > 100 ? 8 : stepCount
  const forward = Array.from({ length: reach }, (_, k) => k + 1)
  const jumps = Array.from({ length: Math.min(reach, 10) }, (_, k) => 1 + ((k * 7919) % stepCount))
  return [...forward, ...forward.toReversed(), ...jumps]
}

function sampled(stepCount: number) {
  if (stepCount <= 100) return Array.from({ length: stepCount }, (_, k) => k + 1)
  return [1, 2, 51, Math.ceil(stepCount / 2), stepCount]
}

describe.each(fixtureNames)('%s', (name) => {
  const steps = loadFixture(name).chunks.flat()

  test(
    'every step is readable: a table per frame, and a card behind every reference',
    { timeout: 30_000 },
    () => {
      for (const step of sampled(steps.length)) {
        const { unmount } = renderStep(name, step)
        const state = stateAt(name, step)
        const tables = screen.getAllByRole('table').filter((t) => t.querySelector('caption'))
        expect(
          tables.map((t) => t.querySelector('caption button')!.textContent.split(' · ')[0]),
          `step ${step}`,
        ).toEqual(state.stack.map((f) => (f.kind === 'global' ? 'Globals' : `${f.name}()`)))
        const ids = new Set(cardIds())
        for (const label of screen.queryAllByText('points to')) {
          const id = /#(\w+)/.exec(label.parentElement!.textContent)![1]!
          expect(ids.has(`#${id}`), `step ${step}: #${id} has no card`).toBe(true)
        }
        expect(document.body.textContent).not.toMatch(/undefined|\[object Object\]|NaN/)
        unmount()
      }
    },
  )

  test(
    'stepping in place draws what a fresh render of each step draws',
    { timeout: 30_000 },
    () => {
      const props = paneProps(stateAt(name, 1), loadFixture(name).header.language.id)
      const { container, rerender } = render(<StatePane {...props} />)
      for (const step of walkOrder(steps.length)) {
        rerender(<StatePane {...props} state={stateAt(name, step)} />)
        const fresh = render(<StatePane {...props} state={stateAt(name, step)} />)
        expect(html(container), `step ${step}`).toBe(html(fresh.container))
        fresh.unmount()
      }
    },
  )
})

test('stepping the player draws each step as a fresh render of it does', async () => {
  const name = 'cpp-edge-list'
  const { stepCount } = renderPlayer(name)
  await screen.findByText(`Step 1 of ${stepCount}`)
  const pane = () =>
    screen.getAllByRole('region', { name: 'Stack' })[0]!.parentElement!.parentElement!
  for (const step of walkOrder(stepCount)) {
    fireEvent.change(screen.getByRole('slider', { name: 'Step' }), { target: { value: step } })
    await screen.findByText(`Step ${step} of ${stepCount}`)
    const live = html(pane())
    const fresh = render(<StatePane {...paneProps(stateAt(name, step), 'cpp17-gcc')} />)
    expect(live, `step ${step}`).toBe(html(fresh.container.firstElementChild!))
    fresh.unmount()
  }
})

describe('§5.3 Python mock, step 9: call square(x=5)', () => {
  test('globals alias #o2 through a and b, and the call frame is active with x changed', () => {
    renderStep('python-aliasing', 9)
    expect(rows(frameTable(/^Globals/))).toEqual([
      'square ●──▶ #o1',
      'n 5',
      'a ●──▶ #o2',
      'b ●──▶ #o2',
      'c ●──▶ #o3',
    ])
    expect(rows(frameTable(/^square\(\)/))).toEqual(['x 5* (changed)'])
    expect(frameTable(/^square\(\)/).closest('div')!.parentElement!.textContent).toContain(
      '▲ active frame',
    )
  })

  test('cards come in first-seen order and list who points at them', () => {
    renderStep('python-aliasing', 9)
    expect(cardIds()).toEqual(['#o1', '#o2', '#o3'])
    expect(card('o1').textContent).toContain('square(x)')
    expect(within(card('o2')).getByRole('heading').textContent).toBe('#o2 list · len 4  ◀from a, b')
    expect(
      within(card('o2'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['[0] 10', '[1] 21', '[2] 32', '[3] 53'])
    expect(within(card('o3')).getByRole('heading').textContent).toContain('◀from c')
  })
})

describe('§5.4 C++ mock', () => {
  test('step 7: depth[3] = 7 is marked, and the rest of the global array is counted', () => {
    renderStep('cpp-pointers', 7)
    expect(rows(frameTable(/^Globals/))).toEqual(['MAXN 200005', 'depth ●──▶ #o1'])
    const depth = card('o1')
    expect(within(depth).getByRole('heading').textContent).toContain(
      '#o1 int [200005] · size 200,005',
    )
    expect(within(depth).getByText('[3]').parentElement!.textContent).toBe('[3] 7* (changed)')
    expect(depth.textContent).toContain('… +199,989')
  })

  test('step 6: head points to #o4, whose next points to #o5; #o5.next is null', () => {
    renderStep('cpp-pointers', 6)
    expect(rows(frameTable(/^main\(\)/))).toEqual(['v ●──▶ #o2', 'cnt ●──▶ #o3', 'head ●──▶ #o4'])
    expect(within(card('o2')).getByRole('heading').textContent).toContain(
      '#o2 vector<int> · size 3 · cap 3',
    )
    expect(rows(within(card('o3')).getByRole('table'))).toEqual(['"ab" 2'])
    expect(rows(within(card('o4')).getByRole('table'))).toEqual([
      'val 1',
      'next ●──▶ #o5* (changed)',
    ])
    expect(rows(within(card('o5')).getByRole('table'))).toEqual(['val 2', 'next ∅null pointer'])
    expect(within(card('o5')).getByRole('heading').textContent).toContain('◀from #o4.next')
  })
})

test('with "Highlight changed values" off, nothing is marked', () => {
  renderStep('python-aliasing', 9, { settings: { highlightChanges: false } })
  expect(screen.queryByText('(changed)')).toBeNull()
  expect(screen.queryByText('* changed since the previous step')).toBeNull()
})

test('a variable not set yet is greyed with a tooltip', () => {
  renderStep('cpp-edge-list', 1)
  const unset = within(frameTable(/^main\(\)/)).getByText('not set yet').parentElement!
  expect(unset.className).toContain('text-trace-unset')
  expect(unset.title).toBe('int · not set yet')
})

test('a value that could not be read is greyed with the reason', () => {
  renderState(
    stepState([frame([ref('node', 'o1')])], {
      o1: {
        kind: 'record',
        type: 'Node',
        fields: [{ name: 'cache', value: { t: 'unavailable', reason: 'optimized_out' } }],
      },
    }),
    'cpp17-gcc',
  )
  const unread = within(card('o1')).getByText("couldn't read").parentElement!
  expect(unread.className).toContain('text-trace-unset')
  expect(unread.title).toBe("couldn't read: optimized out")
})

describe('internals (FR-23)', () => {
  test('hidden by default, counted per frame, with their objects', () => {
    const { onShowInternals } = renderStep('cpp-edge-list', 10)
    expect(rows(frameTable(/^main\(\)/)).map((r) => r.split(' ')[0])).toEqual([
      'n',
      'edges',
      'roads',
      'total',
      'e',
    ])
    expect(screen.getByText(/hidden: 3 internals/)).toBeDefined()
    expect(cardIds()).not.toContain('#o16')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(onShowInternals).toHaveBeenCalledOnce()
  })

  test('shown, they join their frame and nothing is counted', () => {
    renderStep('cpp-edge-list', 10, { settings: { showInternals: true } })
    expect(rows(frameTable(/^main\(\)/)).map((r) => r.split(' ')[0])).toEqual([
      'n',
      'edges',
      'roads',
      'total',
      '__for_begin',
      '__for_end',
      '__for_range',
      'e',
    ])
    expect(screen.queryByText(/hidden:/)).toBeNull()
    expect(cardIds()).toEqual(expect.arrayContaining(['#o16', '#o17']))
  })
})

test('an object nothing reaches shows only with "Show unreachable objects"', () => {
  const state = stepState([frame([ref('a', 'o1')])], {
    o1: { kind: 'sequence', type: 'list', length: 0, items: [] },
    o2: { kind: 'sequence', type: 'list', length: 1, items: [int(7)] },
  })
  renderState(state, 'python3')
  expect(cardIds()).toEqual(['#o1'])
  screen.getByRole('article').remove()
  renderState(state, 'python3', { settings: { showUnreachable: true } })
  expect(within(card('o2')).getByRole('heading').textContent).toBe('#o2 list · len 1 · unreachable')
})

test('a kind the player does not know draws as an opaque card', () => {
  renderState(
    stepState([frame([ref('g', 'o1'), ref('K', 'o2')])], {
      o1: { kind: 'graph', type: 'Graph' },
      o2: { kind: 'class', name: 'Slot' },
    }),
    'python3',
  )
  expect(card('o1').textContent).toContain('graph object')
  expect(within(card('o2')).getByRole('heading').textContent).toContain('#o2 class')
  expect(card('o2').textContent).toContain('Slot')
})

describe('a windowed sequence', () => {
  const state = stepState([frame([ref('xs', 'o1')], '<module>', 'global')], {
    o1: {
      kind: 'sequence',
      type: 'list',
      length: 3000,
      truncated: true,
      window: { start: 2495, count: 3 },
      items: [int(2495), int(2496), int(2497)],
    },
  })

  test('counts what it skips on both sides and asks for a range by variable', () => {
    const onShowRange = vi.fn<(variable: string) => void>()
    renderState(state, 'python3', { onShowRange })
    expect(
      within(card('o1'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['… +2,495', '[2495] 24952495', '[2496] 24962496', '[2497] 24972497', '… +502'])
    fireEvent.click(screen.getByRole('button', { name: 'Show range…' }))
    expect(onShowRange).toHaveBeenCalledWith('xs')
  })

  test('offers no range without a host that can re-run', () => {
    renderState(state, 'python3')
    expect(screen.queryByRole('button', { name: 'Show range…' })).toBeNull()
  })
})

test('a new object fades in on the step it appears, not after', () => {
  const { unmount } = renderStep('python-aliasing', 5)
  expect(card('o2').className).toContain('starting:opacity-0')
  unmount()
  renderStep('python-aliasing', 6)
  expect(card('o2').className).not.toContain('starting:opacity-0')
})

test('the active frame scrolls into view when a call or return changes it', () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  const scrolled = () =>
    scroll.mock.contexts.map((c) => (c instanceof Element ? c.textContent : ''))
  const props = paneProps(stateAt('python-aliasing', 8), 'python3')
  const { rerender } = render(<StatePane {...props} />)
  expect(scrolled().at(-1)).toContain('Globals')
  scroll.mockClear()
  rerender(<StatePane {...props} state={stateAt('python-aliasing', 9)} />)
  expect(scrolled()).toHaveLength(1)
  expect(scrolled()[0]).toContain('square()')
  rerender(<StatePane {...props} state={stateAt('python-aliasing', 10)} />)
  expect(scrolled()).toHaveLength(1)
})

test('a frame title asks the code pane for its line', () => {
  const { onFrameLine } = renderStep('python-aliasing', 9)
  fireEvent.click(screen.getByRole('button', { name: /^Globals/ }))
  expect(onFrameLine).toHaveBeenCalledWith(9)
})

test('in the player, a frame title puts the code pane’s caret on that frame’s line', async () => {
  history.replaceState(null, '', '/?step=9')
  renderPlayer('python-aliasing')
  await screen.findByText('Step 9 of 19')
  fireEvent.click(screen.getByRole('button', { name: /^Globals/ }))
  const code = screen.getByRole('textbox', { name: 'Code' })
  expect(document.activeElement).toBe(code)
  fireEvent.keyDown(code, { key: 'Enter' })
  expect(await screen.findByText(/^Breakpoint on line 9 stops autoplay/)).toBeDefined()
})

describe('records (§4)', () => {
  const pair = (first: number, second: number): HeapObject => ({
    kind: 'record',
    type: 'std::pair<int, int>',
    fields: [
      { name: 'first', value: int(first) },
      { name: 'second', value: int(second) },
    ],
  })

  test('a C++ struct held by value nests in its parent; a pair reads inline and marks its change', () => {
    renderState(
      stepState(
        [frame([ref('seg', 'o1')])],
        {
          o1: {
            kind: 'record',
            type: 'Segment',
            fields: [
              { name: 'a', value: { t: 'ref', id: 'o2', type: 'Point' } },
              { name: 'span', value: { t: 'ref', id: 'o3' } },
              { name: 'next', value: { t: 'ptr', addr: '0x0', type: 'Segment *' } },
            ],
          },
          o2: { kind: 'record', type: 'Point', fields: [{ name: 'x', value: int(1) }] },
          o3: pair(4, 2),
        },
        { changed: { locals: {}, cells: { o3: ['second'] } } },
      ),
      'cpp17-gcc',
    )
    expect(cardIds()).toEqual(['#o1'])
    expect(rows(within(card('o1')).getAllByRole('table')[0]!)).toEqual([
      'a x1',
      'x 1',
      'span (4, 2)* (changed)',
      'next ∅null pointer',
    ])
  })

  test('a Python object is never nested: every attribute that holds an object is a reference', () => {
    renderState(
      stepState([frame([ref('n', 'o1')], '<module>', 'global')], {
        o1: {
          kind: 'record',
          type: 'Node',
          fields: [{ name: 'left', value: { t: 'ref', id: 'o2' } }],
        },
        o2: { kind: 'record', type: 'Node', fields: [] },
        o3: { kind: 'sequence', type: 'tuple', length: 1, fixed: true, items: [int(4)] },
      }),
      'python3',
    )
    expect(cardIds()).toEqual(['#o1', '#o2'])
    expect(rows(within(card('o1')).getByRole('table'))).toEqual(['left ●──▶ #o2'])
    expect(card('o2').textContent).toContain('no fields')
  })
})

describe('array of structs or pairs as a table (§4, §19.4)', () => {
  test('the edge list fixture renders both vectors as tables, folding their rows', () => {
    renderStep('cpp-edge-list', 9)
    expect(rows(within(card('o1')).getByRole('table'))).toEqual([
      'index first second',
      '0 0 1',
      '1 1 2',
      '2 2 3',
      '3 3 0',
    ])
    expect(rows(within(card('o5')).getByRole('table'))).toEqual([
      'index u v w',
      '0 0 1 5',
      '1 1 2 3',
      '2 0 3 9',
    ])
    expect(cardIds()).toEqual(['#o1', '#o5'])
    expect(within(card('o5')).getByRole('button', { name: 'Table', pressed: true })).toBeDefined()
  })

  test('Cells shows pairs inline and structs as cards, and asks to remember it per variable', () => {
    const { onView } = renderStep('cpp-edge-list', 9, {
      views: { edges: 'cells', roads: 'cells' },
    })
    expect(
      within(card('o1'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['[0] (0, 1)0', '[1] (1, 2)1', '[2] (2, 3)2', '[3] (3, 0)3'])
    expect(cardIds()).toEqual(['#o1', '#o5', '#o9', '#o10', '#o11'])
    fireEvent.click(within(card('o5')).getByRole('button', { name: 'Table', pressed: false }))
    expect(onView).toHaveBeenCalledWith('roads', 'table')
  })

  test('a row whose element moved is marked whole', () => {
    renderStep('cpp-edge-list', 7)
    const [, first] = within(card('o5')).getAllByRole('row')
    expect(first!.textContent).toBe('00* (changed)1* (changed)5* (changed)')
  })

  test('in the player, Table or Cells sticks to its variable from step to step', async () => {
    history.replaceState(null, '', '/?step=9')
    renderPlayer('cpp-edge-list')
    await screen.findByText('Step 9 of 14')
    fireEvent.click(within(card('o5')).getByRole('button', { name: 'Cells' }))
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    await screen.findByText('Step 10 of 14')
    expect(within(card('o5')).getByRole('button', { name: 'Cells', pressed: true })).toBeDefined()
    expect(within(card('o1')).getByRole('button', { name: 'Table', pressed: true })).toBeDefined()
    expect(cardIds()).toEqual(['#o1', '#o5', '#o9', '#o10', '#o11'])
  })
})
