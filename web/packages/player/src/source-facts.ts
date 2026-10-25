import type { Node } from 'web-tree-sitter'

// name null => a constant; whole index null => not identifier ± constant, so never evaluated (§19.4.1)
export type Index = { name: string | null; offset: number }
export type Mode = 'r' | 'w' | 'rw'
export type Subscript = { array: string; indices: (Index | null)[]; mode: Mode }
export const headers = ['if', 'while', 'for'] as const

export type LineFacts = {
  subscripts: Subscript[]
  identifiers: string[]
  inputs: string[]
  scanf: string[]
  header: (typeof headers)[number] | null
}

export type SourceFacts = Record<number, LineFacts>

const none: LineFacts = { subscripts: [], identifiers: [], inputs: [], scanf: [], header: null }

export function lineFacts(facts: SourceFacts | null, line: number | null | undefined): LineFacts {
  if (facts === null || line === null || line === undefined) return none
  return facts[line] ?? none
}

const subscriptTypes = new Set(['subscript_expression', 'subscript'])
const headerTypes: Record<string, LineFacts['header']> = {
  if_statement: 'if',
  elif_clause: 'if',
  while_statement: 'while',
  do_statement: 'while',
  for_statement: 'for',
  for_range_loop: 'for',
}
const patterns = new Set(['pattern_list', 'tuple_pattern', 'list_pattern', 'tuple', 'list'])
const conversion = /%[-+ #0]*(?:\d+|\*)?(?:\.\d+)?(?:hh|h|ll|l|L|z|j|t)?[diouxXfFeEgGaAcspn]/g

function base(node: Node) {
  return node.childForFieldName('argument') ?? node.childForFieldName('value')
}

function indexNodes(node: Node): Node[] {
  const list = node.childForFieldName('indices')
  if (list) return list.namedChildren.filter((n) => n.type !== 'comment')
  return node.childrenForFieldName('subscript')
}

function unwrap(node: Node): Node {
  let n = node
  while (n.type === 'parenthesized_expression' && n.namedChildren.length === 1)
    n = n.namedChildren[0]!
  return n
}

function integer(node: Node) {
  if (node.type !== 'number_literal' && node.type !== 'integer') return null
  const text = node.text.replace(/['_]/g, '').replace(/[uUlL]+$/, '')
  return /^\d+$/.test(text) ? Number(text) : null
}

function index(node: Node): Index | null {
  const n = unwrap(node)
  if (n.type === 'identifier') return { name: n.text, offset: 0 }
  const constant = integer(n)
  if (constant !== null) return { name: null, offset: constant }
  if (n.type !== 'binary_expression' && n.type !== 'binary_operator') return null
  const op = n.childForFieldName('operator')?.text
  const left = n.childForFieldName('left')
  const right = n.childForFieldName('right')
  if ((op !== '+' && op !== '-') || !left || !right) return null
  const [l, r] = [unwrap(left), unwrap(right)]
  const rc = integer(r)
  if (l.type === 'identifier' && rc !== null) return { name: l.text, offset: op === '+' ? rc : -rc }
  const lc = integer(l)
  if (op === '+' && r.type === 'identifier' && lc !== null) return { name: r.text, offset: lc }
  return null
}

function isCin(node: Node) {
  return node.text === 'cin' || node.text === 'std::cin'
}

function cinChain(node: Node): Node[] | null {
  const operands: Node[] = []
  let n = node
  while (n.type === 'binary_expression' && n.childForFieldName('operator')?.text === '>>') {
    operands.unshift(n.childForFieldName('right')!)
    n = n.childForFieldName('left')!
  }
  return isCin(n) ? operands : null
}

function insideCin(node: Node) {
  let n = node
  while (n.parent?.type === 'binary_expression') {
    const parent = n.parent
    if (parent.childForFieldName('operator')?.text !== '>>') return false
    if (parent.childForFieldName('right')?.id !== n.id) return false
    let left = parent.childForFieldName('left')!
    while (left.type === 'binary_expression') left = left.childForFieldName('left')!
    if (isCin(left)) return true
    n = parent
  }
  return false
}

function isScanf(call: Node | null | undefined) {
  const f = call?.childForFieldName('function')?.text
  return f === 'scanf' || f === 'std::scanf'
}

function mode(node: Node): Mode {
  let n = node
  while (n.parent && (n.parent.type === 'parenthesized_expression' || patterns.has(n.parent.type)))
    n = n.parent
  const parent = n.parent
  if (!parent) return 'r'
  const isLeft = parent.childForFieldName('left')?.id === n.id
  switch (parent.type) {
    case 'assignment':
      return isLeft ? 'w' : 'r'
    case 'assignment_expression':
      if (!isLeft) return 'r'
      return parent.childForFieldName('operator')?.text === '=' ? 'w' : 'rw'
    case 'augmented_assignment':
      return isLeft ? 'rw' : 'r'
    case 'update_expression':
      return 'rw'
    case 'pointer_expression':
      return parent.childForFieldName('operator')?.text === '&' && isScanf(parent.parent?.parent)
        ? 'w'
        : 'r'
    default:
      return insideCin(node) ? 'w' : 'r'
  }
}

function subscript(node: Node): Subscript {
  const indices: (Index | null)[] = []
  let n = node
  while (subscriptTypes.has(n.type)) {
    indices.unshift(...indexNodes(n).map(index))
    const b = base(n)
    if (!b) break
    n = unwrap(b)
  }
  return { array: n.text, indices, mode: mode(node) }
}

function isOutermost(node: Node) {
  const parent = node.parent
  return !(parent && subscriptTypes.has(parent.type) && base(parent)?.id === node.id)
}

export function collectFacts(root: Node): SourceFacts {
  const facts: SourceFacts = {}
  const at = (node: Node) => {
    const line = node.startPosition.row + 1
    facts[line] ??= { subscripts: [], identifiers: [], inputs: [], scanf: [], header: null }
    return facts[line]
  }
  const todo = [root]
  while (todo.length > 0) {
    const node = todo.pop()!
    todo.push(...node.namedChildren.toReversed())
    const header = headerTypes[node.type]
    if (header) at(node).header ??= header
    if (node.type === 'identifier') {
      const ids = at(node).identifiers
      if (!ids.includes(node.text)) ids.push(node.text)
    }
    if (subscriptTypes.has(node.type) && isOutermost(node))
      at(node).subscripts.push(subscript(node))
    if (node.type === 'binary_expression' && node.parent?.type !== 'binary_expression') {
      for (const operand of cinChain(node) ?? []) at(operand).inputs.push(operand.text)
    }
    if (node.type === 'call_expression' && isScanf(node)) {
      const format = node.childForFieldName('arguments')?.namedChildren[0]
      if (format?.type === 'string_literal') {
        at(node).scanf.push(...(format.text.replaceAll('%%', '').match(conversion) ?? []))
      }
    }
  }
  return facts
}

export function indexText(i: Index | null) {
  if (i === null) return '?'
  if (i.name === null) return String(i.offset)
  if (i.offset === 0) return i.name
  return `${i.name}${i.offset > 0 ? '+' : '-'}${Math.abs(i.offset)}`
}

export function evaluate(i: Index | null, scope: (name: string) => number | undefined) {
  if (i === null) return null
  if (i.name === null) return i.offset
  const v = scope(i.name)
  return v === undefined ? null : v + i.offset
}
