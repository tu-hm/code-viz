import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ReactNode } from 'react'
import { Button } from './button.tsx'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger

export function DialogContent({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-1/2 flex-col gap-4 overflow-y-auto rounded-3xl bg-popover p-6 text-popover-foreground shadow-popover"
      >
        <div className="flex items-center justify-between gap-4">
          <DialogPrimitive.Title className="text-xl font-medium">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <Button size="icon" variant="ghost" aria-label="Close">
              <span aria-hidden>✕</span>
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
