import { fireEvent, render, screen, within } from '@testing-library/react'
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createEngine, type StepState } from './engine.ts'
import type { Frame, HeapObject, Local, Step } from './gen/trace.ts'
import { parseSource } from './parse.ts'
import type { SourceFacts } from './source-facts.ts'
import { StatePane } from './state-pane.tsx'
import { usePlayer, type ViewAs } from './store.ts'
import { renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const engines = new Map<string, ReturnType<typeof createEngine>>()
const parsed = new Map<string, SourceFacts | null>()

function stateAt(name: string, step: number) {
  let engine = engines.get(name)
  if (!engine) {
    engine = createEngine(loadFixture(name).chunks.flat())
    engines.set(name, engine)
  }
  return engine.state(step - 1)
}

async function factsOf(name: string) {
  if (!parsed.has(name)) {
    const { source, header } = loadFixture(name)
    parsed.set(name, await parseSource(source, header.language.id))
  }
  return parsed.get(name)!
}

type Options = {
  facts?: SourceFacts | null
  views?: Record<string, ViewAs>
  pins?: Record<string, string[]>
  matrixView?: boolean
}

function renderState(state: StepState, languageId: string, options: Options = {}) {
  const props = {
    state,
    languageId,
    pointers: languageId.startsWith('cpp'),
    settings: {
      showInternals: false,
      showUnreachable: false,
      highlightChanges: true,
      drawArrows: true,
      showAddresses: false,
      matrixView: options.matrixView ?? true,
    },
    views: options.views ?? {},
    facts: options.facts ?? null,
    pins: options.pins ?? {},
    onPin: vi.fn<(variable: string, names: string[]) => void>(),
    onShowInternals: vi.fn<() => void>(),
    onFrameLine: vi.fn<(line: number) => void>(),
    onView: vi.fn<(variable: string, view: ViewAs) => void>(),
  }
  const view = render(<StatePane {...props} />)
  return { ...props, ...view }
}

async function renderStep(name: string, step: number, options: Options = {}) {
  const facts = options.facts === undefined ? await factsOf(name) : options.facts
  return renderState(stateAt(name, step), loadFixture(name).header.language.id, {
    ...options,
    facts,
  })
}

const card = (id: string) => screen.getByRole('article', { name: new RegExp(`^#${id} `) })
const cellTexts = (el: HTMLElement) =>
  within(el)
    .getAllByRole('cell')
    .map((c) => c.textContent)

describe('matrix view (§19.4.3)', () => {
  test('cpp-dp-grid step 22: dp[2][3] written, dp[1][3] and dp[2][2] read, i and j marked', async () => {
    await renderStep('cpp-dp-grid', 22)
    const dp = card('o1')
    expect(within(dp).getByRole('heading').textContent).toContain('4 × 5')
    const grid = within(dp).getByRole('table', { name: 'dp, 4 by 5' })
    expect(within(dp).getByText(/dp\[2\]\[3\] = 10 \(was ·\) from/).textContent).toBe(
      '» dp[2][3] = 10 (was ·) from dp[1][3] = 4 and dp[2][2] = 6',
    )
    const rows = within(grid).getAllByRole('row').slice(1)
    expect(cellTexts(rows[1]!)).toEqual(['1', '2', '3', '(4) (read, inferred)', '5'])
    expect(cellTexts(rows[2]!)).toEqual([
      '1',
      '3',
      '(6) (read, inferred)',
      '[10] (written this step)',
      '·not set',
    ])
    expect(cellTexts(rows[3]!)).toEqual(['1', '·not set', '·not set', '·not set', '·not set'])
    expect(within(rows[2]!).getByRole('rowheader').textContent).toContain('i=2')
    expect(within(grid).getByText('j=3').parentElement!.textContent).toBe('j=3▼')
    expect(within(dp).getByText(/folded into the grid/).textContent).toBe(
      'rows #o2 #o3 #o4 #o5 are folded into the grid',
    )
    expect(screen.queryByRole('article', { name: /^#o4 / })).toBeNull()
  })

  test('without parsed facts the grid still shows the exact write, and nothing inferred', async () => {
    await renderStep('cpp-dp-grid', 22, { facts: null })
    const grid = screen.getByRole('table', { name: 'dp, 4 by 5' })
    expect(cellTexts(within(grid).getAllByRole('row')[3]!)).toEqual([
      '1',
      '3',
      '6',
      '[10] (written this step)',
      '·not set',
    ])
    expect(screen.queryByText(/was ·/)).toBeNull()
    expect(screen.queryByText('i=2')).toBeNull()
  })

  test('Cells puts the rows back as their own cards, and the setting picks the default', async () => {
    const { onView, unmount } = await renderStep('cpp-dp-grid', 22)
    fireEvent.click(
      within(screen.getByRole('group', { name: 'View dp as' })).getByRole('button', {
        name: 'Cells',
      }),
    )
    expect(onView).toHaveBeenCalledWith('dp', 'cells')
    unmount()
    const cells = await renderStep('cpp-dp-grid', 22, { views: { dp: 'cells' } })
    expect(screen.queryByRole('table', { name: /^dp/ })).toBeNull()
    expect(card('o4')).toBeDefined()
    cells.unmount()
    await renderStep('cpp-dp-grid', 22, { matrixView: false })
    expect(screen.queryAllByRole('table', { name: /^dp/ })).toEqual([])
  })

  test('heat tint shades cells by value on demand', async () => {
    await renderStep('cpp-dp-grid', 38)
    const grid = screen.getByRole('table', { name: 'dp, 4 by 5' })
    const hottest = within(grid).getByText('35').closest('td')!
    expect(hottest.className).not.toContain('bg-trace-heat')
    fireEvent.click(screen.getByRole('button', { name: 'Heat tint' }))
    expect(hottest.className).toContain('bg-trace-heat/40')
  })

  test('python-error-index: a list of lists is a matrix too', async () => {
    await renderStep('python-error-index', 6)
    expect(screen.getByRole('table', { name: 'grid, 2 by 2' })).toBeDefined()
  })
})

describe('index markers (§19.4.1)', () => {
  test('cpp-binary-search step 11: mid from a[mid], l and r as a range', async () => {
    await renderStep('cpp-binary-search', 11)
    const a = card('o1')
    const cell = (i: number) =>
      within(a)
        .getAllByRole('listitem')
        .find((li) => li.textContent.startsWith(`[${i}]`))!
    expect(cell(4).textContent).toMatch(/^\[4\] l /)
    expect(cell(5).textContent).toMatch(/^\[5\] mid /)
    expect(cell(7).textContent).toMatch(/^\[7\] r /)
    expect(cell(6).textContent).toMatch(/^\[6\] 13/)
    expect(within(a).getByText('l..r')).toBeDefined()
  })

  const frame = (locals: Local[]): Frame => ({
    id: 'f0',
    name: 'main',
    kind: 'function',
    line: 2,
    locals,
    returnValue: null,
  })
  const int = (name: string, v: number): Local => ({ name, value: { t: 'int', v: String(v) } })
  const a: HeapObject = {
    kind: 'sequence',
    type: 'vector<int>',
    length: 8,
    items: Array.from({ length: 8 }, (_, i) => ({ t: 'int', v: String(i * 2) })),
  }
  const on = (...names: string[]): SourceFacts => ({
    2: {
      subscripts: names.map((n) => ({ array: 'a', indices: [{ name: n, offset: 0 }], mode: 'r' })),
      identifiers: names,
      inputs: [],
      scanf: [],
      header: null,
    },
  })
  const state = (locals: Local[], rest: Partial<StepState> = {}): StepState => ({
    i: 1,
    event: 'line',
    prevLine: 2,
    line: 3,
    error: null,
    stack: [frame([{ name: 'a', value: { t: 'ref', id: 'o1' } }, ...locals])],
    heap: { o1: a },
    changed: { locals: {}, cells: {} },
    before: { scope: Object.fromEntries(locals.map((l) => [l.name, l.value])), cells: {} },
    newObjects: [],
    output: [],
    ...rest,
  })

  test('a marker past the end sits at the edge in red', () => {
    renderState(state([int('i', 8)]), 'cpp17-gcc', { facts: on('i') })
    expect(screen.getByText(/out of range, size 8/).textContent).toBe(
      'i = 8 ▶ out of range, size 8',
    )
  })

  test('l > r says the range is empty', () => {
    renderState(state([int('l', 5), int('r', 2), int('m', 3)]), 'cpp17-gcc', { facts: on('m') })
    expect(screen.getByText('l..r: empty range (5 > 2)')).toBeDefined()
  })

  test('more than 4 markers collapse into +N', () => {
    const names = ['p', 'q', 's', 't', 'u', 'w']
    renderState(state(names.map((n, k) => int(n, k))), 'cpp17-gcc', { facts: on(...names) })
    expect(screen.getByText('+2 more markers')).toBeDefined()
  })

  test('a pinned variable stays marked on a line that never indexes the array', () => {
    const facts = on('i')
    renderState(state([int('k', 6)]), 'cpp17-gcc', { facts, pins: { a: ['k'] } })
    const six = screen.getAllByRole('listitem').find((li) => li.textContent.startsWith('[6]'))!
    expect(six.textContent).toMatch(/^\[6\] k /)
    expect(screen.getByRole('button', { name: 'Marked: k' })).toBeDefined()
  })

  test('Mark… pins the names typed', async () => {
    const { onPin } = renderState(state([int('i', 1)]), 'cpp17-gcc', { facts: on('i') })
    fireEvent.click(screen.getByRole('button', { name: 'Mark…' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Mark on a' }), {
      target: { value: 'l, r' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mark' }))
    expect(onPin).toHaveBeenCalledWith('a', ['l', 'r'])
  })

  test('a string indexed on the line reads inline with its markers', () => {
    const facts: SourceFacts = {
      2: {
        subscripts: [{ array: 's', indices: [{ name: 'i', offset: 0 }], mode: 'r' }],
        identifiers: ['s', 'i'],
        inputs: [],
        scanf: [],
        header: null,
      },
    }
    const word: Local = { name: 's', value: { t: 'str', v: 'code' } }
    renderState(state([word, int('i', 2)]), 'cpp17-gcc', { facts })
    const row = screen.getByRole('row', { name: /^s / })
    expect(within(row).getByText('▼').parentElement!.textContent).toBe('i▼d')
    expect(within(row).getByText('i at 2')).toBeDefined()
    const { unmount } = renderState(state([word, int('i', 7)]), 'cpp17-gcc', { facts })
    expect(screen.getAllByText(/out of range, size 4/)[0]!.textContent).toBe(
      'i = 7 ▶ out of range, size 4',
    )
    unmount()
  })

  test('a step with access[] uses it instead of inferring reads', () => {
    renderState(
      state([int('i', 1)], { access: [{ obj: 'o1', path: [6], mode: 'r' }] }),
      'cpp17-gcc',
      { facts: on('i') },
    )
    const read = screen.getAllByRole('listitem').filter((li) => li.textContent.includes('(read'))
    expect(read.map((li) => li.textContent.slice(0, 3))).toEqual(['[6]'])
    expect(read[0]!.textContent).not.toContain('inferred')
  })
})

describe('big arrays (§19.4.2)', () => {
  const big = () => screen.getByRole('group', { name: /^depth_, 200,005 cells, window/ })

  test('cpp-sparse-dfs step 30: a 16-cell window follows u, with a minimap', async () => {
    await renderStep('cpp-sparse-dfs', 30)
    expect(big().getAttribute('aria-label')).toBe('depth_, 200,005 cells, window 32–47')
    const cells = within(big()).getAllByRole('listitem')
    expect(cells.map((li) => li.textContent)).toContain('… +32')
    expect(cells.map((li) => li.textContent)).toContain('… +199,957')
    expect(cells.find((li) => li.textContent.startsWith('[32]'))!.textContent).toBe(
      '[32] u 5* (changed)32',
    )
    expect(
      within(big())
        .getByRole('img', { name: /^minimap/ })
        .getAttribute('aria-label'),
    ).toBe('minimap: 5 cells differ from 0, 1 changed this step, window 32–47')
  })

  test('[ and ], the buttons and Go to index… move the window', async () => {
    await renderStep('cpp-sparse-dfs', 30)
    fireEvent.keyDown(big(), { key: ']' })
    expect(big().getAttribute('aria-label')).toBe('depth_, 200,005 cells, window 48–63')
    fireEvent.keyDown(big(), { key: '[' })
    fireEvent.keyDown(big(), { key: '[' })
    expect(big().getAttribute('aria-label')).toBe('depth_, 200,005 cells, window 16–31')
    fireEvent.click(within(big()).getByRole('button', { name: 'Window forward' }))
    expect(big().getAttribute('aria-label')).toBe('depth_, 200,005 cells, window 32–47')
    fireEvent.click(within(big()).getByRole('button', { name: 'Go to index…' }))
    const input = await screen.findByRole('textbox', { name: 'Index' })
    fireEvent.change(input, { target: { value: '200005' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter an index from 0 to 200,004')
    fireEvent.change(input, { target: { value: '150,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(big().getAttribute('aria-label')).toBe('depth_, 200,005 cells, window 150000–150015')
    expect(within(big()).getAllByRole('listitem')[0]!.textContent).toBe('… +150,000')
  })

  test('Non-zero only lists the cells that differ from the default', async () => {
    await renderStep('cpp-sparse-dfs', 30)
    fireEvent.click(within(big()).getByRole('button', { name: 'Non-zero only' }))
    const list = within(big()).getByRole('region', { name: 'Non-zero only' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['[2]=1', '[4]=2', '[8]=3', '[16]=4', '[32]=5* (changed)'])
  })

  test('the window keeps its place on steps that neither index nor write the array', async () => {
    const facts = await factsOf('cpp-sparse-dfs')
    const view = await renderStep('cpp-sparse-dfs', 30)
    const props = { ...view, state: stateAt('cpp-sparse-dfs', 31) }
    const pane = (step: number) => (
      <StatePane
        state={stateAt('cpp-sparse-dfs', step)}
        languageId="cpp17-gcc"
        pointers
        settings={props.settings}
        views={{}}
        facts={facts}
        pins={{}}
        onPin={props.onPin}
        onShowInternals={props.onShowInternals}
        onFrameLine={props.onFrameLine}
        onView={props.onView}
      />
    )
    view.rerender(pane(32))
    expect(big().getAttribute('aria-label')).toBe('depth_, 200,005 cells, window 32–47')
    view.rerender(pane(10))
    expect(big().getAttribute('aria-label')).toBe('depth_, 200,005 cells, window 0–15')
  })
})

describe.each(fixtureNames)('%s', (name) => {
  test('every step draws its markers and grids without holes', { timeout: 30_000 }, async () => {
    const steps = loadFixture(name).chunks.flat()
    const sample =
      steps.length <= 60
        ? steps.map((s: Step) => s.i + 1)
        : [1, 2, Math.ceil(steps.length / 2), steps.length]
    for (const step of sample) {
      const { unmount } = await renderStep(name, step)
      expect(document.body.textContent, `step ${step}`).not.toMatch(
        /undefined|\[object Object\]|NaN/,
      )
      unmount()
    }
  })
})

test('in the player, markers arrive from the worker without holding up a step', async () => {
  renderPlayer('cpp-binary-search')
  await screen.findByText('Step 1 of 20')
  fireEvent.keyDown(document.body, { key: 'End' })
  await screen.findByText('Step 20 of 20')
  usePlayer.getState().go(10)
  await screen.findByText('Step 11 of 20')
  expect(await screen.findByText('l..r')).toBeDefined()
})
