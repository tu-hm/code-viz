import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { loadFixture } from '@viz/fixtures'
import { http, HttpResponse } from 'msw'
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
  const Player: typeof import('@viz/player').Player = ({ source, onClose }) => {
    if (!('manifest' in source)) throw new Error('want a manifest from the API')
    shown.refresh = source.refresh
    return createElement(
      'section',
      { 'aria-label': 'Player' },
      createElement('p', null, `Trace ${source.manifest.header.id}`),
      createElement('button', { onClick: onClose }, 'Close visualizer'),
    )
  }
  return { ...(await importOriginal()), Player }
})

const api = 'http://localhost:8080/api/v1'
const server = setupServer(http.get(`${api}/languages`, () => HttpResponse.json(languages)))
server.listen({ onUnhandledFrame: 'error' })
afterEach(() => server.resetHandlers())

type Seen = { method: string; path: string; since: string | null; key: string | null }
let requests: Seen[] = []

beforeEach(() => {
  requests = []
  shown.refresh = null
  server.events.removeAllListeners()
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url)
    if (!url.href.startsWith(api)) return
    requests.push({
      method: request.method,
      path: url.pathname.replace('/api/v1', ''),
      since: url.searchParams.get('since'),
      key: request.headers.get('Idempotency-Key'),
    })
  })
})

const posts = () => requests.filter((r) => r.method === 'POST')
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
    server.use(...handlers(api, 'slow-tracing'))
    renderIde()
    await visualize()
    expect(
      await screen.findByText(
        (text) => text.startsWith('Tracing (') && text.includes('steps so far'),
      ),
    ).toBeDefined()
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

  test('a 404 while polling stops and shows the API message', async () => {
    server.use(
      created,
      http.get(`${api}/visualizations/:id`, () =>
        HttpResponse.json(envelope('not_found', 'Not found.'), { status: 404 }),
      ),
    )
    renderIde()
    await visualize()
    expect((await screen.findByRole('alert')).textContent).toContain('Not found.')
    expect(polls()).toHaveLength(1)
  })
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
    server.use(...handlers(api, 'slow-tracing'))
    renderIde()
    await visualize()
    await screen.findByText((text) => text.startsWith('Tracing ('))
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
