// S3: keydown-to-DOM per step on a production build, arrows on and off, with and without CPU throttle.
// Usage: node plans/spikes/s3/run.mjs [--steps 200] [--fixture synthetic-5000] [--no-build]
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    steps: { type: 'string', default: '200' },
    fixture: { type: 'string', default: 'synthetic-5000' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    out: { type: 'string', default: join(tmpdir(), 's3-dist') },
    'no-build': { type: 'boolean', default: false },
    chrome: {
      type: 'string',
      default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
})

const ide = resolve(import.meta.dirname, '../../../web/apps/ide')
const port = 4181

async function build() {
  const require = createRequire(join(ide, 'package.json'))
  const vite = await import(require.resolve('vite'))
  process.env.VITE_FLAGS = 'visualize'
  await vite.build({
    root: ide,
    configFile: join(ide, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir: args.out, emptyOutDir: true },
    plugins: [
      {
        name: 's3-fixture-in-prod',
        enforce: 'pre',
        transform(code, id) {
          if (!id.endsWith('/src/main.tsx')) return null
          const swapped = code.replace(
            'if (import.meta.env.DEV) {',
            "if (new URLSearchParams(location.search).has('fixture')) {",
          )
          if (swapped === code) throw new Error('main.tsx: fixture check not found')
          return swapped
        },
      },
    ],
  })
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' }

function serve(dir) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      let file = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html')
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
    })
    server.listen(port, '127.0.0.1', () => done(server))
  })
}

async function cdp(url) {
  const ws = new WebSocket(url)
  await new Promise((ok, fail) => {
    ws.onopen = ok
    ws.onerror = fail
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) fail(new Error(JSON.stringify(msg.error)))
      else ok(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      pending.set(++id, { ok, fail })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  return { send, evaluate, close: () => ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// runs in the page: keydown → the state pane's next DOM mutation, then a forced layout
const measureSteps = (count) => `(async () => {
  const pane = document.querySelector('[aria-label="Resize panes"]').nextElementSibling
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  const times = []
  const arrows = []
  for (let i = 0; i < ${count}; i++) {
    await frame()
    await frame()
    const t0 = performance.now()
    const changed = new Promise((r) => {
      const mo = new MutationObserver(() => {
        mo.disconnect()
        document.body.getBoundingClientRect()
        pane.firstElementChild.getBoundingClientRect()
        r(performance.now())
      })
      mo.observe(pane, { subtree: true, childList: true, characterData: true, attributes: true })
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    times.push((await changed) - t0)
    arrows.push(pane.querySelectorAll('svg path[data-to]').length)
  }
  const svg = pane.querySelector('svg[aria-hidden]')
  return { times, arrows, labelsOnly: svg?.hasAttribute('data-labels-only') ?? false,
    cards: pane.querySelectorAll('[data-card]').length, labels: pane.querySelectorAll('[data-arrow-to]').length }
})()`

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { p50: q(0.5), p95: q(0.95), max: s.at(-1) }
}

if (!args['no-build']) await build()
const server = await serve(args.out)
const profile = mkdtempSync(join(tmpdir(), 's3-chrome-'))
const chrome = spawn(args.chrome, [
  '--headless=new',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`,
  `--window-size=${args.width},${args.height}`,
  '--no-first-run',
  'about:blank',
])
let page
for (let tries = 0; tries < 50 && !page; tries++) {
  await sleep(200)
  const list = await fetch('http://127.0.0.1:9333/json/list').then((r) => r.json(), () => [])
  page = list.find((t) => t.type === 'page')
}
const c = await cdp(page.webSocketDebuggerUrl)
await c.send('Runtime.enable')
const url = `http://127.0.0.1:${port}/?fixture=${args.fixture}`

const rows = []
for (const throttle of [1, 4]) {
  for (const drawArrows of [true, false]) {
    await c.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await c.send('Page.navigate', { url })
    await sleep(1500)
    await c.evaluate(`localStorage.setItem('viz-player', JSON.stringify({ state: { settings: { drawArrows: ${drawArrows} } }, version: 1 }))`)
    await c.send('Page.navigate', { url })
    for (let t = 0; t < 100; t++) {
      await sleep(200)
      if (await c.evaluate(`/Step 1 of/.test(document.body.textContent)`)) break
    }
    await sleep(500)
    await c.send('Emulation.setCPUThrottlingRate', { rate: throttle })
    const r = await c.evaluate(measureSteps(Number(args.steps)))
    const s = stats(r.times)
    const drawn = stats(r.arrows)
    rows.push({ throttle: `${throttle}x`, arrows: drawArrows ? 'on' : 'off', p50: s.p50.toFixed(1), p95: s.p95.toFixed(1), max: s.max.toFixed(1), drawnP50: drawn.p50, drawnMax: drawn.max, labelsOnly: r.labelsOnly, cards: r.cards, labels: r.labels })
  }
}
console.table(rows)
c.close()
chrome.kill()
server.close()
