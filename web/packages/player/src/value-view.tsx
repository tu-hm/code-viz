import { cn } from '@viz/ui'
import type { HeapObject, Value } from './gen/trace.ts'
import { inlineChanged, type Look } from './state-layout.ts'

export const changedClass = 'bg-trace-changed font-semibold'

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

function RefLabel({ id, index, title }: { id: string; index?: number; title?: string }) {
  return (
    <span className="whitespace-nowrap" title={title}>
      <span aria-hidden className="text-trace-arrow">
        ●──▶{' '}
      </span>
      <span className="sr-only">points to </span>#{id}
      {index !== undefined && `[${index}]`}
    </span>
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
      if (value.target === undefined) {
        return (
          <span className="text-muted-foreground" title={hover(value.type, 'not followed')}>
            {value.addr}
          </span>
        )
      }
      return (
        <RefLabel id={value.target} index={value.index} title={hover(value.type, value.addr)} />
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
      return <span title={hover(value.type, detail)}>{text}</span>
    }
  }
}
