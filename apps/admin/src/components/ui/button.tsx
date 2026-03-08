import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-0)] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-dim)]',
        secondary: 'border border-[var(--line-medium)] bg-[var(--bg-3)] text-[var(--ink-secondary)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]',
        ghost: 'text-[var(--ink-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--ink-secondary)]',
        outline: 'border border-[color:color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]',
        danger: 'border border-[color:color-mix(in_srgb,var(--exposed)_30%,transparent)] bg-[var(--exposed-soft)] text-[var(--exposed)] hover:bg-[color:color-mix(in_srgb,var(--exposed)_20%,transparent)]',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button }
