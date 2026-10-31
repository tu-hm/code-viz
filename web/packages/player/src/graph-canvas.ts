import { layerBorder } from '@sigma/node-border'
import type Graph from 'graphology'
import Sigma, { type Camera } from 'sigma'
import {
  extremityArrow,
  layerDashed,
  layerPlain,
  pathCurved,
  pathLine,
  sdfRectangle,
} from 'sigma/rendering'
import { graphPadding, nodeHeight, nodeWidth, type Point } from './graph.ts'

export type NodeData = {
  text: string
  seen: boolean | null
  here: boolean
  caption: string | null
  pointer: string | null
}
export type EdgeData = { live: boolean; on: boolean; weight: string }
type NodeAttributes = Point & Partial<NodeData>
type EdgeAttributes = { curvature: number } & Partial<EdgeData>
export type CanvasGraph = Graph<NodeAttributes, EdgeAttributes>
export type Canvas = { getCamera(): Pick<Camera, 'zoomIn' | 'zoomOut' | 'reset'>; kill(): void }

const aspect = nodeWidth / nodeHeight
const labelFont = 12
const tagClass = 'absolute rounded-sm bg-card px-0.5 whitespace-nowrap'

function paletteOf(el: Element) {
  const style = getComputedStyle(el)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    surface: read('--bg-surface'),
    text: read('--content-primary'),
    brand: read('--content-brand'),
    brandSubtle: read('--bg-brand-subtle'),
    border: read('--border-default'),
    unset: read('--trace-unset'),
    arrow: read('--trace-arrow'),
    index: read('--trace-index'),
  }
}

function place(el: HTMLElement, text: string, x: number, y: number) {
  if (el.textContent !== text) el.textContent = text
  el.hidden = text === ''
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

// what sigma's labels can't draw: a caption under the box, ◀ u beside it, weights upright
function annotate(renderer: Sigma<NodeAttributes, EdgeAttributes>) {
  const notes = renderer.createLayer<HTMLDivElement>('notes', 'div', {
    style: { inset: '0', pointerEvents: 'none', overflow: 'hidden' },
  })
  notes.className = 'font-mono text-[11px] leading-none'
  const tag = (className: string) => {
    const el = document.createElement('span')
    el.className = `${tagClass} ${className}`
    notes.append(el)
    return el
  }
  const graph = renderer.getGraph()
  const nodes = graph.nodes().map((n) => ({
    n,
    caption: tag('-translate-x-1/2 text-muted-foreground'),
    pointer: tag('-translate-y-1/2 text-trace-index'),
  }))
  const edges = graph.edges().map((e) => ({
    e,
    ends: graph.extremities(e),
    weight: tag('-translate-1/2 text-muted-foreground'),
  }))
  const draw = () => {
    for (const { n, caption, pointer } of nodes) {
      const data = renderer.getNodeDisplayData(n)!
      const at = renderer.framedGraphToViewport(data)
      const half = renderer.scaleSize(data.size)
      const attributes = graph.getNodeAttributes(n)
      place(caption, attributes.caption ?? '', at.x, at.y + half / aspect + 3)
      place(pointer, attributes.pointer ?? '', at.x + half + 4, at.y)
    }
    for (const { e, ends, weight } of edges) {
      const a = renderer.getNodeDisplayData(ends[0])!
      const b = renderer.getNodeDisplayData(ends[1])!
      const { live, weight: text, curvature } = graph.getEdgeAttributes(e)
      // pathCurved's midpoint: half its control point's offset from the chord
      const bend = curvature / 2
      const at = renderer.framedGraphToViewport({
        x: (a.x + b.x) / 2 - (b.y - a.y) * bend,
        y: (a.y + b.y) / 2 + (b.x - a.x) * bend,
      })
      place(weight, live === true ? (text ?? '') : '', at.x, at.y)
    }
  }
  renderer.on('afterRender', draw)
  draw()
}

export function drawGraph(container: HTMLElement, graph: CanvasGraph, undirected: boolean): Canvas {
  const palette = paletteOf(container)
  const mono = getComputedStyle(container).getPropertyValue('--font-family-mono')
  const renderer = new Sigma(graph, container, {
    primitives: {
      nodes: {
        shapes: [sdfRectangle({ aspectRatio: aspect, cornerRadius: 0.25 })],
        variables: {
          borderSize: { type: 'number', default: 1 },
          borderColor: { type: 'color', default: palette.border },
        },
        layers: [
          layerBorder({
            borders: [
              {
                size: { attribute: 'borderSize' },
                color: { attribute: 'borderColor' },
                mode: 'pixels',
              },
              { size: 0, color: { attribute: 'color' }, fill: true },
            ],
          }),
        ],
        label: { font: { family: mono, size: labelFont } },
      },
      edges: {
        paths: [pathLine(), pathCurved()],
        extremities: [extremityArrow()],
        variables: {
          curvature: { type: 'number', default: 0 },
          dash: { type: 'number', default: 0 },
          gap: { type: 'color', default: palette.surface },
        },
        layers: [
          layerPlain(),
          layerDashed({
            dashSize: { attribute: 'dash', mode: 'pixels' },
            gapSize: { value: 3, mode: 'pixels' },
            gapColor: { attribute: 'gap' },
          }),
        ],
      },
    },
    styles: {
      nodes: {
        x: { attribute: 'x' },
        y: { attribute: 'y' },
        size: nodeWidth / 2,
        color: (a) => (a.seen === true ? palette.brandSubtle : palette.surface),
        borderColor: (a) =>
          a.here === true ? palette.brand : a.seen === false ? palette.unset : palette.border,
        borderSize: (a) => (a.here === true ? 2.5 : 1.25),
        label: { attribute: 'text', defaultValue: '' },
        labelColor: () => palette.text,
        labelFont: mono, // sigma's display default, sans-serif, wins over the primitives' font
        labelPosition: 'over',
        labelVisibility: 'visible',
      },
      edges: {
        visibility: (a) => (a.live === true ? 'visible' : 'hidden'),
        path: (a) => (a.curvature === 0 ? 'line' : 'curved'),
        curvature: { attribute: 'curvature' },
        head: undirected ? 'none' : 'arrow',
        size: (a) => (a.on === true ? 2 : 1.25),
        color: (a) => (a.on === true ? palette.index : palette.arrow),
        dash: (a) => (a.on === true ? 4 : 0),
        gap: () => palette.surface,
      },
    },
    settings: {
      zoomToSizeRatioFunction: () => 1,
      autoRescaleContent: 'nodes',
      stagePadding: graphPadding,
      gestureTarget: 'shared',
      labelRenderedSizeThreshold: 0,
      minCameraRatio: 0.1,
      maxCameraRatio: 4,
    },
  })
  annotate(renderer)
  const theme = new MutationObserver(() => {
    Object.assign(palette, paletteOf(container))
    renderer.refresh()
  })
  theme.observe(document.documentElement, { attributeFilter: ['data-theme'] })
  renderer.on('kill', () => theme.disconnect())
  return renderer
}
