import { create } from 'zustand'

export type Settings = {
  maxSteps: number
  autoplaySpeed: 0.5 | 1 | 2 | 4
  drawArrows: boolean
  highlightChanges: boolean
  showUnreachable: boolean
  matrixView: boolean
  showAddresses: boolean
  showInternals: boolean
  safetyChecks: boolean
  density: 'compact' | 'comfortable'
  fontSize: 's' | 'm' | 'l'
  theme: 'system' | 'light' | 'dark'
}

type PlayerState = {
  step: number
  settings: Settings
  split: number
  setStep: (step: number) => void
  updateSettings: (patch: Partial<Settings>) => void
  setSplit: (split: number) => void
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

export const usePlayer = create<PlayerState>()((set) => ({
  step: 0,
  settings: defaultSettings,
  split: 0.5,
  setStep: (step) => set({ step }),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setSplit: (split) => set({ split }),
}))
