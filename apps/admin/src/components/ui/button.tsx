import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] text-[0.82rem] font-medium transition-all hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold border border-transparent hover:brightness-110',
        secondary: 'border border-[var(--line-strong)] bg-[var(--bg-2)] text-[var(--ink)] hover:bg-[var(--bg-3)] hover:border-[var(--ink-muted)]',
        ghost: 'text-[var(--ink-muted)] border border-transparent hover:bg-[var(--bg-3)] hover:text-[var(--ink-secondary)] hover:border-[var(--line)]',
        outline: 'border border-[color:color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]',
        danger: 'border border-[color:color-mix(in_srgb,var(--exposed)_30%,transparent)] bg-[var(--exposed-soft)] text-[var(--exposed)] hover:bg-[color:color-mix(in_srgb,var(--exposed)_20%,transparent)]',
      },
      size: {
        sm: 'h-[30px] px-2.5 text-[0.76rem]',
        default: 'h-[34px] px-3.5',
        lg: 'h-[38px] px-4',
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
