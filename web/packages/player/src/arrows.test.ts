import { describe, expect, test } from 'vitest'
import { maxArrows, route, type Box, type Source } from './arrows.ts'

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

const view = box(0, 0, 1000, 600)
const label = (to: string, row: number): Source => ({ to, box: box(100, row * 24, 60, 16) })
const cards = new Map([
  ['o1', box(400, 0, 300, 80)],
  ['o2', box(400, 100, 300, 80)],
  ['far', box(400, 5000, 300, 80)],
])

function start(d: string) {
  return /^M([\d.-]+) ([\d.-]+)C/.exec(d)!.slice(1).map(Number)
}

function end(d: string) {
  return d.split(' ').slice(-2).map(Number)
}

describe('route', () => {
  test('an arrow leaves the right edge of its label, and its head touches the left edge of the card', () => {
    const { arrows, bundles } = route([label('o2', 1)], cards, view, null)
    expect(arrows).toHaveLength(1)
    const [sx, sy] = start(arrows[0]!.d)
    expect(sx).toBeGreaterThan(160)
    expect(sx).toBeLessThan(170)
    expect(sy).toBe(24 + 8)
    const [jx, jy] = end(arrows[0]!.d)
    expect(jx).toBeLessThan(400)
    expect(jy).toBeGreaterThan(100)
    expect(jy).toBeLessThan(180)
    expect(bundles).toEqual([expect.objectContaining({ to: 'o2' })])
    expect(bundles[0]!.head.startsWith(`M400 ${jy}`)).toBe(true)
    expect(bundles[0]!.stem.startsWith(`M${jx} ${jy}`)).toBe(true)
  })

  test('arrows to the same card meet at one point and share one stem and head', () => {
    const { arrows, bundles } = route(
      [label('o2', 0), label('o2', 1), label('o1', 2)],
      cards,
      view,
      null,
    )
    expect(arrows.map((a) => a.to)).toEqual(['o2', 'o2', 'o1'])
    expect(end(arrows[0]!.d)).toEqual(end(arrows[1]!.d))
    expect(end(arrows[0]!.d)).not.toEqual(end(arrows[2]!.d))
    expect(bundles.map((b) => b.to)).toEqual(['o2', 'o1'])
  })

  test('an arrow is drawn when either end is in view, and dropped when neither is', () => {
    const offscreen = { to: 'far', box: box(100, 4000, 60, 16) }
    const toFar = label('far', 0)
    const toNear = { to: 'o1', box: box(100, 4000, 60, 16) }
    const { arrows } = route([offscreen, toFar, toNear], cards, view, null)
    expect(arrows).toHaveLength(2)
    expect(arrows.map((a) => a.to)).toEqual(['far', 'o1'])
  })

  test('a label whose target has no card gets no arrow', () => {
    expect(route([label('o9', 0)], cards, view, null)).toEqual({
      arrows: [],
      bundles: [],
      labelsOnly: false,
    })
  })

  test.each([
    { name: `${maxArrows} visible arrows are all drawn`, count: maxArrows, drawn: maxArrows },
    {
      name: `${maxArrows + 1} visible arrows fall back to labels only`,
      count: maxArrows + 1,
      drawn: 0,
    },
  ])('$name', ({ count, drawn }) => {
    const sources = Array.from({ length: count }, (_, i) => label(i % 2 ? 'o1' : 'o2', i % 20))
    const scene = route(sources, cards, view, null)
    expect(scene.arrows).toHaveLength(drawn)
    expect(scene.labelsOnly).toBe(drawn === 0)
  })

  test('with labels only, hovering a card draws just the arrows into it', () => {
    const sources = Array.from({ length: 40 }, (_, i) => label(i < 3 ? 'o1' : 'o2', i % 20))
    const scene = route(sources, cards, view, 'o1')
    expect(scene.labelsOnly).toBe(true)
    expect(scene.arrows.map((a) => a.to)).toEqual(['o1', 'o1', 'o1'])
    expect(scene.bundles.map((b) => b.to)).toEqual(['o1'])
  })

  test('an arrow back to a card left of its label still enters from the left', () => {
    const inside = { to: 'o2', box: box(600, 40, 60, 16) }
    const { arrows, bundles } = route([inside], cards, view, null)
    const [jx] = end(arrows[0]!.d)
    expect(jx).toBeLessThan(400)
    expect(bundles[0]!.head.startsWith('M400 ')).toBe(true)
  })
})
