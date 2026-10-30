import { Button, Popover, PopoverContent, PopoverTrigger } from '@viz/ui'
import { useId, useState, type FormEvent } from 'react'

export function PinMarkers({
  variable,
  pins,
  onPin,
}: {
  variable: string
  pins: string[]
  onPin: (variable: string, names: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(pins.join(', '))
  const inputId = useId()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const names = text.split(/[\s,]+/).filter((n) => /^[A-Za-z_]\w*$/.test(n))
    onPin(variable, [...new Set(names)])
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setText(pins.join(', '))
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="font-sans">
          {pins.length > 0 ? `Marked: ${pins.join(', ')}` : 'Mark…'}
        </Button>
      </PopoverTrigger>
      <PopoverContent label={`Mark variables on ${variable}`}>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2 p-1 font-sans">
          <label htmlFor={inputId} className="text-sm">
            Mark on {variable}
          </label>
          <input
            id={inputId}
            value={text}
            placeholder="l, r"
            onChange={(e) => setText(e.target.value)}
            className="h-8 w-40 rounded-lg border border-input bg-background px-2 font-mono text-base sm:text-sm"
          />
          <Button size="sm" type="submit">
            Mark
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
