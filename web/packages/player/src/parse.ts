import { Parser } from 'web-tree-sitter'
import { loadGrammar } from './grammars.ts'
import { collectFacts } from './source-facts.ts'

function grammarFor(languageId: string) {
  if (/^c(pp)?\d/.test(languageId)) return 'cpp'
  if (languageId.startsWith('python')) return 'python'
  return null
}

export async function parseSource(code: string, languageId: string) {
  const grammar = grammarFor(languageId)
  if (grammar === null) return null
  const language = await loadGrammar(grammar)
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(code)
  if (tree === null) throw new Error('tree-sitter returned no tree')
  const facts = collectFacts(tree.rootNode)
  tree.delete()
  parser.delete()
  return facts
}
