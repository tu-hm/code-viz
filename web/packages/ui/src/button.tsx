import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from './cn.ts'

const button = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors duration-(--duration-control) disabled:pointer-events-none disabled:text-faint [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-press disabled:bg-secondary',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary-hover active:bg-secondary-press',
        ghost: 'text-foreground hover:bg-secondary active:bg-secondary-hover',
        danger:
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-press disabled:bg-secondary',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
        icon: 'size-9 [&_svg]:size-[18px]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
)

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof button> & { asChild?: boolean }

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp className={cn(button({ variant, size }), className)} {...props} />
}
