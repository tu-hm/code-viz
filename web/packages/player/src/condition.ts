import type { Value } from './gen/trace.ts'

// loosest first
const levels = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '//', '%'],
] as const
type Binary = (typeof levels)[number][number]
const comparisons: readonly string[] = [...levels[2], ...levels[3]]

function isAt(level: number, op: string | undefined): op is Binary {
  return (levels[level] as readonly string[]).some((o) => o === op)
}

export type Expr =
  | { kind: 'number'; text: string }
  | { kind: 'name'; name: string }
  | { kind: 'index'; target: Expr; index: Expr }
  | { kind: 'not'; arg: Expr }
  | { kind: 'negate'; arg: Expr }
  | { kind: 'binary'; op: Binary; left: Expr; right: Expr }

export type Parsed = { expr: Expr } | { error: string }

type Token = { text: string; at: number }

const words: Record<string, string> = { and: '&&', or: '||', not: '!' }
const constants: Record<string, string> = { true: '1', false: '0', True: '1', False: '0' }
const tokenPattern =
  /\s*(?:(0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z_]\w*)|(\/\/|==|!=|<=|>=|&&|\|\||[-+*/%<>!()[\]]))/iy

function tokenize(text: string): Token[] | { error: string } {
  const tokens: Token[] = []
  tokenPattern.lastIndex = 0
  while (tokenPattern.lastIndex < text.length) {
    const at = tokenPattern.lastIndex
    const m = tokenPattern.exec(text)
    if (m === null) {
      if (text.slice(at).trim() === '') break
      const where = at + (text.slice(at).length - text.slice(at).trimStart().length)
      if (text[where] === '=') return { error: `use == to compare, not = (character ${where + 1})` }
      return { error: `can't read “${text[where]}” at character ${where + 1}` }
    }
    const word = m[2]
    tokens.push({ text: word !== undefined ? (words[word] ?? word) : m[0].trim(), at })
  }
  return tokens
}

export function parseCondition(text: string): Parsed {
  const lexed = tokenize(text)
  if (!Array.isArray(lexed)) return lexed
  const tokens: Token[] = lexed
  if (tokens.length === 0) return { error: 'enter a condition such as i == 5' }
  let k = 0
  const peek = () => tokens[k]?.text
  const fail = (what: string): never => {
    const token = tokens[k]
    throw new SyntaxError(
      token === undefined ? `${what} at the end` : `${what} before “${token.text}”`,
    )
  }

  function primary(): Expr {
    const token = tokens[k]
    if (token === undefined) return fail('expected a value')
    k++
    if (token.text === '(') {
      const inner = expression(0)
      if (peek() !== ')') fail('expected “)”')
      k++
      return inner
    }
    if (/^[\d]/.test(token.text)) return { kind: 'number', text: token.text }
    if (/^[A-Za-z_]/.test(token.text)) {
      const constant = constants[token.text]
      return constant === undefined
        ? { kind: 'name', name: token.text }
        : { kind: 'number', text: constant }
    }
    k--
    return fail('expected a value')
  }

  function postfix(): Expr {
    let expr = primary()
    while (peek() === '[') {
      k++
      const index = expression(0)
      if (peek() !== ']') fail('expected “]”')
      k++
      expr = { kind: 'index', target: expr, index }
    }
    return expr
  }

  function unary(): Expr {
    if (peek() === '!') {
      k++
      return { kind: 'not', arg: unary() }
    }
    if (peek() === '-') {
      k++
      return { kind: 'negate', arg: unary() }
    }
    return postfix()
  }

  function expression(level: number): Expr {
    if (level === levels.length) return unary()
    let left = expression(level + 1)
    for (let op = peek(); isAt(level, op); op = peek()) {
      k++
      left = { kind: 'binary', op, left, right: expression(level + 1) }
    }
    return left
  }

  try {
    const expr = expression(0)
    if (k < tokens.length) fail('expected an operator')
    return { expr }
  } catch (e) {
    if (e instanceof SyntaxError) return { error: e.message }
    throw e
  }
}

type Num = bigint | number

export type Scope = {
  name: (name: string) => Value | undefined
  index: (value: Value, index: number) => Value | undefined
}

class NoValue extends Error {}

function number(v: Value | undefined): Num {
  if (v === undefined) throw new NoValue()
  switch (v.t) {
    case 'int':
      return BigInt(v.v ?? '')
    case 'float':
      return Number(v.v)
    case 'bool':
      return v.v === 'true' ? 1n : 0n
    case 'char':
      return BigInt(v.code ?? [...(v.v ?? '')][0]?.codePointAt(0) ?? 0)
    default:
      throw new NoValue()
  }
}

function literal(text: string): Num {
  return /[.e]/i.test(text) && !/^0x/i.test(text) ? Number(text) : BigInt(text)
}

function arithmetic(op: Binary, a: Num, b: Num): Num {
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    if ((op === '/' || op === '//' || op === '%') && b === 0n) throw new NoValue()
    switch (op) {
      case '+':
        return a + b
      case '-':
        return a - b
      case '*':
        return a * b
      case '/':
        return a / b
      case '//':
        return a / b - (a % b !== 0n && a < 0n !== b < 0n ? 1n : 0n)
      default:
        return a % b
    }
  }
  const [x, y] = [Number(a), Number(b)]
  switch (op) {
    case '+':
      return x + y
    case '-':
      return x - y
    case '*':
      return x * y
    case '/':
      return x / y
    case '//':
      return Math.floor(x / y)
    default:
      return x % y
  }
}

function compare(op: Binary, a: Num, b: Num) {
  const both = typeof a === typeof b
  const [x, y] = both ? [a, b] : [Number(a), Number(b)]
  switch (op) {
    case '==':
      return x === y
    case '!=':
      return x !== y
    case '<':
      return x < y
    case '<=':
      return x <= y
    case '>':
      return x > y
    default:
      return x >= y
  }
}

const truth = (n: Num) => (n === 0n || n === 0 ? 0n : 1n)

function value(expr: Expr, scope: Scope): Value | undefined {
  if (expr.kind === 'name') return scope.name(expr.name)
  if (expr.kind !== 'index') return undefined
  const target = value(expr.target, scope)
  const i = num(expr.index, scope)
  if (target === undefined || typeof i !== 'bigint') return undefined
  return scope.index(target, Number(i))
}

function num(expr: Expr, scope: Scope): Num {
  switch (expr.kind) {
    case 'number':
      return literal(expr.text)
    case 'name':
    case 'index':
      return number(value(expr, scope))
    case 'not':
      return truth(num(expr.arg, scope)) === 0n ? 1n : 0n
    case 'negate':
      return -num(expr.arg, scope)
    case 'binary': {
      const { op } = expr
      if (op === '&&') {
        return truth(num(expr.left, scope)) === 0n ? 0n : truth(num(expr.right, scope))
      }
      if (op === '||') {
        return truth(num(expr.left, scope)) === 1n ? 1n : truth(num(expr.right, scope))
      }
      const [a, b] = [num(expr.left, scope), num(expr.right, scope)]
      if (comparisons.includes(op)) return compare(op, a, b) ? 1n : 0n
      return arithmetic(op, a, b)
    }
  }
}

// a name out of scope, an index past the end or a division by zero => false at that step
export function holds(expr: Expr, scope: Scope) {
  try {
    return truth(num(expr, scope)) === 1n
  } catch (e) {
    if (e instanceof NoValue) return false
    throw e
  }
}
