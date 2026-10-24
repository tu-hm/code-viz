import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const css = ['primitives.css', 'semantic.css']
  .map((f) => readFileSync(new URL(`./styles/${f}`, import.meta.url), 'utf8'))
  .join('\n')

function declarations(selector: string) {
  const vars = new Map<string, string>()
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = sel!
      .replace(/\/\*.*?\*\//gs, '')
      .split(',')
      .map((s) => s.trim())
    if (!selectors.includes(selector)) continue
    for (const [, name, value] of body!.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      vars.set(name!, value!.trim())
    }
  }
  return vars
}

const light = declarations(':root')
const themes = {
  light,
  dark: new Map([...light, ...declarations("[data-theme='dark']")]),
}

function resolve(vars: Map<string, string>, name: string): string {
  const value = vars.get(name)
  if (value === undefined) throw new Error(`--${name} is not defined`)
  const ref = /^var\(--([\w-]+)\)$/.exec(value)
  return ref ? resolve(vars, ref[1]!) : value
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function over(fg: string, alpha: number, bg: string) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `#${[1, 3, 5]
    .map((i) => Math.round(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const text = 4.5
const mark = 3

const pairs: [fg: string, bgs: string[], min: number][] = [
  [
    'content-primary',
    ['bg-canvas', 'bg-surface', 'bg-surface-alt', 'bg-raised', 'bg-brand-subtle'],
    text,
  ],
  [
    'content-primary',
    ['trace-executed-bg', 'trace-write-bg', 'trace-changed-bg', 'trace-error-bg'],
    text,
  ],
  ['content-secondary', ['bg-canvas', 'bg-surface', 'bg-surface-alt', 'bg-raised'], text],
  ['content-brand', ['bg-canvas', 'bg-surface', 'bg-surface-alt', 'bg-brand-subtle'], text],
  ['content-danger', ['bg-canvas', 'bg-surface', 'bg-danger-subtle'], text],
  ['content-warning', ['bg-canvas', 'bg-surface', 'bg-warning-subtle'], text],
  ['content-success', ['bg-canvas', 'bg-surface', 'bg-success-subtle'], text],
  ['content-on-fill', ['bg-fill-brand', 'bg-fill-brand-hover', 'bg-fill-brand-press'], text],
  ['content-on-fill', ['bg-fill-danger', 'bg-fill-danger-hover', 'bg-fill-danger-press'], text],
  ['trace-index', ['bg-canvas', 'bg-surface'], text],
  ['trace-error-mark', ['bg-canvas', 'bg-surface', 'trace-error-bg'], text],
  ['trace-executed-mark', ['trace-executed-bg', 'bg-canvas', 'bg-surface'], mark],
  ['trace-next-mark', ['bg-canvas', 'bg-surface'], mark],
  ['trace-write-mark', ['trace-write-bg', 'bg-canvas', 'bg-surface'], mark],
  ['trace-read-mark', ['bg-canvas', 'bg-surface'], mark],
  ['trace-unset', ['bg-canvas', 'bg-surface'], mark],
  ['trace-arrow', ['bg-canvas', 'bg-surface'], mark],
  ['trace-arrow-active', ['bg-canvas', 'bg-surface'], mark],
  ['content-tertiary', ['bg-canvas', 'bg-surface'], mark],
  ['border-control', ['bg-canvas', 'bg-surface'], mark],
  ['border-focus', ['bg-canvas', 'bg-surface'], mark],
  ['syntax-keyword', ['bg-surface', 'trace-executed-bg', 'trace-error-bg'], text],
  ['syntax-string', ['bg-surface', 'trace-executed-bg', 'trace-error-bg'], text],
  ['syntax-comment', ['bg-surface', 'trace-executed-bg', 'trace-error-bg'], text],
]

const heatTints = [0.15, 0.25, 0.4]

describe.each(Object.entries(themes))('%s theme', (_, vars) => {
  const cases = pairs.flatMap(([fg, bgs, min]) => bgs.map((bg) => ({ fg, bg, min })))

  test.each(cases)('$fg on $bg is at least $min:1', ({ fg, bg, min }) => {
    expect(contrast(resolve(vars, fg), resolve(vars, bg))).toBeGreaterThanOrEqual(min)
  })

  test.each(heatTints)(
    'content-primary on trace-heat at %s over bg-surface is at least 4.5:1',
    (alpha) => {
      const tint = over(resolve(vars, 'trace-heat'), alpha, resolve(vars, 'bg-surface'))
      expect(contrast(resolve(vars, 'content-primary'), tint)).toBeGreaterThanOrEqual(text)
    },
  )
})
