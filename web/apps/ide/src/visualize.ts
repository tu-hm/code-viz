import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createVisualization,
  deleteVisualization,
  getVisualization,
  isApiError,
  listLanguages,
  type CreateRequest,
  type Language,
  type Visualization,
} from './api.ts'

const finalStatuses: readonly Visualization['status'][] = ['completed', 'failed', 'canceled']

export function isFinal(v: Visualization) {
  return finalStatuses.includes(v.status)
}

// fetch rejects with a TypeError when the request never got an answer
function isNetworkError(e: unknown) {
  return e instanceof TypeError
}

function retryDelay(failures: number, e: unknown) {
  if (isApiError(e) && e.retryAfterSec !== null) return e.retryAfterSec * 1000
  return Math.min(1000 * 2 ** failures, 30_000)
}

export const languagesQuery = queryOptions({
  queryKey: ['languages'],
  queryFn: ({ signal }) => listLanguages(signal),
  staleTime: 5 * 60_000,
})

export function visualizationQuery(created: Visualization) {
  return queryOptions({
    queryKey: ['visualizations', created.id],
    queryFn: async ({ queryKey, signal, client }) => {
      let v = client.getQueryData<Visualization>(queryKey) ?? created
      while (!isFinal(v)) {
        v = await getVisualization(v.id, v.version, signal)
        client.setQueryData(queryKey, v)
      }
      return v
    },
    initialData: created,
    // 1 + 2 + 4 + 8 + 16 + 30 s: outlasts an API restart
    retry: (failures, e) =>
      failures < 6 && (isNetworkError(e) || (isApiError(e) && [502, 503, 504].includes(e.status))),
    retryDelay,
  })
}

export type Run = {
  key: string
  request: CreateRequest
  language: Language
  // settles once; null when the create failed, which the mutation shows
  created: Promise<Visualization | null>
}

async function cancel(queryClient: QueryClient, run: Run) {
  const created = await run.created
  if (created === null) return
  const { queryKey } = visualizationQuery(created)
  if (isFinal(queryClient.getQueryData(queryKey) ?? created)) return
  await queryClient.cancelQueries({ queryKey })
  await deleteVisualization(created.id)
}

export function useRun() {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: ({ request, key }: Omit<Run, 'created'>) => createVisualization(request, key),
    // same Idempotency-Key on every attempt => a retry never makes a second visualization
    retry: (failures, e) => failures < 3 && isNetworkError(e),
    retryDelay,
  })
  const [run, setRun] = useState<Run | null>(null)

  function stop() {
    if (run !== null) cancel(queryClient, run).catch(reportError)
  }

  return {
    run,
    created: create.data,
    error: create.error,
    start: (request: CreateRequest, language: Language) => {
      stop()
      const next = { key: crypto.randomUUID(), request, language }
      const created = create.mutateAsync(next).catch(() => null)
      setRun({ ...next, created })
    },
    // same Idempotency-Key: if the refused create made a visualization after all, the API returns it
    retry: () => {
      if (run === null) return
      const { key, request, language } = run
      const created = create.mutateAsync({ key, request, language }).catch(() => null)
      setRun({ ...run, created })
    },
    close: () => {
      stop()
      create.reset()
      setRun(null)
    },
  }
}
