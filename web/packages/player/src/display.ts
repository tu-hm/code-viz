import { useEffect } from 'react'
import { usePlayer } from './store.ts'

export function useDisplayOptions() {
  const density = usePlayer((s) => s.settings.density)
  const fontSize = usePlayer((s) => s.settings.fontSize)
  const theme = usePlayer((s) => s.settings.theme)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = density
    root.dataset.fontSize = fontSize
    return () => {
      delete root.dataset.density
      delete root.dataset.fontSize
    }
  }, [density, fontSize])

  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'system') {
      root.dataset.theme = theme
      return () => {
        delete root.dataset.theme
      }
    }
    const dark = matchMedia('(prefers-color-scheme: dark)')
    const follow = () => {
      root.dataset.theme = dark.matches ? 'dark' : 'light'
    }
    follow()
    dark.addEventListener('change', follow)
    return () => {
      dark.removeEventListener('change', follow)
      delete root.dataset.theme
    }
  }, [theme])
}
