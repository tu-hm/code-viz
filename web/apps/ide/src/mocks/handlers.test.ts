// @vitest-environment node
import { setupServer } from 'msw/node'
import { afterEach, describe, expect, test } from 'vitest'
import type { components } from '../gen/api.ts'
import { handlers, scenarios, type Scenario } from './handlers.ts'

type Visualization = components['schemas']['Visualization']

const api = 'http://localhost:8080/api/v1'
const server = setupServer()
server.listen({ onUnhandledFrame: 'error' })
afterEach(() => server.resetHandlers())

const final = ['completed', 'failed', 'canceled']

async function visualize(scenario: Scenario) {
  server.use(...handlers(api, scenario))
  const created = await fetch(`${api}/visualizations`, { method: 'POST', body: '{}' })
  if (created.status !== 201) return { created, history: [], refused: created }
  const history = [(await created.json()) as Visualization]
  while (!final.includes(history.at(-1)!.status)) {
    const { id, version } = history.at(-1)!
    const res = await fetch(`${api}/visualizations/${id}?wait=20&since=${version}`)
    if (!res.ok) return { created, history, refused: res }
    history.push((await res.json()) as Visualization)
  }
  return { created, history, refused: null }
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

type Run = Awaited<ReturnType<typeof visualize>>
const last = (run: Run) => run.history.at(-1)!
const refusedWith =
  (status: number, code: string, retryAfter: string | null) => async (run: Run) => {
    expect(run.refused?.status).toBe(status)
    expect(run.refused?.headers.get('Retry-After') ?? null).toBe(retryAfter)
    expect(await run.refused!.json()).toMatchObject({ error: { code } })
  }
const completedWith = (check: (header: Visualization) => void) => (run: Run) => {
  expect(last(run).status).toBe('completed')
  check(last(run))
}

const want: Record<Scenario, (run: Run) => unknown> = {
  completed: completedWith((v) => expect(v.trace!.header.summary.exit.kind).toBe('normal')),
  'slow-tracing': (run) => {
    expect(run.history.map((v) => v.status)).toEqual([
      'queued',
      'building',
      'tracing',
      'tracing',
      'tracing',
      'completed',
    ])
    const steps = run.history.flatMap((v) => (v.progress ? [v.progress.steps] : []))
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    const versions = run.history.map((v) => v.version)
    expect(versions).toEqual([...new Set(versions)].sort((a, b) => a - b))
  },
  'failed-build': (run) =>
    expect(last(run)).toMatchObject({ status: 'failed', failure: { kind: 'compile_error' } }),
  'unsupported-module': (run) =>
    expect(last(run)).toMatchObject({ status: 'failed', failure: { kind: 'unsupported_module' } }),
  'internal-error': (run) =>
    expect(last(run)).toMatchObject({ status: 'failed', failure: { kind: 'sandbox_error' } }),
  canceled: (run) => expect(last(run).status).toBe('canceled'),
  busy: refusedWith(503, 'capacity', '5'),
  'rate-limited': refusedWith(429, 'rate_limited', '20'),
  'server-error': refusedWith(500, 'internal_error', null),
  expired: refusedWith(410, 'expired', null),
  'not-found': refusedWith(404, 'not_found', null),
  'runtime-error': completedWith((v) => expect(v.trace!.header.summary.exit.kind).toBe('signal')),
  'step-limit': completedWith((v) => {
    expect(v.trace!.header.summary.truncation?.reason).toBe('step_limit')
    expect(v.trace!.tail).toBeDefined()
  }),
  timeout: completedWith((v) => expect(v.trace!.header.summary.exit.kind).toBe('timeout')),
  'output-limit': completedWith((v) =>
    expect(v.trace!.header.summary.exit.kind).toBe('output_limit'),
  ),
  'build-warnings': completedWith((v) =>
    expect(v.build!.diagnostics.map((d) => d.severity)).toEqual(['warning', 'warning']),
  ),
  'nothing-traced': completedWith((v) => {
    expect(v.trace!.header.summary.stepCount).toBe(0)
    expect(v.trace!.chunks).toEqual([])
  }),
}

describe('mock API', () => {
  test.each(scenarios)('%s ends in the state it names', async (scenario) => {
    await want[scenario](await visualize(scenario))
  })

  test.each(scenarios)(
    '%s serves files whose size and sha256 match the manifest',
    async (scenario) => {
      const run = await visualize(scenario)
      const trace = run.history.at(-1)?.trace
      const files = [...(trace?.chunks ?? []), ...(trace?.tail ? [trace.tail] : [])]
      for (const file of files) {
        const bytes = await (await fetch(file.url)).arrayBuffer()
        expect(bytes.byteLength).toBe(file.sizeBytes)
        expect(await sha256(bytes)).toBe(file.sha256)
      }
    },
  )
})
