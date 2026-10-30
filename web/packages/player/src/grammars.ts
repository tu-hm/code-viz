import cpp from 'tree-sitter-cpp/tree-sitter-cpp.wasm?url'
import python from 'tree-sitter-python/tree-sitter-python.wasm?url'
import { Language, Parser } from 'web-tree-sitter'
import runtime from 'web-tree-sitter/web-tree-sitter.wasm?url'

export const grammars = { cpp, python }

export async function loadGrammar(grammar: keyof typeof grammars) {
  await Parser.init({ locateFile: () => runtime })
  return Language.load(grammars[grammar])
}
