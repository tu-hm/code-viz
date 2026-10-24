// @vitest-environment node
import { gzipSync } from 'node:zlib'
import { loadFixture } from '@viz/fixtures'
import { loadTrace, type Manifest } from '@viz/player'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handlers } from './mocks/handlers.ts'

const api = 'http://localhost:8080/api/v1'
const server = setupServer()
server.listen({ onUnhandledFrame: 'error' })
afterEach(() => server.resetHandlers())

const later = '2999-01-01T00:00:00Z'
const earlier = '2000-01-01T00:00:00Z'

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function visualization() {
  const created = await fetch(`${api}/visualizations`, { method: 'POST', body: '{}' })
  return (await created.json()) as { id: string; trace: Manifest }
}

async function refreshOf(id: string) {
  const res = await fetch(`${api}/visualizations/${id}`)
  return ((await res.json()) as { trace: Manifest }).trace
}

function serveChunks(name: string, encode: (json: string) => Uint8Array<ArrayBuffer>) {
  const { header, chunks } = loadFixture(name)
  return Promise.all(
    chunks.map(async (steps, i) => {
      const body = encode(JSON.stringify(steps))
      const url = `https://chunks.example.com/${name}/${i}`
      server.use(http.get(url, () => new HttpResponse(body)))
      return { url, sha256: await sha256(body) }
    }),
  ).then((links): Manifest => ({ header, chunks: links, urlsExpireAt: later }))
}

describe('a completed visualization from the mock API', () => {
  beforeEach(() => server.use(...handlers(api, 'completed')))

  test('loads with every chunk verified', async () => {
    const { trace } = await visualization()
    const refresh = vi.fn<() => Promise<Manifest>>()
    const loaded = await loadTrace({ manifest: { ...trace, urlsExpireAt: later }, refresh })
    expect(loaded.steps).toEqual(loadFixture('cpp-binary-search').chunks.flat())
    expect(refresh).not.toHaveBeenCalled()
  })

  test('expired chunk URLs are fetched again from GET /visualizations/{id} first', async () => {
    const { id, trace } = await visualization()
    const stale = trace.chunks.map((c) => ({ ...c, url: c.url.replace('/t7/', '/stale/') }))
    server.use(
      http.get('https://traces.example.com/stale/*', () => new HttpResponse(null, { status: 403 })),
    )
    const refresh = vi.fn(() => refreshOf(id))
    const loaded = await loadTrace({
      manifest: { ...trace, chunks: stale, urlsExpireAt: earlier },
      refresh,
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(loaded.steps).toHaveLength(trace.header.summary.stepCount)
  })

  test.each([
    {
      name: 'a changed byte is a ChecksumError',
      reply: (body: string) => new HttpResponse(body.replace('"i":0', '"i":0 ')),
      error: 'ChecksumError',
    },
    {
      name: 'an HTTP error is a NetworkError',
      reply: () => new HttpResponse(null, { status: 500 }),
      error: 'NetworkError',
    },
    {
      name: 'a dropped connection is a NetworkError',
      reply: () => HttpResponse.error(),
      error: 'NetworkError',
    },
  ])('$name', async ({ reply, error }) => {
    const { trace } = await visualization()
    const body = JSON.stringify(loadFixture('cpp-binary-search').chunks[0])
    server.use(http.get(trace.chunks[0]!.url, () => reply(body)))
    const failed: unknown = await loadTrace({
      manifest: { ...trace, urlsExpireAt: later },
      refresh: () => Promise.reject(new Error('no refresh expected')),
    }).catch((e: unknown) => e)
    expect(String(failed)).toMatch(`${error}: chunk 0: `)
  })
})

test('chunks gzipped without Content-Encoding are unzipped after their checksum', async () => {
  const manifest = await serveChunks('synthetic-1000', (json) => gzipSync(json))
  const loaded = await loadTrace({ manifest, refresh: () => Promise.reject(new Error('unused')) })
  expect(loaded.steps).toEqual(loadFixture('synthetic-1000').chunks.flat())
})

test('URLs that expire partway through are refreshed once, before the next chunk', async () => {
  const manifest = await serveChunks('synthetic-1000', (json) => new TextEncoder().encode(json))
  const expiry = Date.parse(later)
  const fetched: string[] = []
  server.events.on('request:start', ({ request }) => fetched.push(request.url))
  const clock = [expiry - 2, expiry - 1, expiry, expiry + 1]
  const fresh = {
    ...manifest,
    chunks: manifest.chunks.map((c) => ({ ...c, url: `${c.url}?fresh` })),
  }
  const refresh = vi.fn(() => Promise.resolve({ ...fresh, urlsExpireAt: '3999-01-01T00:00:00Z' }))

  const loaded = await loadTrace({ manifest, refresh }, () => clock.shift()!)
  server.events.removeAllListeners()

  expect(refresh).toHaveBeenCalledOnce()
  expect(loaded.steps).toHaveLength(1000)
  expect(fetched).toEqual([
    manifest.chunks[0]!.url,
    manifest.chunks[1]!.url,
    fresh.chunks[2]!.url,
    fresh.chunks[3]!.url,
  ])
})
