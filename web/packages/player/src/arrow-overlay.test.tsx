import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { describe, expect, test, vi } from 'vitest'
import { createEngine, type StepState } from './engine.ts'
import type { Frame, HeapObject, Value } from './gen/trace.ts'
import { StatePane } from './state-pane.tsx'
import type { Settings, ViewAs } from './store.ts'

type Toggles = Partial<Pick<Settings, 'drawArrows' | 'showAddresses'>>

function stateAt(name: string, step: number) {
  return createEngine(loadFixture(name).chunks.flat()).state(step - 1)
}

function pane(state: StepState, languageId: string, toggles: Toggles = {}) {
  return (
    <StatePane
      state={state}
      languageId={languageId}
      pointers={languageId.startsWith('cpp')}
      settings={{
        showInternals: false,
        showUnreachable: false,
        highlightChanges: true,
        drawArrows: true,
        showAddresses: false,
        ...toggles,
      }}
      views={{}}
      onShowInternals={vi.fn<() => void>()}
      onFrameLine={vi.fn<(line: number) => void>()}
      onView={vi.fn<(variable: string, view: ViewAs) => void>()}
    />
  )
}

function renderStep(name: string, step: number, toggles: Toggles = {}) {
  return render(pane(stateAt(name, step), loadFixture(name).header.language.id, toggles))
}

const card = (id: string) => screen.getByRole('article', { name: new RegExp(`^#${id} `) })
const labels = (id: string) =>
  screen.getAllByRole('button', { name: new RegExp(`^points to #${id}\\b`) })
const arrowsTo = (container: HTMLElement) =>
  [...container.querySelectorAll('svg path[data-to]')].map((p) => p.getAttribute('data-to'))

function layOut() {
  let boxes = new WeakMap<Element, DOMRect>()
  const place = () => {
    boxes = new WeakMap()
    const cards = [...document.querySelectorAll('[data-card]')]
    for (const [i, card] of cards.entries()) {
      boxes.set(card, new DOMRect(500, i * 100, 300, 80))
      for (const label of card.querySelectorAll('[data-arrow-to]')) {
        boxes.set(label, new DOMRect(540, i * 100 + 40, 60, 16))
      }
    }
    const stack = [...document.querySelectorAll('[data-arrow-to]')].filter((el) => !boxes.has(el))
    for (const [i, label] of stack.entries()) boxes.set(label, new DOMRect(100, i * 24, 60, 16))
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (!this.hasAttribute('data-card') && !this.hasAttribute('data-arrow-to')) {
      return new DOMRect()
    }
    if (!boxes.has(this)) place()
    return boxes.get(this)!
  })
}

function narrowScreen() {
  vi.spyOn(window, 'matchMedia').mockImplementation((media: string) =>
    Object.assign(new EventTarget(), {
      matches: media.includes('max-width'),
      media,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  )
}

describe.each(fixtureNames)('%s', (name) => {
  const steps = loadFixture(name).chunks.flat()
  const sampled = [1, Math.ceil(steps.length / 2), steps.length]

  test(
    'every arrow drawn ends at a card on the page, and every ● takes you to its card',
    {
      timeout: 30_000,
    },
    () => {
      layOut()
      const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
      for (const step of sampled) {
        const { container, unmount } = renderStep(name, step)
        const ids = new Set(
          [...container.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card')),
        )
        for (const to of arrowsTo(container)) expect(ids.has(to), `step ${step}: #${to}`).toBe(true)
        for (const label of screen.queryAllByRole('button', { name: /^points to #/ }).slice(0, 5)) {
          const id = /#(\w+)/.exec(label.textContent)![1]!
          scrolled.mockClear()
          fireEvent.click(label)
          expect(scrolled.mock.contexts, `step ${step}: #${id}`).toEqual([card(id)])
        }
        unmount()
      }
    },
  )
})

describe('§5.3 Python mock, step 9', () => {
  test('a and b bundle into #o2, c and square get their own arrows', () => {
    layOut()
    const { container } = renderStep('python-aliasing', 9)
    expect(arrowsTo(container).toSorted()).toEqual(['o1', 'o2', 'o2', 'o3'])
    expect(container.querySelectorAll('svg g')).toHaveLength(3)
  })

  test('hovering #o2 highlights the card, both ● that point to it, and its arrows', () => {
    layOut()
    const { container } = renderStep('python-aliasing', 9)
    fireEvent.pointerOver(card('o2'))
    expect(card('o2').hasAttribute('data-active')).toBe(true)
    expect(labels('o2').map((l) => l.hasAttribute('data-active'))).toEqual([true, true])
    expect(labels('o3')[0]!.hasAttribute('data-active')).toBe(false)
    const active = container.querySelectorAll('svg path.stroke-trace-arrow-active[data-to]')
    expect([...active].map((p) => p.getAttribute('data-to'))).toEqual(['o2', 'o2'])

    fireEvent.pointerLeave(container.firstElementChild!)
    expect(card('o2').hasAttribute('data-active')).toBe(false)
  })

  test('hovering a ● highlights its card and every ● that shares it', () => {
    layOut()
    renderStep('python-aliasing', 9)
    fireEvent.pointerOver(labels('o2')[1]!)
    expect(card('o2').hasAttribute('data-active')).toBe(true)
    expect(labels('o2')[0]!.hasAttribute('data-active')).toBe(true)
    expect(card('o3').hasAttribute('data-active')).toBe(false)
  })

  test('scrolling redraws the arrows on the next frame', async () => {
    layOut()
    const { container } = renderStep('python-aliasing', 9)
    expect(arrowsTo(container)).toHaveLength(4)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(10)
    fireEvent.scroll(window)
    fireEvent.scroll(container)
    await waitFor(() => expect(arrowsTo(container)).toEqual(['o1']))
  })

  test('with "Draw reference arrows" off, references are labels only', () => {
    layOut()
    const { container } = renderStep('python-aliasing', 9, { drawArrows: false })
    expect(arrowsTo(container)).toEqual([])
    expect(labels('o2')).toHaveLength(2)
  })

  test('under 768 px no arrows are drawn, and tapping a ● scrolls to its card', () => {
    layOut()
    narrowScreen()
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { container } = renderStep('python-aliasing', 9)
    expect(arrowsTo(container)).toEqual([])
    fireEvent.click(labels('o3')[0]!)
    expect(scrolled.mock.contexts).toContainEqual(card('o3'))
  })
})

test('over 30 arrows in view, only labels show until a card is hovered', () => {
  layOut()
  const { container } = renderStep('synthetic-5000', 1)
  expect(arrowsTo(container)).toEqual([])
  fireEvent.pointerOver(card('o2'))
  expect(arrowsTo(container)).toEqual(['o2'])
})

describe('§5.4 C++ mock, step 6: pointers', () => {
  test('head points to #o4 and #o4.next to #o5, with arrows; #o5.next is ∅', () => {
    layOut()
    const { container } = renderStep('cpp-pointers', 6)
    expect(labels('o4')).toHaveLength(1)
    expect(within(card('o4')).getByRole('button', { name: /^points to #o5/ })).toBeTruthy()
    expect(within(card('o5')).getByText('null pointer')).toBeTruthy()
    expect(arrowsTo(container)).toEqual(expect.arrayContaining(['o4', 'o5']))
  })

  test('focusing or tapping a ● shows the raw address, and it goes away on blur', () => {
    renderStep('cpp-pointers', 6)
    const head = labels('o4')[0]!
    act(() => head.focus())
    expect(screen.getByRole('tooltip').textContent).toBe(head.title)
    expect(head.title).toMatch(/0x[0-9a-f]+$/)
    act(() => head.blur())
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(head)
    expect(screen.getByRole('tooltip').textContent).toBe(head.title)
  })

  test('"Show memory addresses" writes the address after the target', () => {
    renderStep('cpp-pointers', 6, { showAddresses: true })
    const head = labels('o4')[0]!
    const addr = /0x[0-9a-f]+$/.exec(head.title)![0]
    expect(head.textContent).toBe(`●──▶ points to #o4 ${addr}`)
  })

  test.each([
    {
      name: 'a pointer the tracer did not follow',
      value: { t: 'ptr', addr: '0x5555aaaa', type: 'Node *' },
      title: 'Node * · not followed',
    },
    {
      name: 'a pointer to an object not in the heap (dangling)',
      value: { t: 'ptr', addr: '0x5555bbbb', target: 'o9', type: 'Node *' },
      title: 'Node * · no object here',
    },
  ] satisfies { name: string; value: Value; title: string }[])(
    '$name shows its address as a label, not an arrow',
    ({ value, title }) => {
      layOut()
      const frame: Frame = {
        id: 'f1',
        name: 'main',
        kind: 'function',
        line: 3,
        locals: [{ name: 'p', value }],
        returnValue: null,
      }
      const heap: Record<string, HeapObject> = {}
      const state: StepState = {
        i: 0,
        event: 'line',
        prevLine: null,
        line: 3,
        error: null,
        stack: [frame],
        heap,
        changed: { locals: {}, cells: {} },
        newObjects: [],
        output: [],
      }
      const { container } = render(pane(state, 'cpp17-gcc'))
      expect(screen.queryByRole('button', { name: /^points to/ })).toBeNull()
      expect(screen.getByText(value.addr).title).toBe(title)
      expect(arrowsTo(container)).toEqual([])
    },
  )
})
