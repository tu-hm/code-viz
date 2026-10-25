export type Box = { left: number; top: number; right: number; bottom: number }

export type Source = { to: string; box: Box }

export type Arrow = { to: string; d: string }

export type Bundle = { to: string; stem: string; head: string }

export type Scene = { arrows: Arrow[]; bundles: Bundle[]; labelsOnly: boolean }

export const maxArrows = 30 // §5.9: above this, labels only and arrows on hover

const gap = 4
const entry = 14 // card title row
const stem = 16
const minBend = 24
const head = 6

export const noArrows: Scene = { arrows: [], bundles: [], labelsOnly: false }

function meets(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

const n = (x: number) => Math.round(x * 10) / 10

export function route(
  sources: Source[],
  cards: ReadonlyMap<string, Box>,
  view: Box,
  active: string | null,
): Scene {
  const visible = sources.filter((s) => {
    const card = cards.get(s.to)
    return card !== undefined && (meets(s.box, view) || meets(card, view))
  })
  const labelsOnly = visible.length > maxArrows
  const drawn = labelsOnly ? visible.filter((s) => s.to === active) : visible

  const arrows: Arrow[] = []
  const bundles = new Map<string, Bundle>()
  for (const { to, box } of drawn) {
    const card = cards.get(to)!
    const ex = card.left
    const ey = card.top + Math.min(entry, (card.bottom - card.top) / 2)
    const jx = ex - stem
    const sx = box.right + gap
    const sy = (box.top + box.bottom) / 2
    const bend = Math.max(minBend, Math.abs(jx - sx) / 2)
    arrows.push({
      to,
      d: `M${n(sx)} ${n(sy)}C${n(sx + bend)} ${n(sy)} ${n(jx - bend)} ${n(ey)} ${n(jx)} ${n(ey)}`,
    })
    if (!bundles.has(to)) {
      bundles.set(to, {
        to,
        stem: `M${n(jx)} ${n(ey)}H${n(ex - head)}`,
        head: `M${n(ex)} ${n(ey)}l${-head} ${-head / 1.5}v${n((head * 2) / 1.5)}z`,
      })
    }
  }
  return { arrows, bundles: [...bundles.values()], labelsOnly }
}
