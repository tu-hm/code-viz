import { fireEvent, screen, within } from '@testing-library/react'
import { loadFixture } from '@viz/fixtures'
import { beforeEach, expect, test, vi } from 'vitest'
import { usePlayer } from './store.ts'
import { cpp, python, renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

async function openSettings() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  return within(screen.getByRole('dialog', { name: 'Visualizer settings' }))
}

async function reload() {
  vi.resetModules()
  const fresh = await import('./store.ts')
  return fresh.usePlayer.getState()
}

test('settings survive a reload', async () => {
  renderPlayer('cpp-binary-search')
  const dialog = await openSettings()
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Draw reference arrows' }))
  fireEvent.click(dialog.getByRole('radio', { name: 'Dark' }))
  fireEvent.click(dialog.getByRole('radio', { name: 'Comfortable' }))
  fireEvent.click(dialog.getByRole('radio', { name: 'L' }))
  fireEvent.change(dialog.getByRole('combobox', { name: 'Autoplay speed' }), {
    target: { value: '4' },
  })
  fireEvent.change(dialog.getByRole('combobox', { name: 'Max steps' }), {
    target: { value: '5000' },
  })

  expect(document.documentElement.dataset).toMatchObject({
    theme: 'dark',
    density: 'comfortable',
    fontSize: 'l',
  })

  expect((await reload()).settings).toMatchObject({
    drawArrows: false,
    theme: 'dark',
    density: 'comfortable',
    fontSize: 'l',
    autoplaySpeed: 4,
    maxSteps: 5000,
  })
})

test('a bad stored value falls back to its default and keeps the good ones', async () => {
  localStorage.setItem(
    'viz-player',
    JSON.stringify({
      state: {
        settings: { theme: 'neon', drawArrows: false, maxSteps: -3, autoplaySpeed: 3 },
        split: 5,
      },
      version: 1,
    }),
  )
  const { settings, split } = await reload()
  expect({ split, ...settings }).toMatchObject({
    split: 0.5,
    theme: 'system',
    drawArrows: false,
    maxSteps: 1000,
    autoplaySpeed: 1,
  })
})

test.each([
  { name: 'pointers', language: cpp, shown: true },
  { name: 'no pointers', language: python, shown: false },
])('a language with $name shows memory addresses: $shown', async ({ language, shown }) => {
  renderPlayer('python-aliasing', { language })
  const dialog = await openSettings()
  expect(dialog.queryByRole('checkbox', { name: 'Show memory addresses' }) !== null).toBe(shown)
})

test('a trace that does not state safety checks shows neither the badge nor the setting', async () => {
  renderPlayer('cpp-binary-search')
  expect((await openSettings()).queryByRole('checkbox', { name: 'Safety checks' })).toBeNull()
  expect(screen.queryByText(/Safety checks: /)).toBeNull()
})

test('safety checks say which way the trace was built and that a change waits for the next run', async () => {
  const { header } = loadFixture('cpp-binary-search')
  renderPlayer('cpp-binary-search', {
    header: { options: { ...header.options, safetyChecks: false } },
  })
  expect(await screen.findByText('Safety checks: off')).toBeDefined()
  const dialog = await openSettings()
  expect(dialog.getByRole('checkbox', { name: 'Safety checks' })).toBeDefined()
  expect(dialog.getByRole('group', { name: 'Next run' }).textContent).toContain(
    'These apply the next time you visualize.',
  )
  expect(
    within(dialog.getByRole('group', { name: 'Next run' })).getByRole('combobox', {
      name: 'Max steps',
    }),
  ).toBeDefined()
})

test('Max steps offers nothing above the language ceiling', async () => {
  renderPlayer('python-aliasing', {
    language: { ...cpp, visualize: { ...cpp.visualize, limits: { maxStepsCeiling: 2000 } } },
  })
  const dialog = await openSettings()
  const options = within(dialog.getByRole('combobox', { name: 'Max steps' })).getAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['100', '500', '1,000', '2,000'])
})
