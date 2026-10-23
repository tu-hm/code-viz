// @vitest-environment node
import { setupServer } from 'msw/node'
import { afterEach, describe, expect, test } from 'vitest'
import type { components } from '../gen/api.ts'
import { handlers, type Scenario } from './handlers.ts'

type Visualization = components['schemas']['Visualization']

const api = 'http://localhost:8080/api/v1'
const server = setupServer()
server.listen({ onUnhandledFrame: 'error' })
afterEach(() => server.resetHandlers())

const final = ['completed', 'failed', 'canceled']

async function visualize(scenario: Scenario) {
  server.use(...handlers(api, scenario))
  const created = await fetch(`${api}/visualizations`, { method: 'POST', body: '{}' })
  if (created.status !== 201) return { created, history: [] }
  const history = [(await created.json()) as Visualization]
  while (!final.includes(history.at(-1)!.status)) {
    const { id, version } = history.at(-1)!
    const res = await fetch(`${api}/visualizations/${id}?wait=20&since=${version}`)
    history.push((await res.json()) as Visualization)
  }
  return { created, history }
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('mock API', () => {
  test('completed serves chunks whose size and sha256 match the manifest', async () => {
    const { history } = await visualize('completed')
    const trace = history.at(-1)!.trace!
    expect(trace.chunks.length).toBeGreaterThan(0)
    for (const chunk of trace.chunks) {
      const bytes = await (await fetch(chunk.url)).arrayBuffer()
      expect(bytes.byteLength).toBe(chunk.sizeBytes)
      expect(await sha256(bytes)).toBe(chunk.sha256)
    }
  })

  test('failed-build ends failed with a compile error', async () => {
    const { history } = await visualize('failed-build')
    expect(history.at(-1)).toMatchObject({ status: 'failed', failure: { kind: 'compile_error' } })
  })

  test('busy answers 503 capacity with Retry-After', async () => {
    const { created } = await visualize('busy')
    expect(created.status).toBe(503)
    expect(created.headers.get('Retry-After')).toBe('5')
    expect(await created.json()).toMatchObject({ error: { code: 'capacity' } })
  })

  test('slow-tracing reports rising progress, then completes', async () => {
    const { history } = await visualize('slow-tracing')
    const tracing = history.filter((v) => v.status === 'tracing')
    expect(tracing.length).toBeGreaterThan(1)
    expect(history.map((v) => v.version)).toEqual(
      [...history.map((v) => v.version)].sort((a, b) => a - b),
    )
    expect(new Set(history.map((v) => v.version)).size).toBe(history.length)
    expect(tracing.map((v) => v.progress!.steps)).toEqual(
      [...tracing.map((v) => v.progress!.steps)].sort((a, b) => a - b),
    )
    expect(history.at(-1)!.status).toBe('completed')
  })
})
