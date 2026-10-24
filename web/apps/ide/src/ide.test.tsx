import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { loadFixture } from '@viz/fixtures'
import { usePlayer } from '@viz/player'
import { delay, http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { components } from './gen/api.ts'
import { Ide } from './ide.tsx'
import { handlers, languages } from './mocks/handlers.ts'

type Visualization = components['schemas']['Visualization']

const shown = vi.hoisted(() => ({ refresh: null as null | (() => Promise<unknown>) }))

vi.mock(import('./flags.ts'), () => ({ useFlag: () => true }))

vi.mock(import('@viz/player'), async (importOriginal) => {
  const { createElement } = await import('react')
  const Player: typeof import('@viz/player').Player = ({
    source,
    banner,
    onClose,
    onStartAt,
    onRaiseLimit,
    onShowRange,
  }) => {
    if (!('manifest' in source)) throw new Error('want a manifest from the API')
    shown.refresh = source.refresh
    const button = (label: string, onClick: () => void) =>
      createElement('button', { onClick }, label)
    return createElement(
      'section',
      { 'aria-label': 'Player' },
      createElement('p', null, `Trace ${source.manifest.header.id}`),
      banner,
      onStartAt && button('Start tracing from line…', onStartAt),
      onRaiseLimit && button('Raise limit', onRaiseLimit),
      onShowRange && button('Show range of a', () => onShowRange('a')),
      button('Close visualizer', onClose),
    )
  }
  return { ...(await importOriginal()), Player }
})

const api = 'http://localhost:8080/api/v1'
const server = setupServer(http.get(`${api}/languages`, () => HttpResponse.json(languages)))
server.listen({ onUnhandledFrame: 'error' })
afterEach(() => server.resetHandlers())

type Seen = {
  method: string
  path: string
  since: string | null
  key: string | null
  body: Promise<unknown>
}
let requests: Seen[] = []

beforeEach(() => {
  requests = []
  shown.refresh = null
  usePlayer.setState(usePlayer.getInitialState())
  server.events.removeAllListeners()
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url)
    if (!url.href.startsWith(api)) return
    requests.push({
      method: request.method,
      path: url.pathname.replace('/api/v1', ''),
      since: url.searchParams.get('since'),
      key: request.headers.get('Idempotency-Key'),
      body: request.method === 'POST' ? request.clone().json() : Promise.resolve(null),
    })
  })
})

const posts = () => requests.filter((r) => r.method === 'POST')
const lastOptions = async () =>
  ((await posts().at(-1)!.body) as { options: Record<string, unknown> }).options
const polls = () => requests.filter((r) => r.method === 'GET' && r.since !== null)
const traceId = loadFixture('cpp-binary-search').header.id

function renderIde() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Ide />
    </QueryClientProvider>,
  )
}

async function visualize() {
  fireEvent.click(await screen.findByRole('button', { name: 'Visualize' }))
}

const envelope = (code: string, message: string) => ({
  error: { code, message, requestId: `req_${code}` },
})

function tracing(version: number): Visualization {
  return {
    id: 'viz_5f2c9d3a7b1e4c08',
    status: 'tracing',
    version,
    language: 'python3',
    createdAt: '2026-10-23T08:12:03Z',
    progress: { steps: 100 * version },
  }
}

const created = http.post(`${api}/visualizations`, () =>
  HttpResponse.json(tracing(3), { status: 201 }),
)

const slowPolls = http.get(`${api}/visualizations/:id`, () => delay(50))

describe('Visualize', () => {
  test('sends the code, stdin and settings, and opens the player on the completed trace', async () => {
    let body: unknown
    server.use(
      http.post(`${api}/visualizations`, async ({ request }) => {
        body = await request.clone().json()
        return undefined
      }),
      ...handlers(api, 'completed'),
    )
    renderIde()
    fireEvent.change(await screen.findByLabelText('Stdin'), { target: { value: '7\n' } })
    await visualize()

    expect(await screen.findByText(`Trace ${traceId}`)).toBeDefined()
    expect(posts()).toHaveLength(1)
    expect(posts()[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(body).toMatchObject({
      language: languages.languages[0]!.id,
      source: expect.stringContaining('def square(x):') as unknown,
      stdin: '7\n',
      options: { maxSteps: 1000, startAtLines: [], showInternals: false },
      context: { problemCode: null, client: expect.stringMatching(/^ide-web\//) as unknown },
    })
  })

  test('Ctrl or Cmd + Shift + Enter visualizes from anywhere in the IDE', async () => {
    server.use(...handlers(api, 'completed'))
    renderIde()
    await screen.findByRole('button', { name: 'Visualize' })
    fireEvent.keyDown(screen.getByLabelText('Stdin'), {
      key: 'Enter',
      shiftKey: true,
      metaKey: true,
    })
    expect(await screen.findByText(`Trace ${traceId}`)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Close visualizer' }))
    fireEvent.keyDown(document.body, { key: 'Enter', shiftKey: true, ctrlKey: true })
    expect(await screen.findByText(`Trace ${traceId}`)).toBeDefined()
    expect(posts()).toHaveLength(2)
  })

  test('the button is hidden for a language that cannot visualize', async () => {
    const [first, second] = languages.languages
    const off = { ...second!, visualize: { ...second!.visualize, enabled: false } }
    server.use(http.get(`${api}/languages`, () => HttpResponse.json({ languages: [first, off] })))
    renderIde()
    await screen.findByRole('button', { name: 'Visualize' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: off.id },
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Visualize' })).toBeNull())
  })

  test('stdin over 64 KB is refused before anything is sent', async () => {
    server.use(...handlers(api, 'completed'))
    renderIde()
    fireEvent.change(await screen.findByLabelText('Stdin'), {
      target: { value: 'x'.repeat(65 * 1024) },
    })
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toContain('over the 64 KB limit')
    expect(posts()).toHaveLength(0)
  })

  test('the completed player can fetch fresh chunk URLs', async () => {
    server.use(...handlers(api, 'completed'))
    renderIde()
    await visualize()
    await screen.findByText(`Trace ${traceId}`)
    const fresh = await shown.refresh!()
    expect(fresh).toMatchObject({ header: { id: traceId } })
    expect(requests.at(-1)).toMatchObject({ method: 'GET', since: null })
  })
})

describe('long-poll', () => {
  test('shows progress while tracing, then opens the player', async () => {
    server.use(slowPolls, ...handlers(api, 'slow-tracing'))
    renderIde()
    await visualize()
    const status = await screen.findByText(/^Tracing \(\d+ steps so far\)…$/)
    const steps = /\d+/.exec(status.textContent)![0]
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(steps)
    expect(await screen.findByText(`Trace ${traceId}`)).toBeDefined()
    const sinces = polls().map((r) => Number(r.since))
    expect(sinces).toEqual([...sinces].sort((a, b) => a - b))
  })

  test('survives an API restart: retries and resumes from the last version', async () => {
    const answers = [
      () => HttpResponse.json(tracing(4)),
      () => HttpResponse.error(),
      () =>
        HttpResponse.json(envelope('capacity', 'Database unavailable.'), {
          status: 503,
          headers: { 'Retry-After': '0' },
        }),
      () => HttpResponse.json(tracing(5)),
    ]
    server.use(
      created,
      http.get(`${api}/visualizations/:id`, () => answers.shift()?.()),
      ...handlers(api, 'completed'),
    )
    renderIde()
    await visualize()

    expect(await screen.findByText(`Trace ${traceId}`, {}, { timeout: 4000 })).toBeDefined()
    expect(polls().map((r) => r.since)).toEqual(['3', '4', '4', '4', '5'])
  })

  test.each([
    { scenario: 'not-found', text: "This visualization doesn't exist." },
    { scenario: 'expired', text: 'This visualization has expired.' },
  ] as const)(
    '$scenario while polling stops, and Visualize again starts over',
    async ({ scenario, text }) => {
      server.use(...handlers(api, scenario))
      renderIde()
      await visualize()
      expect((await screen.findByRole('alert')).textContent).toContain(text)
      expect(polls()).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: 'Visualize again' }))
      await waitFor(() => expect(posts()).toHaveLength(2))
      expect(posts()[1]!.key).not.toBe(posts()[0]!.key)
    },
  )
})

describe('create errors', () => {
  test.each([
    {
      name: '429 shows the wait and is not retried',
      status: 429,
      body: envelope('rate_limited', 'Too many visualizations. Try again in 20 seconds.'),
      text: 'Too many visualizations. Try again in 20 seconds.',
    },
    {
      name: '503 shows the busy message and is not retried',
      status: 503,
      body: envelope('capacity', 'Visualizer is busy, try again in a few seconds.'),
      text: 'Visualizer is busy, try again in a few seconds.',
    },
    {
      name: 'a proxy error page without the envelope still shows its status',
      status: 502,
      body: '<html>Bad Gateway</html>',
      text: 'The API answered HTTP 502.',
    },
  ])('$name', async ({ status, body, text }) => {
    server.use(
      http.post(`${api}/visualizations`, () =>
        typeof body === 'string'
          ? new HttpResponse(body, { status })
          : HttpResponse.json(body, { status, headers: { 'Retry-After': '20' } }),
      ),
    )
    renderIde()
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toContain(text)
    expect(posts()).toHaveLength(1)
  })

  test('a network error on create retries with the same Idempotency-Key', async () => {
    let failures = 1
    server.use(
      http.post(`${api}/visualizations`, () => {
        if (failures-- > 0) return HttpResponse.error()
        return undefined
      }),
      ...handlers(api, 'completed'),
    )
    renderIde()
    await visualize()
    expect(await screen.findByText(`Trace ${traceId}`, {}, { timeout: 3000 })).toBeDefined()
    const [first, second] = posts()
    expect(posts()).toHaveLength(2)
    expect(second!.key).toBe(first!.key)
  })
})

describe('cancel', () => {
  test('Cancel while tracing deletes the visualization, stops polling and returns to the editor', async () => {
    server.use(slowPolls, ...handlers(api, 'slow-tracing'))
    renderIde()
    await visualize()
    await screen.findByText(/^Tracing \(\d+ steps so far\)…$/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('button', { name: 'Visualize' })).toBeDefined()
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'DELETE')).toEqual([
        expect.objectContaining({ path: '/visualizations/viz_5f2c9d3a7b1e4c08' }),
      ]),
    )
    const after = requests.length
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests.slice(after)).toEqual([])
  })

  test('Cancel before the create answers deletes the visualization once it exists', async () => {
    let answer: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => (answer = resolve))
    server.use(http.post(`${api}/visualizations`, () => pending))
    renderIde()
    await visualize()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await screen.findByRole('button', { name: 'Visualize' })

    server.use(...handlers(api, 'slow-tracing'))
    answer(HttpResponse.json(tracing(3), { status: 201 }))
    await waitFor(() => expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(1))
  })

  test('closing a completed visualization keeps it', async () => {
    server.use(...handlers(api, 'completed'))
    renderIde()
    await visualize()
    fireEvent.click(await screen.findByRole('button', { name: 'Close visualizer' }))
    await screen.findByRole('button', { name: 'Visualize' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests.filter((r) => r.method === 'DELETE')).toEqual([])
  })
})

describe('turned away (§5.6)', () => {
  test('busy: Retry waits out Retry-After, then sends the same request again', async () => {
    let refusals = 1
    server.use(
      http.post(`${api}/visualizations`, () => {
        if (refusals-- === 0) return undefined
        return HttpResponse.json(envelope('capacity', 'Queue full.'), {
          status: 503,
          headers: { 'Retry-After': '1' },
        })
      }),
      ...handlers(api, 'completed'),
    )
    renderIde()
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Visualizer is busy, try again in a few seconds.',
    )
    expect(screen.getByRole('button', { name: 'Retry in 1 s' })).toHaveProperty('disabled', true)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }, { timeout: 2000 }))

    expect(await screen.findByText(`Trace ${traceId}`)).toBeDefined()
    const [first, second] = posts()
    expect(second!.key).toBe(first!.key)
  })

  test('rate limited: says how long to wait', async () => {
    server.use(...handlers(api, 'rate-limited'))
    renderIde()
    await visualize()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Too many visualizations. Try again in 20 seconds.')
    expect(alert.textContent).toContain('You can visualize again in 20 s.')
    expect(screen.getByRole('button', { name: 'Retry in 20 s' })).toHaveProperty('disabled', true)
  })

  test('a server error is ours, with the request ID to report', async () => {
    server.use(...handlers(api, 'server-error'))
    renderIde()
    await visualize()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Something went wrong on our side.')
    expect(alert.textContent).toContain('Request ID: req_mock_internal_error')
  })
})

const paragraph = (text: string) => (_: string, el: Element | null) =>
  el?.tagName === 'P' && el.textContent === text

function caretLine() {
  const node = document.getSelection()!.anchorNode
  const line = (node instanceof Element ? node : node?.parentElement)?.closest('.cm-line')
  return [...document.querySelectorAll('.cm-line')].indexOf(line!) + 1
}

describe('ended without a trace (§5.6, §8.3)', () => {
  test('a build error lists its diagnostics; Go to line puts the editor caret there', async () => {
    server.use(...handlers(api, 'failed-build'))
    renderIde()
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Build failed. Fix the error and visualize again.',
    )
    expect(screen.getByText(paragraph("6:14 error: expected ';' before 'return'"))).toBeDefined()
    expect(screen.getByText('Raw compiler output')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Go to line 6' }))
    const editor = await screen.findByRole('textbox', { name: 'Code editor' })
    expect(document.activeElement).toBe(editor)
    expect(caretLine()).toBe(6)
  })

  test('an unsupported module says to use Run', async () => {
    server.use(...handlers(api, 'unsupported-module'))
    renderIde()
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toBe(
      "numpy isn't supported in the visualizer. Use Run instead.",
    )
    expect(screen.getByRole('button', { name: 'Go to line 1' })).toBeDefined()
  })

  test('a sandbox failure is ours; Try again runs the program again', async () => {
    server.use(...handlers(api, 'internal-error'))
    renderIde()
    await visualize()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Something went wrong on our side.')
    expect(alert.textContent).toContain('Visualization ID: viz_9a01be77c2d34f51')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1]!.key).not.toBe(posts()[0]!.key)
  })

  test('a visualization canceled elsewhere says so', async () => {
    server.use(...handlers(api, 'canceled'))
    renderIde()
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toBe('This visualization was canceled.')
  })
})

describe('a completed trace (§5.6, §19.8)', () => {
  test('compiler warnings sit in the banner and link to their lines', async () => {
    server.use(...handlers(api, 'build-warnings'))
    renderIde()
    await visualize()
    const player = within(await screen.findByRole('region', { name: 'Player' }))
    fireEvent.click(player.getByText('2 compiler warnings'))
    expect(
      player.getByText(
        paragraph("main.cpp:7:13 warning: declaration of 'n' shadows a previous local [-Wshadow]"),
      ),
    ).toBeDefined()
    fireEvent.click(player.getByRole('button', { name: 'Go to line 5' }))
    await screen.findByRole('button', { name: 'Visualize' })
    expect(caretLine()).toBe(5)
  })

  test('Start tracing from line… re-runs from the typed line and the breakpoints', async () => {
    server.use(...handlers(api, 'step-limit'))
    renderIde()
    await visualize()
    act(() => {
      usePlayer.setState({ breakpoints: [2, 4] })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Start tracing from line…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Start tracing from' }))

    fireEvent.change(dialog.getByLabelText('Start at line'), { target: { value: '99' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Visualize' }))
    expect(dialog.getByRole('alert').textContent).toBe('Enter a line from 1 to 4.')

    fireEvent.change(dialog.getByLabelText('Start at line'), { target: { value: '3' } })
    fireEvent.click(dialog.getByRole('checkbox', { name: '4' }))
    fireEvent.change(dialog.getByLabelText('Max steps'), { target: { value: '2000' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Visualize' }))

    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(await lastOptions()).toMatchObject({ startAtLines: [2, 3], maxSteps: 2000 })
  })

  test('Raise limit re-runs at the language’s ceiling', async () => {
    server.use(...handlers(api, 'step-limit'))
    renderIde()
    await visualize()
    fireEvent.click(await screen.findByRole('button', { name: 'Raise limit' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(await lastOptions()).toMatchObject({ maxSteps: 5000, startAtLines: [] })
  })

  test('Show range… re-runs recording that variable’s indices', async () => {
    server.use(...handlers(api, 'completed'))
    renderIde()
    await visualize()
    fireEvent.click(await screen.findByRole('button', { name: 'Show range of a' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Show a range of a' }))
    fireEvent.change(dialog.getByLabelText('From index'), { target: { value: '50' } })
    fireEvent.change(dialog.getByLabelText('To index'), { target: { value: '10' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Visualize' }))
    expect(dialog.getByRole('alert').textContent).toBe('The range ends before it starts.')

    fireEvent.change(dialog.getByLabelText('To index'), { target: { value: '99' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Visualize' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(await lastOptions()).toMatchObject({ captureRanges: { a: [[50, 99]] } })
  })

  test('a trace with no steps shows the untraced output and offers to trace from the start', async () => {
    server.use(...handlers(api, 'nothing-traced'))
    renderIde()
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The program never reached line 3, so no steps were recorded.',
    )
    const output = within(screen.getByRole('region', { name: 'Output' }))
    expect(await output.findByText('small')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Trace from the start' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(await lastOptions()).toMatchObject({ startAtLines: [] })
  })
})
