import { setupWorker } from 'msw/browser'
import { config } from '../config.ts'
import { handlers, isScenario, scenarios } from './handlers.ts'

export async function startMocks() {
  const scenario = new URLSearchParams(location.search).get('scenario') ?? 'completed'
  if (!isScenario(scenario)) {
    throw new Error(`?scenario=${scenario}: want one of ${scenarios.join(', ')}`)
  }
  await setupWorker(...handlers(config.apiBaseUrl, scenario)).start({ onUnhandledFrame: 'bypass' })
}
