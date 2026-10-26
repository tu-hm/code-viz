import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { loadFixture } from '@viz/fixtures'
import ELK from 'elkjs/lib/elk.bundled.js'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createEngine, type StepState } from './engine.ts'
import { formatterFor } from './format.ts'
import type { HeapObject, Value } from './gen/trace.ts'
import {
  firstVisits,
  graphShape,
  graphUnion,
  isUndirected,
  layoutGraph,
  levels,
  type GraphLayout,
  type GraphRequest,
} from './graph.ts'
import { parseSource } from './parse.ts'
import { StatePane } from './state-pane.tsx'
import { usePlayer, type ViewAs } from './store.ts'
import { python, renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const cpp = formatterFor('cpp17-gcc')

function stateAt(name: string, step: number) {
  return createEngine(loadFixture(name).chunks.flat()).state(step - 1)
}

function layouts(name: string) {
  const steps = loadFixture(name).chunks.flat()
  const format = formatterFor(loadFixture(name).header.language.id)
  return async (request: GraphRequest) => {
    const { nodes, edges } =
      request.visits === null
        ? await graphUnion(steps, request.id, request.kind, format)
        : await firstVisits(steps, request.id, request.visits, format)
    const undirected = request.visits === null && (request.undirected ?? isUndirected(edges))
    return layoutGraph(request.nodes ?? nodes, edges, undirected, new ELK())
  }
}

async function renderGraph(
  name: string,
  step: number,
  views: Record<string, ViewAs>,
  layoutGraph = layouts(name),
) {
  const { source, header } = loadFixture(name)
  const facts = await parseSource(source, header.language.id)
  const view = render(
    <StatePane
      state={stateAt(name, step)}
      languageId={header.language.id}
      pointers={header.language.id.startsWith('cpp')}
      settings={{
        showInternals: false,
        showUnreachable: false,
        highlightChanges: true,
        drawArrows: false,
        showAddresses: false,
        matrixView: true,
      }}
      views={views}
      facts={facts}
      pins={{}}
      onPin={vi.fn<(variable: string, names: string[]) => void>()}
      onWatch={vi.fn<(target: string) => void>()}
      onShowInternals={vi.fn<() => void>()}
      onFrameLine={vi.fn<(line: number) => void>()}
      onView={vi.fn<(variable: string, view: ViewAs) => void>()}
      layoutGraph={layoutGraph}
    />,
  )
  await screen.findByRole('img', { name: /as a (graph|tree)/ }, { timeout: 10_000 })
  return view
}

const nodes = (name: string) =>
  within(screen.getByRole('list', { name: `Nodes of ${name}` }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)

describe('graph shapes (§19.4.5)', () => {
  const heapOf = (state: StepState) => (id: string) => state.heap[id]

  test('cpp-bfs: the adjacency list holds both directions of six edges', () => {
    const state = stateAt('cpp-bfs', 58)
    const shape = graphShape('graph', state.heap.o1!, heapOf(state), cpp)!
    expect(shape.size).toBe(7)
    expect(shape.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      '1>2',
      '1>3',
      '1>4',
      '2>1',
      '2>5',
      '3>1',
      '4>1',
      '4>5',
      '5>2',
      '5>4',
      '5>6',
      '6>5',
    ])
    expect(isUndirected(shape.edges)).toBe(true)
  })

  test('cpp-bfs: par is a tree from each node’s parent', () => {
    const state = stateAt('cpp-bfs', 111)
    const shape = graphShape('tree', state.heap.o3!, heapOf(state), cpp)!
    expect(shape.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['1>2', '1>3', '1>4', '2>5', '5>6'])
  })

  test('cpp-edge-list: pairs and structs are edge lists, a third field the weight', () => {
    const state = stateAt('cpp-edge-list', 14)
    const pairs = graphShape('graph', state.heap.o1!, heapOf(state), cpp)!
    expect(pairs.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['0>1', '1>2', '2>3', '3>0'])
    const roads = graphShape('graph', state.heap.o5!, heapOf(state), cpp)!
    expect(roads.edges.map((e) => `${e.from}>${e.to}:${e.weight?.v}`)).toEqual([
      '0>1:5',
      '1>2:3',
      '0>3:9',
    ])
    expect(roads.size).toBe(4)
  })

  test('a weighted adjacency list holds (v, w) pairs', () => {
    const pair = (v: number, w: number): HeapObject => ({
      kind: 'record',
      type: 'std::pair<int, int>',
      fields: [
        { name: 'first', value: { t: 'int', v: String(v) } },
        { name: 'second', value: { t: 'int', v: String(w) } },
      ],
    })
    const heap: Record<string, HeapObject> = {
      a: pair(1, 7),
      b: pair(0, 7),
      r0: { kind: 'sequence', length: 1, items: [{ t: 'ref', id: 'a' }] },
      r1: { kind: 'sequence', length: 1, items: [{ t: 'ref', id: 'b' }] },
    }
    const adj: HeapObject = {
      kind: 'sequence',
      type: 'std::vector<std::pair<int, int>> [2]',
      length: 2,
      items: [
        { t: 'ref', id: 'r0' },
        { t: 'ref', id: 'r1' },
      ],
    }
    const shape = graphShape('graph', adj, (id) => heap[id], cpp)!
    expect(shape.edges.map((e) => `${e.from}>${e.to}:${e.weight?.v}`)).toEqual(['0>1:7', '1>0:7'])
  })

  test('values outside [0, N) are not an adjacency list', () => {
    const row: HeapObject = { kind: 'sequence', length: 1, items: [{ t: 'int', v: '9' }] }
    const outer: HeapObject = {
      kind: 'sequence',
      length: 2,
      items: [
        { t: 'ref', id: 'r' },
        { t: 'ref', id: 'r' },
      ],
    }
    expect(graphShape('graph', outer, () => row, cpp)).toBeNull()
  })

  test('a sparse parent array treats its default as no parent', () => {
    const par: HeapObject = {
      kind: 'sequence',
      length: 100,
      sparse: {
        default: { t: 'int', v: '0' },
        items: { 2: { t: 'int', v: '1' }, 3: { t: 'int', v: '2' } },
      },
    }
    expect(
      graphShape('tree', par, () => undefined, cpp)!.edges.map((e) => `${e.from}>${e.to}`),
    ).toEqual(['1>2', '2>3'])
  })

  test('levels are BFS levels from the lowest node of each component', () => {
    const edges = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 1, to: 4 },
      { from: 7, to: 8 },
    ]
    expect(Object.fromEntries(levels([1, 2, 3, 4, 7, 8], edges))).toEqual({
      1: 0,
      2: 1,
      4: 1,
      3: 2,
      7: 0,
      8: 1,
    })
  })

  test('the union covers every step, so the layout holds nodes not there yet', async () => {
    const steps = loadFixture('cpp-bfs').chunks.flat()
    const union = await graphUnion(steps, 'o1', 'graph', cpp)
    expect(union.nodes).toEqual([1, 2, 3, 4, 5, 6])
    const layout = await layoutGraph(union.nodes, union.edges, true, new ELK())
    expect(Object.keys(layout.edges).sort()).toEqual(['1-2', '1-3', '1-4', '2-5', '4-5', '5-6'])
    const y = (n: number) => layout.nodes[n]!.y
    expect(y(1)).toBeLessThan(y(2))
    expect(y(2)).toBe(y(3))
    expect(y(3)).toBe(y(4))
    expect(y(4)).toBeLessThan(y(5))
    expect(y(5)).toBeLessThan(y(6))
  })
})

describe('first-visit trees (§19.4.5)', () => {
  const edgesOf = async (name: string, colour: string) => {
    const steps = loadFixture(name).chunks.flat()
    const { edges } = await firstVisits(steps, 'o1', { colour, names: ['u'] }, cpp)
    return edges.map((e) => `${e.from}>${e.to}`)
  }

  test('cpp-bfs: each node hangs from the u it was reached from', async () => {
    expect(await edgesOf('cpp-bfs', 'o2')).toEqual(['1>2', '1>3', '1>4', '2>5', '5>6'])
  })

  test('cpp-dfs: recursion finds the parent in the caller’s frame', async () => {
    expect(await edgesOf('cpp-dfs', 'o2')).toEqual(['1>2', '2>4', '4>3', '4>5', '2>6', '6>7'])
  })

  test('the view draws only the first visits made so far, as a tree', async () => {
    await renderGraph('cpp-dfs', 91, { adj: 'graph' })
    fireEvent.click(screen.getByRole('button', { name: 'First visits (DFS tree)' }))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /^adj as/ }).getAttribute('aria-label')).toBe(
        'adj as the tree of first visits: 7 nodes, 6 edges',
      ),
    )
    expect(screen.getByRole('checkbox', { name: /Undirected/ })).toHaveProperty('disabled', true)
  })
})

describe('graph view (§19.4.5)', () => {
  test('cpp-bfs step 58 matches the mock: visited by dist, u current, v = 5 being checked', async () => {
    await renderGraph('cpp-bfs', 58, { adj: 'graph' })
    expect(screen.getByRole('img', { name: /as a graph/ }).getAttribute('aria-label')).toBe(
      'adj as a graph: 6 nodes, 6 edges; current node 2 (u); checking v = 5, edge 2 to 5',
    )
    expect(nodes('adj')).toEqual([
      'node 1, visited, dist 0, edges to 2, 3, 4',
      'node 2, visited, dist 1, current, edges to 1, 5',
      'node 3, visited, dist 1, edges to 1',
      'node 4, visited, dist 1, edges to 1, 5',
      'node 5, not visited, dist -1, edges to 2, 4, 6',
      'node 6, not visited, dist -1, edges to 5',
    ])
    expect(screen.getByText(/^\[x\] visited: dist ≠ -1$/)).toBeDefined()
    expect(
      screen.getByRole('checkbox', { name: 'Undirected (edges stored twice)' }),
    ).toHaveProperty('checked', true)
    expect(screen.queryByRole('article', { name: /^#o5 / })).toBeNull()
  })

  test('the colour and label pickers offer the arrays as long as the graph', async () => {
    await renderGraph('cpp-bfs', 58, { adj: 'graph' })
    const colour = screen.getByRole('combobox', { name: 'Color nodes by' })
    expect(
      within(colour)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['none', 'dist', 'par'])
    fireEvent.change(colour, { target: { value: '' } })
    expect(nodes('adj')[0]).toBe('node 1, edges to 2, 3, 4')
    fireEvent.change(screen.getByRole('combobox', { name: 'Label nodes by' }), {
      target: { value: 'par' },
    })
    expect(nodes('adj')[1]).toBe('node 2, labelled 1, current, edges to 1, 5')
  })

  test('python-bfs: a list of lists and a for over adj[u] give the same picture', async () => {
    await renderGraph('python-bfs', 55, { adj: 'graph' })
    expect(screen.getByRole('img', { name: /as a graph/ }).getAttribute('aria-label')).toBe(
      'adj as a graph: 6 nodes, 6 edges; current node 2 (u); checking v = 5, edge 2 to 5',
    )
  })

  test('cpp-bfs: par as a tree draws each node under its parent, with arrows', async () => {
    await renderGraph('cpp-bfs', 111, { par: 'tree' })
    expect(screen.getByRole('img', { name: /as a tree/ }).getAttribute('aria-label')).toBe(
      'par as a tree: 6 nodes, 5 edges',
    )
    expect(screen.queryByRole('checkbox', { name: /Undirected/ })).toBeNull()
  })

  test('a weighted edge list draws its weights', async () => {
    await renderGraph('cpp-edge-list', 14, { roads: 'graph' })
    const svg = screen.getByRole('img', { name: /roads as a graph/ })
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['5', '3', '9']),
    )
    expect(screen.queryByText('┊ edge being checked')).toBeNull()
  })

  test('above 200 nodes only the 2-hop neighbourhood of the current node is laid out', async () => {
    const n = 300
    const rows: Record<string, HeapObject> = {}
    const items: Value[] = []
    for (let k = 0; k < n; k++) {
      const next = [k - 1, k + 1].filter((v) => v >= 0 && v < n)
      rows[`r${k}`] = {
        kind: 'sequence',
        length: next.length,
        items: next.map((v) => ({ t: 'int', v: String(v) })),
      }
      items.push({ t: 'ref', id: `r${k}` })
    }
    const state: StepState = {
      i: 1,
      event: 'line',
      prevLine: 2,
      line: 2,
      error: null,
      stack: [
        {
          id: 'f0',
          name: 'main',
          kind: 'function',
          line: 2,
          locals: [
            { name: 'adj', value: { t: 'ref', id: 'o1' } },
            { name: 'u', value: { t: 'int', v: '150' } },
          ],
          returnValue: null,
        },
      ],
      heap: { o1: { kind: 'sequence', length: n, items }, ...rows },
      changed: { locals: {}, cells: {} },
      before: { scope: {}, cells: {} },
      newObjects: [],
      output: [],
    }
    const facts = await parseSource('int main() {\nf(adj[u]);\n}', 'cpp17-gcc')
    const asked: GraphRequest[] = []
    const layoutGraph = (request: GraphRequest): Promise<GraphLayout> => {
      asked.push(request)
      const shown = request.nodes ?? []
      return Promise.resolve({
        undirected: true,
        spans: null,
        width: 100,
        height: 100,
        nodes: Object.fromEntries(shown.map((v, k) => [v, { x: 0, y: 40 * k }])),
        edges: {},
      })
    }
    render(
      <StatePane
        state={state}
        languageId="cpp17-gcc"
        pointers
        settings={{
          showInternals: false,
          showUnreachable: false,
          highlightChanges: true,
          drawArrows: false,
          showAddresses: false,
          matrixView: true,
        }}
        views={{ adj: 'graph' }}
        facts={facts}
        pins={{}}
        onPin={vi.fn<(variable: string, names: string[]) => void>()}
        onWatch={vi.fn<(target: string) => void>()}
        onShowInternals={vi.fn<() => void>()}
        onFrameLine={vi.fn<(line: number) => void>()}
        onView={vi.fn<(variable: string, view: ViewAs) => void>()}
        layoutGraph={layoutGraph}
      />,
    )
    await screen.findByRole('img', { name: /as a graph/ })
    expect(asked.at(-1)!.nodes).toEqual([148, 149, 150, 151, 152])
    expect(screen.getByText(/^300 nodes: showing/).textContent).toBe(
      '300 nodes: showing the 5 within 2 edges of node 150, 295 hidden',
    )
  })
})

test('in the player: the chip turns adj into a graph laid out in its own worker', async () => {
  history.replaceState(null, '', '/?step=58')
  renderPlayer('cpp-bfs')
  fireEvent.click(await screen.findByRole('button', { name: 'View as Graph?' }))
  expect(usePlayer.getState().views.adj).toBe('graph')
  await screen.findByRole('img', { name: /^adj as a graph/ }, { timeout: 10_000 })
  act(() => usePlayer.getState().go(59))
  await waitFor(() =>
    expect(
      screen.getByRole('img', { name: /^adj as a graph/ }).getAttribute('aria-label'),
    ).toContain('checking'),
  )
})

test('python: the chip shows for a list of lists named adj', async () => {
  history.replaceState(null, '', '/?step=55')
  renderPlayer('python-bfs', { language: python })
  const adj = await screen.findByRole('article', { name: /from adj$/ })
  expect(within(adj).getByRole('button', { name: 'View as Graph?' })).toBeDefined()
  const edges = screen.getByRole('article', { name: /from edges$/ })
  expect(within(edges).getByRole('button', { name: 'View as Graph?' })).toBeDefined()
})
