import createClient from 'openapi-fetch'
import { config } from './config.ts'
import type { components, paths } from './gen/api.ts'

export type Language = components['schemas']['Language']
// what openapi-fetch returns: its Readable<T> turns the schema's tuples into arrays
export type Visualization = Awaited<ReturnType<typeof getVisualization>>
export type CreateRequest = components['schemas']['CreateVisualizationRequest']
// open: a newer API may send a code this build doesn't know
type ErrorCode = components['schemas']['Error']['code'] | (string & {})

export type ApiError = Error & {
  name: 'ApiError'
  status: number
  // null: the body isn't the §8.7 envelope, such as a proxy's 502 page
  code: ErrorCode | null
  retryAfterSec: number | null
  requestId: string | null
}

const client = createClient<paths>({
  baseUrl: config.apiBaseUrl,
  // openapi-fetch keeps the fetch it was created with => look it up per call, or MSW in Node misses it
  fetch: (request) => fetch(request),
})

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && e.name === 'ApiError'
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function apiError(fields: Omit<ApiError, 'name' | 'message'>, message: string): ApiError {
  return Object.assign(new Error(message), fields, { name: 'ApiError' as const })
}

function failure(response: Response, body: unknown): ApiError {
  const header = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
  const retryAfterSec = Number.isNaN(header) ? null : header
  const envelope = isRecord(body) && isRecord(body.error) ? body.error : null
  if (
    envelope === null ||
    typeof envelope.code !== 'string' ||
    typeof envelope.message !== 'string'
  ) {
    return apiError(
      { status: response.status, code: null, retryAfterSec, requestId: null },
      `The API answered HTTP ${response.status}.`,
    )
  }
  return apiError(
    {
      status: response.status,
      code: envelope.code,
      retryAfterSec,
      requestId: typeof envelope.requestId === 'string' ? envelope.requestId : null,
    },
    envelope.message,
  )
}

// §11: the API answers 413 above these
const maxBytes = { source: 64 << 10, stdin: 64 << 10 }

function checkSize(request: CreateRequest) {
  for (const field of ['source', 'stdin'] as const) {
    const bytes = new TextEncoder().encode(request[field]).length
    if (bytes > maxBytes[field]) {
      throw apiError(
        { status: 413, code: 'payload_too_large', retryAfterSec: null, requestId: null },
        `${field} is ${bytes} bytes, over the ${maxBytes[field] >> 10} KB limit`,
      )
    }
  }
}

export async function listLanguages(signal: AbortSignal) {
  const { data, error, response } = await client.GET('/languages', { signal })
  if (data === undefined) throw failure(response, error)
  return data.languages
}

export async function createVisualization(request: CreateRequest, idempotencyKey: string) {
  checkSize(request)
  const { data, error, response } = await client.POST('/visualizations', {
    params: { header: { 'Idempotency-Key': idempotencyKey } },
    body: request,
  })
  if (data === undefined) throw failure(response, error)
  return data
}

export async function getVisualization(id: string, since: number | null, signal?: AbortSignal) {
  const { data, error, response } = await client.GET('/visualizations/{id}', {
    params: { path: { id }, query: since === null ? {} : { wait: 20, since } },
    signal,
  })
  if (data === undefined) throw failure(response, error)
  return data
}

export async function deleteVisualization(id: string) {
  const { error, response } = await client.DELETE('/visualizations/{id}', {
    params: { path: { id } },
  })
  if (!response.ok) throw failure(response, error)
}
