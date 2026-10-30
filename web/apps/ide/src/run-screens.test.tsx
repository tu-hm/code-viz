import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ApiError, Visualization } from './api.ts'
import { waitText } from './countdown.ts'
import { ApiErrorScreen, EndedScreen, LoadingScreen } from './run-screens.tsx'

afterEach(() => {
  vi.useRealTimers()
})

const noop = () => {}

const visualization = (patch: Partial<Visualization>): Visualization => ({
  id: 'viz_5f2c9d3a7b1e4c08',
  status: 'queued',
  version: 1,
  language: 'cpp17-gcc',
  createdAt: '2026-10-23T08:12:03Z',
  ...patch,
})

function apiError(fields: Partial<ApiError>): ApiError {
  return Object.assign(new Error(fields.message ?? 'message from the API'), {
    name: 'ApiError' as const,
    status: 500,
    code: null,
    retryAfterSec: null,
    requestId: 'req_1',
    ...fields,
  })
}

describe('loading (§5.6)', () => {
  test.each([
    { name: 'sending', v: null, status: 'Sending…', current: 'Queued', steps: null },
    { name: 'queued', v: visualization({}), status: 'Queued…', current: 'Queued', steps: null },
    {
      name: 'building',
      v: visualization({ status: 'building' }),
      status: 'Building…',
      current: 'Building',
      steps: null,
    },
    {
      name: 'tracing',
      v: visualization({ status: 'tracing', progress: { steps: 412 } }),
      status: 'Tracing (412 steps so far)…',
      current: 'Tracing (412 steps so far)',
      steps: '412',
    },
  ])('$name', ({ v, status, current, steps }) => {
    render(
      <LoadingScreen language="C++17 (GCC 13)" visualization={v} maxSteps={1000} onCancel={noop} />,
    )
    expect(screen.getByRole('status').textContent).toBe(status)
    const step = screen.getAllByRole('listitem').find((li) => li.ariaCurrent === 'step')
    expect(step?.textContent).toBe(`◌ ${current}`)
    const bar = screen.getByRole('progressbar', { name: 'Steps traced' })
    expect(bar.getAttribute('aria-valuenow')).toBe(steps)
    expect(bar.getAttribute('aria-valuemax')).toBe('1000')
  })
})

describe('API errors (§5.6, §8.7)', () => {
  test('Retry waits for Retry-After, counting down', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] })
    const error = apiError({ status: 503, code: 'capacity', retryAfterSec: 5 })
    render(
      <ApiErrorScreen
        language="Python 3.12"
        error={error}
        onRetry={noop}
        onRerun={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry in 5 s' })).toHaveProperty('disabled', true)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByRole('button', { name: 'Retry in 2 s' })).toHaveProperty('disabled', true)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveProperty('disabled', false)
  })

  test.each([
    {
      name: 'a dropped connection can be retried',
      error: new TypeError('Failed to fetch'),
      text: "Couldn't reach the visualizer. Check your connection.",
      buttons: ['Retry', 'Close'],
    },
    {
      name: 'a proxy page is ours, with what it said',
      error: apiError({ status: 502, message: 'The API answered HTTP 502.', requestId: null }),
      text: 'Something went wrong on our side.The API answered HTTP 502.',
      buttons: ['Retry', 'Close'],
    },
    {
      name: 'a program over the size limit cannot be retried',
      error: apiError({
        status: 413,
        code: 'payload_too_large',
        message: 'source is 70000 bytes, over the 64 KB limit',
        requestId: null,
      }),
      text: 'This program is too big to visualize.source is 70000 bytes, over the 64 KB limit',
      buttons: ['Close'],
    },
    {
      name: 'a request the API refused shows its reason',
      error: apiError({ status: 400, code: 'invalid_request', message: 'wait is over 20' }),
      text: "The visualizer couldn't take this request.wait is over 20Request ID: req_1",
      buttons: ['Close'],
    },
  ])('$name', ({ error, text, buttons }) => {
    render(
      <ApiErrorScreen
        language="Python 3.12"
        error={error}
        onRetry={noop}
        onRerun={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(text)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(buttons)
  })

  test.each([
    { seconds: 20, text: '20 s' },
    { seconds: 120, text: '2 min' },
    { seconds: 260, text: '4 min 20 s' },
    { seconds: 31864, text: '8 h 51 min' },
  ])('waits read as $text', ({ seconds, text }) => {
    expect(waitText(seconds)).toBe(text)
  })
})

describe('build errors (§5.6, FR-22)', () => {
  test('the excerpt puts the caret under the column, past tabs', () => {
    const v = visualization({
      status: 'failed',
      failure: { stage: 'build', kind: 'compile_error' },
      build: {
        ok: false,
        durationMs: 1,
        diagnostics: [{ line: 9, column: 11, severity: 'error', message: "expected ';'" }],
      },
    })
    const source = [...Array.from({ length: 8 }, () => ''), '\tint x = 5', '\treturn 0;'].join('\n')
    render(
      <EndedScreen
        language="C++17 (GCC 13)"
        visualization={v}
        source={source}
        onGoToLine={noop}
        onRerun={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByText(/int x = 5/).textContent).toBe(
      ' 9 | \tint x = 5\n   | \t         ^\n10 | \treturn 0;',
    )
  })

  test('with no diagnostics the raw output is the message', () => {
    const v = visualization({
      status: 'failed',
      failure: { stage: 'build', kind: 'compile_error' },
      build: { ok: false, durationMs: 10000, diagnostics: [], raw: 'Build timed out' },
    })
    render(
      <EndedScreen
        language="C++17 (GCC 13)"
        visualization={v}
        source=""
        onGoToLine={noop}
        onRerun={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByText('Build timed out').tagName).toBe('PRE')
    expect(screen.queryByText('Raw compiler output')).toBeNull()
  })
})
