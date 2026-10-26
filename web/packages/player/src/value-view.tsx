import { cn } from '@viz/ui'
import type { HeapObject, Value } from './gen/trace.ts'
import { inlineChanged, type Look } from './state-layout.ts'

export const changedClass = 'bg-trace-changed font-semibold'

// §19.4.6: limits and moduli CP code compares against, by value
const constants: Record<string, string> = {
  '2147483647': 'INT_MAX',
  '9223372036854775807': 'LLONG_MAX',
  '1061109567': '0x3f3f3f3f',
  '1000000007': 'MOD',
  '998244353': 'MOD',
}

function badge(v: Value, inf: string | null) {
  if (v.t !== 'int' || v.v === undefined) return null
  if (inf !== null && v.v === inf) return '∞ INF'
  if (inf !== null && inf !== '0' && v.v === `-${inf}`) return '-∞ INF'
  return constants[v.v] ?? null
}

function hover(...parts: (string | undefined)[]) {
  const text = parts.filter((p) => p !== undefined && p !== '').join(' · ')
  return text === '' ? undefined : text
}

export function Mark({ on }: { on: boolean }) {
  if (!on) return null
  return (
    <>
      <span aria-hidden>*</span>
      <span className="sr-only"> (changed)</span>
    </>
  )
}

function RefLabel({
  id,
  index,
  title,
  addr,
  showAddr,
}: {
  id: string
  index?: number
  title?: string
  addr?: string
  showAddr?: boolean
}) {
  return (
    <button
      type="button"
      data-arrow-to={id}
      data-addr={addr === undefined ? undefined : ''}
      title={title}
      className="group/ref cursor-pointer rounded-sm text-left whitespace-nowrap data-active:underline"
    >
      <span
        aria-hidden
        className="text-trace-arrow transition-colors duration-(--duration-fade) group-data-active/ref:text-trace-arrow-active"
      >
        ●──▶{' '}
      </span>
      <span className="sr-only">points to</span> #{id}
      {index !== undefined && `[${index}]`}
      {showAddr && (
        <>
          {' '}
          <span className="text-muted-foreground">{addr}</span>
        </>
      )}
    </button>
  )
}

function Faint({ glyph, text, title }: { glyph: string; text: string; title?: string }) {
  return (
    <span className="text-trace-unset" title={title}>
      <span aria-hidden>{glyph}</span>
      <span className="sr-only">{text}</span>
    </span>
  )
}

export function Fields({ id, object, look }: { id: string; object: HeapObject; look: Look }) {
  const changed = look.changed[id] ?? []
  const fields = object.fields ?? []
  if (fields.length === 0) return <p className="text-muted-foreground">no fields</p>
  return (
    <table className="w-full font-mono">
      <tbody>
        {fields.map((f) => {
          const on = look.highlight && (changed.includes(f.name) || inlineChanged(f.value, look))
          return (
            <tr key={f.name} className="border-b border-border align-top last:border-b-0">
              <th scope="row" className="py-0.5 pr-3 text-left font-normal text-muted-foreground">
                {f.name}
              </th>
              <td
                className={cn(
                  'w-full py-0.5 transition-colors duration-(--duration-fade)',
                  on && changedClass,
                )}
              >
                <ValueView value={f.value} look={look} />
                <Mark on={on} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function ValueView({ value, look }: { value: Value; look: Look }) {
  switch (value.t) {
    case 'ref': {
      const id = value.id ?? '?'
      const inline = look.inline[id]
      if (inline !== undefined) return <span title={value.type}>{inline}</span>
      const nested = look.heap[id]
      if (look.nested.has(id) && nested) {
        return (
          <div className="border-l-2 border-border pl-2" title={value.type}>
            <Fields id={id} object={nested} look={look} />
          </div>
        )
      }
      return <RefLabel id={id} title={value.type} />
    }
    case 'ptr':
      if (value.addr === '0x0') {
        return <Faint glyph="∅" text="null pointer" title={hover(value.type, 'nullptr')} />
      }
      if (value.target === undefined || !Object.hasOwn(look.heap, value.target)) {
        return (
          <span
            className="text-muted-foreground"
            title={hover(
              value.type,
              value.target === undefined ? 'not followed' : 'no object here',
            )}
          >
            {value.addr}
          </span>
        )
      }
      return (
        <RefLabel
          id={value.target}
          index={value.index}
          title={hover(value.type, value.addr)}
          addr={value.addr}
          showAddr={look.addresses}
        />
      )
    case 'uninit':
      return <Faint glyph="·" text="not set yet" title={hover(value.type, 'not set yet')} />
    case 'unavailable':
      return (
        <Faint
          glyph="?"
          text="couldn't read"
          title={hover(value.type, `couldn't read: ${(value.reason ?? '').replaceAll('_', ' ')}`)}
        />
      )
    default: {
      const { text, detail } = look.format.value(value)
      const named = badge(value, look.inf)
      if (named !== null) {
        return (
          <span title={hover(value.type, detail ?? text)}>
            <span className="rounded-sm bg-secondary px-1 font-sans text-xs whitespace-nowrap">
              {named}
            </span>
            <span className="sr-only"> ({text})</span>
          </span>
        )
      }
      return <span title={hover(value.type, detail)}>{text}</span>
    }
  }
}
