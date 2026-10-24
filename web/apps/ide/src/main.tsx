import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { config } from './config.ts'
import type { DevFixture } from './dev-fixture.ts'
import './index.css'

// DEV is a build-time constant => the 588 kB mock chunk stays out of production builds
if (import.meta.env.DEV && config.useMsw) {
  const { startMocks } = await import('./mocks/browser.ts')
  await startMocks()
}

let fixture: DevFixture | null = null
if (import.meta.env.DEV) {
  const { devFixture } = await import('./dev-fixture.ts')
  fixture = await devFixture(location.search)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App fixture={fixture} />
  </StrictMode>,
)
