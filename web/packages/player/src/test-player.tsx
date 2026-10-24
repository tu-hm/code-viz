import { render } from '@testing-library/react'
import { loadFixture } from '@viz/fixtures'
import { vi } from 'vitest'
import type { TraceHeader } from './load.ts'
import { Player, type LanguageInfo } from './player.tsx'

export const cpp: LanguageInfo = {
  displayName: 'C++17 (GCC 13)',
  editorMode: 'c_cpp',
  visualize: { capabilities: { pointers: true }, limits: { maxStepsCeiling: 5000 } },
}

export const python: LanguageInfo = {
  displayName: 'Python 3.12',
  editorMode: 'python',
  visualize: { capabilities: { pointers: false }, limits: { maxStepsCeiling: 5000 } },
}

export function renderPlayer(
  name: string,
  {
    language = cpp,
    header: edit,
    tail,
    expected,
  }: {
    language?: LanguageInfo
    header?: Partial<TraceHeader>
    tail?: string
    expected?: string
  } = {},
) {
  const { header, chunks, source: code, stdin } = loadFixture(name)
  const onClose = vi.fn<() => void>()
  const source = { header: { ...header, ...edit }, chunks, tail }
  render(
    <Player
      source={source}
      code={code}
      stdin={stdin}
      language={language}
      expected={expected}
      onClose={onClose}
    />,
  )
  return { onClose, stepCount: chunks.flat().length, stdin }
}
