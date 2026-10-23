import { loadFixture } from '@viz/fixtures'
import { delay, http, HttpResponse } from 'msw'
import { parse } from 'yaml'
import spec from '../../../../../backend/api/openapi.yaml?raw'
import type { components } from '../gen/api.ts'

type Visualization = components['schemas']['Visualization']
type Languages = components['schemas']['Languages']
type ErrorResponse = components['schemas']['ErrorResponse']
type Chunk = components['schemas']['Chunk']

type Spec = {
  paths: {
    '/languages': {
      get: {
        responses: {
          '200': {
            content: { 'application/json': { examples: { languages: { value: Languages } } } }
          }
        }
      }
    }
  }
  components: {
    examples: Record<'Tracing' | 'Completed' | 'FailedBuild', { value: Visualization }>
  }
}

export const scenarios = ['completed', 'failed-build', 'busy', 'slow-tracing'] as const
export type Scenario = (typeof scenarios)[number]

export function isScenario(name: string): name is Scenario {
  return (scenarios as readonly string[]).includes(name)
}

const { paths, components: openapi } = parse(spec) as Spec
const languages =
  paths['/languages'].get.responses['200'].content['application/json'].examples.languages.value
const examples = {
  tracing: openapi.examples.Tracing.value,
  completed: openapi.examples.Completed.value,
  failedBuild: openapi.examples.FailedBuild.value,
}

const fixture = 'cpp-binary-search'
const chunkOrigin = 'https://traces.example.com/t7'
const pollsUntilDone = 4

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const chunkBodies = new Map<string, string>()

async function completed(version: number): Promise<Visualization> {
  const { header, chunks } = loadFixture(fixture)
  const manifest: Chunk[] = await Promise.all(
    chunks.map(async (steps, index) => {
      const body = JSON.stringify(steps)
      const url = `${chunkOrigin}/${header.id}/chunk-${String(index).padStart(4, '0')}.json`
      chunkBodies.set(url, body)
      return {
        index,
        fromStep: steps[0]!.i,
        toStep: steps.at(-1)!.i,
        sizeBytes: new TextEncoder().encode(body).length,
        sha256: await sha256(body),
        url,
      }
    }),
  )
  return {
    ...examples.completed,
    version,
    language: header.language.id,
    trace: { ...examples.completed.trace!, header, chunks: manifest },
  }
}

const busy: ErrorResponse = {
  error: {
    code: 'capacity',
    message: 'Visualizer is busy, try again in a few seconds.',
    retryAfterSec: 5,
    requestId: 'req_mock_capacity',
  },
}

export function handlers(apiBaseUrl: string, scenario: Scenario) {
  let polls = 0

  async function current(): Promise<Visualization> {
    if (scenario === 'failed-build') return examples.failedBuild
    if (scenario === 'completed') return completed(examples.completed.version)
    const base = examples.tracing
    if (polls >= pollsUntilDone) return completed(base.version + polls)
    return { ...base, version: base.version + polls, progress: { steps: 412 + 100 * polls } }
  }

  return [
    http.get(`${apiBaseUrl}/languages`, () =>
      HttpResponse.json(languages, { headers: { 'Cache-Control': 'max-age=300' } }),
    ),

    http.post(`${apiBaseUrl}/visualizations`, async () => {
      if (scenario === 'busy') {
        return HttpResponse.json(busy, { status: 503, headers: { 'Retry-After': '5' } })
      }
      polls = 0
      const body = await current()
      return HttpResponse.json(body, {
        status: 201,
        headers: { Location: `${apiBaseUrl}/visualizations/${body.id}` },
      })
    }),

    http.get(`${apiBaseUrl}/visualizations/:id`, async ({ request }) => {
      if (scenario === 'busy') {
        return HttpResponse.json(busy, { status: 503, headers: { 'Retry-After': '5' } })
      }
      if (scenario === 'slow-tracing' && new URL(request.url).searchParams.has('wait')) {
        await delay()
        polls++
      }
      return HttpResponse.json(await current())
    }),

    http.delete(`${apiBaseUrl}/visualizations/:id`, () => new HttpResponse(null, { status: 204 })),

    http.get(`${chunkOrigin}/:trace/:chunk`, ({ request }) => {
      const url = new URL(request.url)
      const body = chunkBodies.get(`${url.origin}${url.pathname}`)
      if (body === undefined) return new HttpResponse(null, { status: 404 })
      return new HttpResponse(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, max-age=86400, immutable',
        },
      })
    }),
  ]
}
