import { Button, cn } from '@viz/ui'
import { useId, useState } from 'react'

const widths = [8, 16, 32, 64] as const
type Width = (typeof widths)[number] | 'n'

function fits(value: bigint, width: number) {
  const top = 1n << BigInt(width)
  return value >= 0n ? value < top : value >= -(top >> 1n)
}

// React Compiler can't lower a BigInt literal, so the bit math stays out of the component
function bitsOf(value: string, width: number | null) {
  const big = BigInt(value)
  const w = width ?? widths.find((x) => fits(big, x)) ?? 64
  const bits = BigInt.asUintN(w, big)
  const ones = Array.from({ length: w }, (_, k) => ((bits >> BigInt(w - 1 - k)) & 1n) === 1n)
  const set = ones.flatMap((one, k) => (one ? [w - 1 - k] : [])).toReversed()
  return { width: w, ones, set, fits: fits(big, w) }
}

export function BitsView({
  name,
  value,
  n,
  onNumber,
}: {
  name: string
  value: string
  n: number | null
  onNumber: () => void
}) {
  const [picked, setPicked] = useState<Width | null>(null)
  const groupId = useId()
  const usable = n !== null && n >= 1 && n <= 64
  const { width, ones, set, fits } = bitsOf(value, picked === 'n' ? (usable ? n : null) : picked)
  const indices = ones.map((_, k) => width - 1 - k)
  return (
    <div className="mt-1 flex flex-col gap-1 border-l-2 border-border pl-2 text-xs">
      <div className="overflow-x-auto">
        <table aria-label={`${name} in ${width} bits`} className="text-center">
          <tbody>
            <tr className="text-muted-foreground">
              <th scope="row" className="pr-2 text-left font-normal">
                bit
              </th>
              {indices.map((i) => (
                <td
                  key={i}
                  className={cn('min-w-[2ch]', i % 4 === 3 && i !== width - 1 && 'pl-1.5')}
                >
                  {i}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="pr-2 text-left font-normal text-muted-foreground">
                value
              </th>
              {indices.map((i, k) => {
                const one = ones[k]!
                return (
                  <td
                    key={i}
                    className={cn(
                      i % 4 === 3 && i !== width - 1 && 'pl-1.5',
                      one ? 'font-semibold text-brand' : 'text-muted-foreground',
                    )}
                  >
                    {one ? 1 : 0}
                  </td>
                )
              })}
              <td className="pl-3 whitespace-nowrap">= {value}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!fits && (
        <p className="text-warning">
          {value} needs more than {width} bits; the low {width} are shown
        </p>
      )}
      <p>
        set bits {'{'}
        {set.join(', ')}
        {'}'} · popcount {set.length}
      </p>
      <div className="flex flex-wrap items-center gap-1 font-sans">
        <span id={groupId} className="text-muted-foreground">
          Width
        </span>
        <div role="group" aria-labelledby={groupId} className="flex gap-1">
          {[...widths, 'n' as const].map((w) => {
            const on = w === 'n' ? picked === 'n' : picked !== 'n' && width === w
            return (
              <Button
                key={w}
                size="sm"
                variant={on ? 'secondary' : 'ghost'}
                aria-pressed={on}
                disabled={w === 'n' && !usable}
                onClick={() => setPicked(w)}
              >
                {w}
              </Button>
            )
          })}
        </div>
        <span className="text-muted-foreground">
          {usable ? `n = ${n}` : 'n: no n from 1 to 64 in scope'}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onNumber}>
          Show as number
        </Button>
      </div>
    </div>
  )
}
