import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StepState } from './engine.ts'
import { isRecord } from './is-record.ts'

export const speeds = [0.5, 1, 2, 4] as const
export const densities = ['compact', 'comfortable'] as const
export const fontSizes = ['s', 'm', 'l'] as const
export const themes = ['system', 'light', 'dark'] as const
export const viewAs = ['table', 'cells'] as const

export type ViewAs = (typeof viewAs)[number]

export type Settings = {
  maxSteps: number
  autoplaySpeed: (typeof speeds)[number]
  drawArrows: boolean
  highlightChanges: boolean
  showUnreachable: boolean
  matrixView: boolean
  showAddresses: boolean
  showInternals: boolean
  safetyChecks: boolean
  density: (typeof densities)[number]
  fontSize: (typeof fontSizes)[number]
  theme: (typeof themes)[number]
}

type PlayerState = {
  step: number
  playing: boolean
  current: StepState | null
  breakpoints: number[]
  settings: Settings
  split: number
  expected: string
  exact: boolean
  comparing: boolean
  jumpLine: string
  jumpChange: string
  jumpCall: string | null
  notice: string | null
  views: Record<string, ViewAs>
  revealed: { line: number } | null
  go: (step: number) => void
  setPlaying: (playing: boolean) => void
  updateSettings: (patch: Partial<Settings>) => void
  setSplit: (split: number) => void
  toggleBreakpoint: (line: number) => void
  setView: (variable: string, view: ViewAs) => void
  revealLine: (line: number) => void
}

export const defaultSettings: Settings = {
  maxSteps: 1000,
  autoplaySpeed: 1,
  drawArrows: true,
  highlightChanges: true,
  showUnreachable: false,
  matrixView: true,
  showAddresses: false,
  showInternals: false,
  safetyChecks: true,
  density: 'compact',
  fontSize: 'm',
  theme: 'system',
}

export const splitRange = [0.2, 0.8] as const

function oneOf<T>(values: readonly T[], value: unknown, fallback: T): T {
  return values.find((v) => v === value) ?? fallback
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function restore(stored: unknown, current: PlayerState): PlayerState {
  const s = isRecord(stored) ? stored : {}
  const saved = isRecord(s.settings) ? s.settings : {}
  const d = current.settings
  const { split } = s
  const { maxSteps } = saved
  return {
    ...current,
    split:
      typeof split === 'number' && split >= splitRange[0] && split <= splitRange[1]
        ? split
        : current.split,
    settings: {
      maxSteps:
        typeof maxSteps === 'number' && Number.isInteger(maxSteps) && maxSteps > 0
          ? maxSteps
          : d.maxSteps,
      autoplaySpeed: oneOf(speeds, saved.autoplaySpeed, d.autoplaySpeed),
      drawArrows: bool(saved.drawArrows, d.drawArrows),
      highlightChanges: bool(saved.highlightChanges, d.highlightChanges),
      showUnreachable: bool(saved.showUnreachable, d.showUnreachable),
      matrixView: bool(saved.matrixView, d.matrixView),
      showAddresses: bool(saved.showAddresses, d.showAddresses),
      showInternals: bool(saved.showInternals, d.showInternals),
      safetyChecks: bool(saved.safetyChecks, d.safetyChecks),
      density: oneOf(densities, saved.density, d.density),
      fontSize: oneOf(fontSizes, saved.fontSize, d.fontSize),
      theme: oneOf(themes, saved.theme, d.theme),
    },
  }
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set) => ({
      step: 0,
      playing: false,
      current: null,
      breakpoints: [],
      settings: defaultSettings,
      split: 0.5,
      expected: '',
      exact: false,
      comparing: false,
      jumpLine: '',
      jumpChange: '',
      jumpCall: null,
      notice: null,
      views: {},
      revealed: null,
      go: (step) => set({ step, playing: false, notice: null }),
      setPlaying: (playing) => set({ playing }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setSplit: (split) => set({ split }),
      toggleBreakpoint: (line) =>
        set(({ breakpoints }) => ({
          breakpoints: breakpoints.includes(line)
            ? breakpoints.filter((b) => b !== line)
            : [...breakpoints, line].sort((a, b) => a - b),
        })),
      setView: (variable, view) => set(({ views }) => ({ views: { ...views, [variable]: view } })),
      revealLine: (line) => set({ revealed: { line } }),
    }),
    {
      name: 'viz-player',
      version: 1,
      partialize: (s) => ({ settings: s.settings, split: s.split }),
      merge: restore,
    },
  ),
)
