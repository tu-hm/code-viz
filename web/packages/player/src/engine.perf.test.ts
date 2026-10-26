// @vitest-environment node
import { loadFixture } from '@viz/fixtures'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { describe, expect, test } from 'vitest'
import { createEngine } from './engine.ts'

const budgetMs = 16
const forward = (n: number) => Array.from({ length: n }, (_, k) => k)
const orders = {
  forward,
  backward: (n: number) => forward(n).reverse(),
  jumps: (n: number) => forward(n).map((k) => (k * 7919) % n),
}

function timesToCopyOut(name: string, order: number[]) {
  const engine = createEngine(loadFixture(name).chunks.flat())
  return order.map((k) => {
    const start = performance.now()
    structuredClone(engine.state(k))
    return performance.now() - start
  })
}

function quantile(times: number[], q: number) {
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}

const ms = (t: number) => `${t.toFixed(2)} ms`

describe.each(Object.entries(orders))('stepping %s', (order, sequence) => {
  test(`synthetic-1000: every step within ${budgetMs} ms, median of 3 cold runs`, () => {
    const n = loadFixture('synthetic-1000').header.summary.stepCount
    const runs = [1, 2, 3].map(() => timesToCopyOut('synthetic-1000', sequence(n)))
    const medians = forward(n).map((i) => quantile([runs[0]![i]!, runs[1]![i]!, runs[2]![i]!], 0.5))
    console.log(
      `synthetic-1000 ${order}: p50 ${ms(quantile(medians, 0.5))}, max ${ms(quantile(medians, 1))}`,
    )
    expect(quantile(medians, 1)).toBeLessThanOrEqual(budgetMs)
  })
})

test(`synthetic-5000: 99% of 1,000 jumps within ${budgetMs} ms`, { timeout: 30_000 }, () => {
  const n = loadFixture('synthetic-5000').header.summary.stepCount
  const times = timesToCopyOut('synthetic-5000', orders.jumps(n).slice(0, 1000))
  console.log(
    `synthetic-5000 jumps: p50 ${ms(quantile(times, 0.5))}, p99 ${ms(quantile(times, 0.99))}, max ${ms(quantile(times, 1))}`,
  )
  expect(quantile(times, 0.99)).toBeLessThanOrEqual(budgetMs)
})

test('synthetic-5000: the trace and a full cache stay under 300 MB', { timeout: 30_000 }, () => {
  setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc') as () => void
  gc()
  const before = process.memoryUsage().heapUsed
  const engine = createEngine(structuredClone(loadFixture('synthetic-5000').chunks.flat()))
  for (const k of orders.jumps(engine.stepCount)) engine.state(k)
  gc()
  const mb = (process.memoryUsage().heapUsed - before) / 2 ** 20
  console.log(`synthetic-5000: ${mb.toFixed(0)} MB retained for ${engine.stepCount} steps`)
  expect(mb).toBeLessThan(300)
})
