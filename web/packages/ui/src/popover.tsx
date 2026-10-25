import { Popover as PopoverPrimitive } from 'radix-ui'
import type { ReactNode } from 'react'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        aria-label={label}
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="z-50 flex max-h-(--radix-popover-content-available-height) w-[min(32rem,calc(100vw-2rem))] flex-col overflow-y-auto rounded-xl bg-popover p-2 text-popover-foreground shadow-popover"
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}
