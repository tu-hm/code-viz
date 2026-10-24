import type { HeapObject, Value } from './gen/trace.ts'

export type Shown = { text: string; detail?: string }
export type Member = { name: string; value: Value }

export type Formatter = {
  value: (v: Value) => Shown
  typeName: (type: string) => string
  sizeLabel: string
  tupleMembers: (o: HeapObject) => Member[] | null
  tupleText: (members: string[]) => string
  nestsRecords: boolean
}

function grouped(digits: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function int(v: Value): Shown {
  const text = v.v ?? ''
  if (!/^-?\d+$/.test(text)) return { text }
  return text.replace('-', '').length > 3 ? { text, detail: grouped(text) } : { text }
}

function withoutZeros(mantissa: string) {
  return mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa
}

// printf's %g: 6 significant digits, exponent below 1e-4 and from 1e6 (§19.4.6)
function sixDigits(n: number) {
  const exponent = Number(n.toExponential(5).split('e')[1])
  if (exponent >= -4 && exponent < 6) return withoutZeros(n.toFixed(5 - exponent))
  const mantissa = withoutZeros(n.toExponential(5).split('e')[0]!)
  const sign = exponent < 0 ? '-' : '+'
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`
}

function float(v: Value, pointZero: boolean): Shown {
  const full = v.v ?? ''
  const n = Number(full)
  if (full.trim() === '' || !Number.isFinite(n)) return { text: full }
  let text = sixDigits(n)
  if (pointZero && /^-?\d+$/.test(text)) text += '.0'
  return text === full ? { text } : { text, detail: full }
}

function escaped(s: string, quote: string, nul: string) {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (ch === '\\' || ch === quote) out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code === 0) out += nul
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return out
}

function str(v: Value, quoted: (s: string) => string): Shown {
  const text = quoted(v.v ?? '')
  if (!v.truncated || v.len === undefined) return { text }
  return {
    text: `${text}…`,
    detail: `${v.len.toLocaleString('en')} characters, the first ${[...(v.v ?? '')].length.toLocaleString('en')} shown`,
  }
}

function plain(v: Value): Shown {
  if (v.t === 'none') return { text: 'None' }
  return { text: v.v ?? v.t }
}

const cQuoted = (quote: string) => (s: string) => `${quote}${escaped(s, quote, '\\0')}${quote}`

function pyQuoted(s: string) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  return `${quote}${escaped(s, quote, '\\x00')}${quote}`
}

const cpp: Formatter = {
  value(v) {
    switch (v.t) {
      case 'int':
        return int(v)
      case 'float':
        return float(v, false)
      case 'char':
        return {
          text: cQuoted("'")(v.v ?? ''),
          detail: v.code === undefined ? undefined : String(v.code),
        }
      case 'str':
        return str(v, cQuoted('"'))
      default:
        return plain(v)
    }
  },
  typeName: (type) => type.replaceAll('std::', ''),
  sizeLabel: 'size',
  tupleMembers: (o) =>
    o.kind === 'record' && /^(std::)?(pair|tuple)</.test(o.type ?? '') ? (o.fields ?? []) : null,
  tupleText: (members) => `(${members.join(', ')})`,
  nestsRecords: true,
}

const python: Formatter = {
  value(v) {
    switch (v.t) {
      case 'int':
        return int(v)
      case 'float':
        return float(v, true)
      case 'str':
        return str(v, pyQuoted)
      default:
        return plain(v)
    }
  },
  typeName: (type) => type,
  sizeLabel: 'len',
  tupleMembers(o) {
    if (o.kind !== 'sequence' || o.type !== 'tuple' || o.truncated || o.items === undefined)
      return null
    return o.items.map((value, i) => ({ name: String(i), value }))
  },
  tupleText: (members) => (members.length === 1 ? `(${members[0]},)` : `(${members.join(', ')})`),
  nestsRecords: false,
}

const fallback: Formatter = {
  value(v) {
    switch (v.t) {
      case 'int':
        return int(v)
      case 'float':
        return float(v, false)
      case 'char':
        return { text: cQuoted("'")(v.v ?? '') }
      case 'str':
        return str(v, (s) => JSON.stringify(s))
      default:
        return plain(v)
    }
  },
  typeName: (type) => type,
  sizeLabel: 'len',
  tupleMembers: () => null,
  tupleText: (members) => `(${members.join(', ')})`,
  nestsRecords: false,
}

const formatters: Record<string, Formatter> = { 'cpp17-gcc': cpp, python3: python }

export function formatterFor(languageId: string): Formatter {
  return formatters[languageId] ?? fallback
}
