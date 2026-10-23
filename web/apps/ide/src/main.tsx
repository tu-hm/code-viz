import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { config } from './config.ts'
import './index.css'

// DEV is a build-time constant => the 588 kB mock chunk stays out of production builds
if (import.meta.env.DEV && config.useMsw) {
  const { startMocks } = await import('./mocks/browser.ts')
  await startMocks()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
