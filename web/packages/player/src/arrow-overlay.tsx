import { cn } from '@viz/ui'
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type RefObject,
  useState,
  useSyncExternalStore,
} from 'react'
import { noArrows, route, type Box, type Scene, type Source } from './arrows.ts'

const narrowScreen = '(max-width: 767.98px)' // §5.8
const reducedMotion = '(prefers-reduced-motion: reduce)'

type Tip = { text: string; left: number; top: number }

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
  )
}

function boxOf(el: Element, origin: DOMRect): Box {
  const r = el.getBoundingClientRect()
  return {
    left: r.left - origin.left,
    top: r.top - origin.top,
    right: r.right - origin.left,
    bottom: r.bottom - origin.top,
  }
}

function viewOf(root: HTMLElement, origin: DOMRect): Box {
  for (let p = root.parentElement; p !== null; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return boxOf(p, origin)
  }
  return {
    left: -origin.left,
    top: -origin.top,
    right: innerWidth - origin.left,
    bottom: innerHeight - origin.top,
  }
}

function collect(stack: HTMLElement, heap: HTMLElement) {
  return {
    cards: [...heap.children].filter((el) => el.hasAttribute('data-card')),
    stack: [...stack.querySelectorAll('[data-arrow-to]')],
  }
}

// els in document order run top to bottom (one column), so the onscreen ones are a slice
function onscreen(els: Element[], view: Box, origin: DOMRect) {
  let lo = 0
  let hi = els.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (els[mid]!.getBoundingClientRect().bottom - origin.top <= view.top) lo = mid + 1
    else hi = mid
  }
  const shown: [Element, Box][] = []
  for (let i = lo; i < els.length; i++) {
    const box = boxOf(els[i]!, origin)
    if (box.top >= view.bottom) break
    shown.push([els[i]!, box])
  }
  return shown
}

function measure(root: HTMLElement, found: ReturnType<typeof collect>) {
  const origin = root.getBoundingClientRect()
  const view = viewOf(root, origin)
  const to = (el: Element) => el.getAttribute('data-arrow-to')!
  const cardById = new Map(found.cards.map((el) => [el.getAttribute('data-card')!, el]))
  const cards = new Map<string, Box>()
  const shownCards = onscreen(found.cards, view, origin)
  for (const [el, box] of shownCards) cards.set(el.getAttribute('data-card')!, box)

  const sources: Source[] = []
  const measured = new Set<Element>()
  const add = (el: Element, box: Box) => {
    measured.add(el)
    sources.push({ to: to(el), box })
  }
  for (const [el, box] of onscreen(found.stack, view, origin)) add(el, box)
  // labels inside offscreen cards are skipped: content-visibility left them unlaid, measuring forces it
  for (const [card] of shownCards) {
    for (const el of card.querySelectorAll('[data-arrow-to]')) add(el, boxOf(el, origin))
  }
  for (const el of found.stack) {
    if (!measured.has(el) && cards.has(to(el))) add(el, boxOf(el, origin))
  }
  for (const { to } of sources) {
    const el = cardById.get(to)
    if (el !== undefined && !cards.has(to)) cards.set(to, boxOf(el, origin))
  }
  return { sources, cards, view }
}

function targetOf(node: EventTarget | null) {
  if (!(node instanceof Element)) return null
  const el = node.closest('[data-arrow-to], [data-card]')
  if (el === null) return null
  return el.getAttribute('data-arrow-to') ?? el.getAttribute('data-card')
}

function pointerOf(node: EventTarget | null) {
  return node instanceof Element ? node.closest<HTMLElement>('[data-addr]') : null
}

type OverlayProps = {
  redrawOn: unknown
  draw: boolean
  stack: RefObject<HTMLElement | null>
  heap: RefObject<HTMLElement | null>
}

export function ArrowOverlay({ redrawOn, draw, stack, heap }: OverlayProps) {
  const svg = useRef<SVGSVGElement>(null)
  const narrow = useMedia(narrowScreen)
  const [scene, setScene] = useState<Scene>(noArrows)
  const [active, setActive] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const on = draw && !narrow

  const marked = useRef<Element[]>([])

  const redraw = useEffectEvent(() => {
    const root = svg.current!.parentElement!
    for (const el of marked.current) el.removeAttribute('data-active')
    marked.current = []
    if (active !== null) {
      marked.current = [...root.querySelectorAll('[data-arrow-to], [data-card]')].filter(
        (el) => (el.getAttribute('data-arrow-to') ?? el.getAttribute('data-card')) === active,
      )
      for (const el of marked.current) el.setAttribute('data-active', '')
    }
    if (anchor?.isConnected) {
      const box = boxOf(anchor, root.getBoundingClientRect())
      setTip({ text: anchor.title, left: box.left, top: box.bottom + 4 })
    } else {
      setTip(null)
    }
    if (!on || stack.current === null || heap.current === null) {
      setScene(noArrows)
      return
    }
    const { sources, cards, view } = measure(root, collect(stack.current, heap.current))
    setScene(route(sources, cards, view, active))
  })

  useLayoutEffect(() => {
    redraw()
  }, [redrawOn, on, active, anchor])

  useEffect(() => {
    const root = svg.current!.parentElement!
    let frame = 0
    const schedule = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        redraw()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(root)
    addEventListener('scroll', schedule, { capture: true, passive: true })
    addEventListener('resize', schedule)

    const over = (e: Event) => setActive(targetOf(e.target))
    const leave = () => setActive(null)
    const focus = (e: Event) => {
      setActive(targetOf(e.target))
      setAnchor(pointerOf(e.target))
    }
    const blur = () => {
      setActive(null)
      setAnchor(null)
    }
    const click = (e: Event) => {
      if (!(e.target instanceof Element)) return
      const label = e.target.closest('[data-arrow-to]')
      if (label === null) return
      const to = label.getAttribute('data-arrow-to')
      const card = [...root.querySelectorAll('[data-card]')].find(
        (el) => el.getAttribute('data-card') === to,
      )
      card?.scrollIntoView({
        block: 'nearest',
        behavior: matchMedia(reducedMotion).matches ? 'instant' : 'smooth',
      })
      setAnchor(pointerOf(label))
    }
    root.addEventListener('pointerover', over)
    root.addEventListener('pointerleave', leave)
    root.addEventListener('focusin', focus)
    root.addEventListener('focusout', blur)
    root.addEventListener('click', click)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      removeEventListener('scroll', schedule, { capture: true })
      removeEventListener('resize', schedule)
      root.removeEventListener('pointerover', over)
      root.removeEventListener('pointerleave', leave)
      root.removeEventListener('focusin', focus)
      root.removeEventListener('focusout', blur)
      root.removeEventListener('click', click)
    }
  }, [])

  const order = (to: string) => (to === active ? 1 : 0)
  const arrows = scene.arrows.toSorted((a, b) => order(a.to) - order(b.to))
  const bundles = scene.bundles.toSorted((a, b) => order(a.to) - order(b.to))
  const stroke = (to: string) =>
    to === active ? 'stroke-trace-arrow-active' : 'stroke-trace-arrow'
  const fill = (to: string) => (to === active ? 'fill-trace-arrow-active' : 'fill-trace-arrow')

  return (
    <>
      <svg
        ref={svg}
        aria-hidden
        data-labels-only={scene.labelsOnly || undefined}
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {arrows.map((a, i) => (
          <path
            key={i}
            d={a.d}
            data-to={a.to}
            strokeWidth={a.to === active ? 2 : 1.25}
            className={cn('fill-none transition-colors duration-(--duration-fade)', stroke(a.to))}
          />
        ))}
        {bundles.map((b) => (
          <g
            key={b.to}
            className={cn('transition-colors duration-(--duration-fade)', stroke(b.to), fill(b.to))}
            strokeWidth={b.to === active ? 2 : 1.25}
          >
            <path d={b.stem} className="fill-none" />
            <path d={b.head} className="stroke-none" />
          </g>
        ))}
      </svg>
      {tip && (
        <div
          role="tooltip"
          style={{ left: tip.left, top: tip.top }}
          className="pointer-events-none absolute z-10 rounded-sm bg-popover px-2 py-1 font-mono text-xs whitespace-nowrap text-popover-foreground shadow-popover"
        >
          {tip.text}
        </div>
      )}
    </>
  )
}
