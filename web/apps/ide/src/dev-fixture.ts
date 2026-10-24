import type { FileSource, LanguageInfo } from '@viz/player'

export type DevFixture = {
  source: FileSource
  code: string
  stdin: string
  language: LanguageInfo
}

export async function devFixture(search: string): Promise<DevFixture | null> {
  const name = new URLSearchParams(search).get('fixture')
  if (name === null) return null
  const [{ fixtureNames, loadFixture }, { languages }] = await Promise.all([
    import('@viz/fixtures'),
    import('./mocks/handlers.ts'),
  ])
  if (!fixtureNames.includes(name)) {
    throw new Error(`?fixture=${name}: want one of ${fixtureNames.join(', ')}`)
  }
  const { header, chunks, source, stdin, tail } = loadFixture(name)
  const language = languages.languages.find((l) => l.id === header.language.id)
  if (!language) throw new Error(`fixture ${name}: GET /languages has no ${header.language.id}`)
  return { source: { header, chunks, tail }, code: source, stdin, language }
}
