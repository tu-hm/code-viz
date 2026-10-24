import type { ErrorValues, Step } from './gen/trace.ts'

export type StepError = NonNullable<Step['error']>

export type Part = string | { code: string }

export type Friendly = { title: string; message: Part[]; hint: Part[] }

const code = (text: string) => ({ code: text })

const signals: Record<string, string> = {
  SIGSEGV: 'Segmentation fault (invalid memory access)',
  SIGFPE: 'Arithmetic error (e.g. division by zero)',
  SIGABRT: 'Aborted',
}

export function signalText(signal: string): string | undefined {
  return signals[signal]
}

function count(n: number) {
  return n.toLocaleString('en')
}

function decimal(text: string) {
  return /^-?\d+$/.test(text) ? BigInt(text).toLocaleString('en') : text
}

function shortType(type: string) {
  return type.replace(/<.*$/s, '').replace(/^.*::/, '')
}

function validIndices(size: number) {
  return size === 0 ? 'it is empty' : `valid indices 0–${size - 1}`
}

function indexMessage({ name, index, size, type }: ErrorValues): Part[] {
  if (name !== undefined && index !== undefined) {
    if (size === undefined) return [code(`${name}[${index}]`), ' is out of range.']
    return [
      code(`${name}[${index}]`),
      ' was used, but ',
      code(name),
      ` has size ${count(size)} (${validIndices(size)}).`,
    ]
  }
  const sized =
    size === undefined ? '.' : `, which has size ${count(size)} (${validIndices(size)}).`
  if (name !== undefined) return ['An index out of range was used on ', code(name), sized]
  const subject = index === undefined ? 'An index' : `Index ${index}`
  return [`${subject} is out of range for `, type === undefined ? 'a container' : code(type), sized]
}

function overflowMessage({ op, operands, type, max }: ErrorValues): Part[] {
  if (op === undefined || operands === undefined || type === undefined) {
    return ['A calculation gave a number too big for its type.']
  }
  const [a, b] = operands
  const expr = b === undefined ? `${op}(${a})` : `${a} ${op} ${b}`
  const limit = max === undefined ? '' : ` (max ${decimal(max)})`
  return [`${expr} does not fit in `, code(type), `${limit}.`]
}

function divisionMessage({ expr, divisor }: ErrorValues): Part[] {
  if (expr !== undefined && divisor !== undefined) {
    return [code(expr), ' with ', code(divisor), ' = 0.']
  }
  return ['A division or ', code('%'), ' by zero.']
}

function emptyMessage({ call, name, type }: ErrorValues): Part[] {
  const what = type === undefined ? 'container' : shortType(type)
  if (call === undefined) return [`An element was read from an empty ${what}.`]
  const on = name === undefined ? '' : `${name}.`
  const expr = call === 'operator*' ? `*${on}begin()` : `${on}${call}()`
  return [code(expr), ` on an empty ${what}.`]
}

function recursion({ depth, limit }: ErrorValues): Friendly {
  const title = 'Recursion too deep'
  if (limit !== undefined) {
    return {
      title,
      message: [
        `Python stops at ${count(limit)} nested calls${limit === 1000 ? ' by default' : ''}.`,
      ],
      hint: ['Use ', code('sys.setrecursionlimit(10**6)'), ' or an iterative DFS.'],
    }
  }
  const deep = depth === undefined ? 'too deep' : `${count(depth)} calls deep`
  return {
    title,
    message: [`The recursion went ${deep} and ran out of stack.`],
    hint: ["Use an iterative version, or check the judge's stack limit."],
  }
}

// §19.6 message templates; null => show the runtime's own message
export function friendly(error: StepError): Friendly | null {
  const values = error.values ?? {}
  switch (error.kind) {
    case 'index_out_of_range':
      return {
        title: 'Index out of range',
        message: indexMessage(values),
        hint: ['Valid indices are 0 to size − 1. Check loop bounds such as ', code('i <= n'), '.'],
      }
    case 'signed_overflow':
      return {
        title: 'Integer overflow',
        message: overflowMessage(values),
        hint: ['Use ', code('long long'), ', or apply ', code('% MOD'), ' earlier.'],
      }
    case 'division_by_zero':
      return {
        title: 'Division by zero',
        message: divisionMessage(values),
        hint: ['Check the divisor before dividing.'],
      }
    case 'empty_container':
      return {
        title: 'Empty container',
        message: emptyMessage(values),
        hint: ['Check ', code('.empty()'), ' first.'],
      }
    case 'recursion_too_deep':
      return recursion(values)
    default:
      return null
  }
}

export function rawTitle(error: StepError) {
  return signalText(error.type) ?? `${error.type}: ${error.message}`
}
