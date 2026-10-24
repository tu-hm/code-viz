import { loadFixture, type Fixture } from '@viz/fixtures'
import { delay, http, HttpResponse } from 'msw'
import { parse } from 'yaml'
import spec from '../../../../../backend/api/openapi.yaml?raw'
import type { components } from '../gen/api.ts'

type Visualization = components['schemas']['Visualization']
type Languages = components['schemas']['Languages']
type ErrorResponse = components['schemas']['ErrorResponse']
type Chunk = components['schemas']['Chunk']
type Build = components['schemas']['Build']

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
    responses: {
      RateLimited: {
        content: { 'application/json': { examples: { rateLimited: { value: ErrorResponse } } } }
      }
    }
  }
}

export const scenarios = [
  'completed',
  'slow-tracing',
  'failed-build',
  'unsupported-module',
  'internal-error',
  'canceled',
  'busy',
  'rate-limited',
  'server-error',
  'expired',
  'not-found',
  'runtime-error',
  'step-limit',
  'timeout',
  'output-limit',
  'build-warnings',
  'nothing-traced',
] as const
export type Scenario = (typeof scenarios)[number]

export function isScenario(name: string): name is Scenario {
  return (scenarios as readonly string[]).includes(name)
}

const { paths, components: openapi } = parse(spec) as Spec
export const languages =
  paths['/languages'].get.responses['200'].content['application/json'].examples.languages.value
const examples = {
  tracing: openapi.examples.Tracing.value,
  completed: openapi.examples.Completed.value,
  failedBuild: openapi.examples.FailedBuild.value,
  rateLimited: openapi.responses.RateLimited.content['application/json'].examples.rateLimited.value,
}

const nothingTraced: Fixture = {
  header: {
    version: '1.2',
    id: 'trc_5a3c0d9e7f1b2a4c6e8d0f1a3b5c7d9e',
    language: { id: 'python3', runtime: 'CPython 3.12.15', adapter: 'py-settrace/0.3.0' },
    source: { file: 'main.py', lineCount: 4 },
    options: { maxSteps: 1000, startAtLines: [3] },
    summary: {
      stepCount: 0,
      truncated: false,
      truncation: null,
      exit: { kind: 'normal', code: 0, signal: null, message: null },
      lineHits: { '1': 1, '2': 1, '4': 1 },
      lineHitsSource: 'counter',
    },
    encoding: { mode: 'delta', keyframeInterval: 50 },
  },
  chunks: [],
  source: 'x = 3\nif x > 10:\n    print("big")\nprint("small")\n',
  stdin: '',
  tail: 'small\n',
}

const builds = {
  unsupportedModule: {
    ok: false,
    durationMs: 62,
    diagnostics: [
      {
        line: 1,
        column: 1,
        severity: 'error',
        message: "numpy isn't supported in the visualizer",
      },
    ],
    raw: "main.py:1:1: error: numpy isn't supported in the visualizer\n",
  },
  warnings: {
    ok: true,
    durationMs: 343,
    diagnostics: [
      {
        line: 7,
        column: 13,
        severity: 'warning',
        message: "declaration of 'n' shadows a previous local [-Wshadow]",
      },
      {
        line: 5,
        column: 16,
        severity: 'warning',
        message: "unused variable 'unused' [-Wunused-variable]",
      },
    ],
    raw: "main.cpp: In function 'int main()':\nmain.cpp:7:13: warning: declaration of 'n' shadows a previous local [-Wshadow]\nmain.cpp:5:9: note: shadowed declaration is here\nmain.cpp:5:16: warning: unused variable 'unused' [-Wunused-variable]\n",
  },
} satisfies Record<string, Build>

const traces: Partial<Record<Scenario, Fixture>> = {
  completed: loadFixture('cpp-binary-search'),
  'slow-tracing': loadFixture('cpp-binary-search'),
  'build-warnings': loadFixture('cpp-binary-search'),
  'runtime-error': loadFixture('cpp-check-index'),
  'step-limit': loadFixture('python-step-limit'),
  timeout: loadFixture('python-timeout'),
  'output-limit': loadFixture('python-output-limit'),
  'nothing-traced': nothingTraced,
}

const chunkOrigin = 'https://traces.example.com/t7'
const pollsUntilDone = 5

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const bodies = new Map<string, string>()

async function link(name: string, body: string) {
  const url = `${chunkOrigin}/${name}`
  bodies.set(url, body)
  return { sizeBytes: new TextEncoder().encode(body).length, sha256: await sha256(body), url }
}

async function completed(version: number, { header, chunks, tail }: Fixture, build?: Build) {
  const manifest: Chunk[] = await Promise.all(
    chunks.map(async (steps, index) => ({
      index,
      fromStep: steps[0]!.i,
      toStep: steps.at(-1)!.i,
      ...(await link(
        `${header.id}/chunk-${String(index).padStart(4, '0')}.json`,
        JSON.stringify(steps),
      )),
    })),
  )
  const base = examples.completed
  return {
    ...base,
    version,
    language: header.language.id,
    build: build ?? base.build,
    trace: {
      ...base.trace!,
      header,
      chunks: manifest,
      ...(tail !== '' && { tail: await link(`${header.id}/tail.txt`, tail) }),
    },
  } satisfies Visualization
}

function envelope(code: ErrorResponse['error']['code'], message: string, retryAfterSec?: number) {
  const body: ErrorResponse = {
    error: { code, message, requestId: `req_mock_${code}`, retryAfterSec },
  }
  const headers = retryAfterSec === undefined ? undefined : { 'Retry-After': String(retryAfterSec) }
  return { body, headers }
}

type Refusal = { status: number } & ReturnType<typeof envelope>

function refuse({ status, body, headers }: Refusal) {
  return HttpResponse.json(body, { status, headers })
}

const refusals: Partial<Record<Scenario, Refusal>> = {
  busy: {
    status: 503,
    ...envelope('capacity', 'Visualizer is busy, try again in a few seconds.', 5),
  },
  'rate-limited': {
    status: 429,
    body: examples.rateLimited,
    headers: { 'Retry-After': String(examples.rateLimited.error.retryAfterSec) },
  },
  'server-error': { status: 500, ...envelope('internal_error', 'Internal error.') },
}

const pollRefusals: Partial<Record<Scenario, Refusal>> = {
  busy: refusals.busy,
  expired: { status: 410, ...envelope('expired', 'This visualization has expired.') },
  'not-found': { status: 404, ...envelope('not_found', 'Not found.') },
}

export function handlers(apiBaseUrl: string, scenario: Scenario) {
  let polls = 0

  async function current(): Promise<Visualization> {
    const { tracing, failedBuild } = examples
    switch (scenario) {
      case 'failed-build':
        return failedBuild
      case 'unsupported-module':
        return {
          ...failedBuild,
          language: 'python3',
          failure: { stage: 'build', kind: 'unsupported_module' },
          build: builds.unsupportedModule,
        }
      case 'internal-error':
        return { ...failedBuild, failure: { stage: 'trace', kind: 'sandbox_error' } }
      case 'canceled':
        return { ...tracing, status: 'canceled', progress: undefined }
      case 'slow-tracing':
        if (polls >= pollsUntilDone) return completed(tracing.version + polls, traces[scenario]!)
        if (polls < 2) {
          return {
            ...tracing,
            status: polls === 0 ? 'queued' : 'building',
            version: polls,
            progress: undefined,
          }
        }
        return { ...tracing, version: polls, progress: { steps: 412 + 100 * (polls - 2) } }
      case 'expired':
      case 'not-found':
        return tracing
    }
    const fixture = traces[scenario] ?? traces.completed!
    const build = scenario === 'build-warnings' ? builds.warnings : undefined
    return completed(examples.completed.version, fixture, build)
  }

  return [
    http.get(`${apiBaseUrl}/languages`, () =>
      HttpResponse.json(languages, { headers: { 'Cache-Control': 'max-age=300' } }),
    ),

    http.post(`${apiBaseUrl}/visualizations`, async () => {
      const refused = refusals[scenario]
      if (refused !== undefined) return refuse(refused)
      polls = 0
      const body = await current()
      return HttpResponse.json(body, {
        status: 201,
        headers: { Location: `${apiBaseUrl}/visualizations/${body.id}` },
      })
    }),

    http.get(`${apiBaseUrl}/visualizations/:id`, async ({ request }) => {
      const refused = pollRefusals[scenario]
      if (refused !== undefined) return refuse(refused)
      if (scenario === 'slow-tracing' && new URL(request.url).searchParams.has('wait')) {
        await delay()
        polls++
      }
      return HttpResponse.json(await current())
    }),

    http.delete(`${apiBaseUrl}/visualizations/:id`, () => new HttpResponse(null, { status: 204 })),

    http.get(`${chunkOrigin}/:trace/:file`, ({ request }) => {
      const url = new URL(request.url)
      const body = bodies.get(`${url.origin}${url.pathname}`)
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
